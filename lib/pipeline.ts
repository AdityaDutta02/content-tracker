// Pipeline orchestrator. Chronological-first with AI summary, no rerank.
// Calls:
//   1× list sources
//   1× list recent runs (cross-day dedupe)
//   1× LLM summary batch (chat fast)
//   1× insert runs row (items packed as JSONB)
//   1× update channels.last_run_date
import type { ChannelRow, SourceRow, FetchedItem } from './types'
import { fetchSource } from './sources'
import { canonicalizeUrl } from './canonical'
import { callGateway } from './terminal-ai'
import { dbList, dbInsert, dbUpdate } from './db'
import { dateInTz } from './time'
import { looksLikeArticle } from './sources/quality'

const TOP_N = 10
// A web source whose entire fetched sample is non-article for this many
// consecutive runs is auto-silenced (issue #22) so the Sources tab flags it.
const SILENCE_AFTER_EMPTY_RUNS = 3
const MIN_TOP = 5
const SOCIAL_QUOTA_TARGET = 3
const SOCIAL_QUOTA_MIN = 2
const ARTICLE_QUOTA = TOP_N - SOCIAL_QUOTA_TARGET // = 7
const SOCIAL_TYPES = new Set<string>(['x', 'ig', 'yt'])
const RECENT_RUNS_FOR_DEDUPE = 7
const PRIMARY_AGE_MS = 7 * 24 * 60 * 60 * 1000
const BACKFILL_AGE_MS = 30 * 24 * 60 * 60 * 1000
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000

const SOURCE_TIMEOUT_MS: Record<string, number> = {
  rss: 20_000,
  hn: 20_000,
  reddit: 20_000,
  arxiv: 20_000,
  web: 35_000,
  x: 45_000,
  ig: 45_000,
  fb: 45_000,
  yt: 45_000,
  linkedin: 45_000,
}
const DEFAULT_SOURCE_TIMEOUT_MS = 30_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

export interface RunResult {
  status: 'ok' | 'partial' | 'failed'
  item_count: number
  credits_used: number
  errors: Array<{ source_id: string; error: string }>
  run_id?: string
}

interface RunRow {
  id: string
  channel_id: string
  run_at: string
  items_json: Array<{ canonical_url: string }>
}

type Raw = FetchedItem & { source_id: string }

export async function runChannelPipeline(
  channel: ChannelRow,
  embedToken: string,
  trigger: 'cron' | 'manual',
): Promise<RunResult> {
  const errors: RunResult['errors'] = []

  const allSources = await dbList<SourceRow>('sources', { channel_id: channel.id }, embedToken)
  const sources = allSources.filter((s) => s.enabled !== false)
  if (sources.length === 0) {
    return { status: 'failed', item_count: 0, credits_used: 0, errors: [{ source_id: 'none', error: 'no enabled sources' }] }
  }

  const raw: Raw[] = []
  await Promise.all(
    sources.map(async (s) => {
      const ms = SOURCE_TIMEOUT_MS[s.type] ?? DEFAULT_SOURCE_TIMEOUT_MS
      try {
        const items = await withTimeout(fetchSource(s, channel, embedToken), ms, `source ${s.type}:${s.id}`)
        for (const it of items) raw.push({ ...it, source_id: s.id })
      } catch (e) {
        errors.push({ source_id: s.id, error: e instanceof Error ? e.message : String(e) })
      }
    }),
  )

  for (const r of raw) r.url = canonicalizeUrl(r.url || '')

  // Runtime article backstop (issue #22). A web source that passed detection can
  // drift (redesign turns articles into nav). Drop non-article items from web
  // sources before they reach the feed. Structured sources (rss/hn/reddit/arxiv)
  // and social cards are trusted as-is.
  const srcType = new Map(sources.map((s) => [s.id, s.type]))
  const srcUrl = new Map(sources.map((s) => [s.id, s.url ?? undefined]))
  const isWeb = (sourceId: string) => srcType.get(sourceId) === 'web'
  const articleClean = raw.filter(
    (r) => !isWeb(r.source_id) || looksLikeArticle(r, srcUrl.get(r.source_id)),
  )

  // Auto-silence drifted web sources: if a web source returned items but ZERO
  // survived the article filter, count it as an empty run; after N consecutive
  // empties, disable it and surface the reason in the Sources tab. Fire-and-forget.
  await reconcileWebSourceHealth(sources, raw, articleClean, srcType, embedToken)

  const recentRuns = await dbList<RunRow>('runs', { channel_id: channel.id }, embedToken)
  const seenUrls = new Set<string>()
  recentRuns
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1))
    .slice(0, RECENT_RUNS_FOR_DEDUPE)
    .forEach((r) => (r.items_json ?? []).forEach((it) => seenUrls.add(it.canonical_url)))

  // Tiered freshness gate. Never strand the user on an empty feed.
  //   undated items → treat as fetched-now (low confidence, ranked last).
  //   future-dated > 24h → dropped (clock junk).
  //   tier 1: within 7d → primary set.
  //   tier 2: within 30d → backfill if tier 1 < MIN_TOP.
  //   tier 3: any age → backfill if still < MIN_TOP.
  // Dedupe + URL validity still enforced at all tiers.
  const now = Date.now()
  type Aged = Raw & { _t: number; _undated: boolean }
  const aged: Aged[] = []
  for (const r of articleClean) {
    if (!r.url || seenUrls.has(r.url)) continue
    let t = r.published_at ? new Date(r.published_at).getTime() : NaN
    const undated = !Number.isFinite(t)
    if (undated) t = now
    if (t - now > FUTURE_SLACK_MS) continue
    aged.push({ ...r, _t: t, _undated: undated })
  }

  const tier1 = aged.filter((r) => !r._undated && now - r._t <= PRIMARY_AGE_MS)
  let fresh: Aged[] = tier1
  if (fresh.length < MIN_TOP) {
    const tier2 = aged.filter((r) => !r._undated && now - r._t > PRIMARY_AGE_MS && now - r._t <= BACKFILL_AGE_MS)
    fresh = [...fresh, ...tier2]
  }
  if (fresh.length < MIN_TOP) {
    const tier3 = aged.filter((r) => r._undated || now - r._t > BACKFILL_AGE_MS)
    fresh = [...fresh, ...tier3]
  }

  // In-run dedupe by canonical URL (keep first seen, which carries source_id).
  const seenThisRun = new Set<string>()
  const deduped: Aged[] = []
  for (const it of fresh) {
    if (seenThisRun.has(it.url)) continue
    seenThisRun.add(it.url)
    deduped.push(it)
  }

  // Chronological newest-first; undated items sink to bottom.
  deduped.sort((a, b) => {
    if (a._undated !== b._undated) return a._undated ? 1 : -1
    return b._t - a._t
  })

  // Social quota. Partition into social (x/ig/yt) vs article (everything else)
  // so chatty article feeds cannot crowd social cards out of the top slots.
  // Target: 7 articles + 3 social, but each bucket backfills the other so the
  // feed still fills to TOP_N when one bucket is thin.
  const isSocial = (it: Aged) => SOCIAL_TYPES.has(srcType.get(it.source_id) ?? '')
  const socialItems = deduped.filter(isSocial)
  const articleItems = deduped.filter((it) => !isSocial(it))

  // Per-source diversity cap applied WITHIN each bucket, not across.
  function capPerSource(items: Aged[], quota: number): Aged[] {
    const srcCount = new Set(items.map((d) => d.source_id)).size || 1
    const cap = Math.max(2, Math.ceil(quota / srcCount))
    const count = new Map<string, number>()
    const out: Aged[] = []
    for (const it of items) {
      const n = count.get(it.source_id) ?? 0
      if (n >= cap) continue
      count.set(it.source_id, n + 1)
      out.push(it)
    }
    return out
  }
  const cappedArticle = capPerSource(articleItems, ARTICLE_QUOTA)
  const cappedSocial = capPerSource(socialItems, SOCIAL_QUOTA_TARGET)

  // Buckets are disjoint, so primary picks never collide. Reserve up to TARGET
  // social slots (≥ MIN whenever that many social items exist) + ARTICLE_QUOTA
  // article slots, then backfill any shortfall from the other bucket, then from
  // uncapped leftovers so a tight per-source cap never leaves empty slots.
  const picked: Aged[] = [
    ...cappedSocial.slice(0, SOCIAL_QUOTA_TARGET),
    ...cappedArticle.slice(0, ARTICLE_QUOTA),
  ]
  const have = new Set(picked.map((p) => p.url))
  const backfill = (pool: Aged[]) => {
    for (const it of pool) {
      if (picked.length >= TOP_N) break
      if (have.has(it.url)) continue
      have.add(it.url)
      picked.push(it)
    }
  }
  backfill(cappedArticle)
  backfill(cappedSocial)
  backfill(deduped)
  if (socialItems.length >= SOCIAL_QUOTA_MIN && picked.filter(isSocial).length < SOCIAL_QUOTA_MIN) {
    // Defensive: should not happen given the reserve above, but guarantees the floor.
    backfill(socialItems)
  }

  // Final chronological sort so the feed reads newest-first, not bucket-grouped.
  picked.sort((a, b) => {
    if (a._undated !== b._undated) return a._undated ? 1 : -1
    return b._t - a._t
  })
  const top: Raw[] = picked.slice(0, TOP_N)

  let credits_used = 0
  let summaries: string[] = top.map((t) => cleanShortSummary(t.summary))
  if (top.length >= 3) {
    try {
      const r = await summarizeBatch(top, channel.niche, embedToken)
      summaries = r.summaries
      credits_used = r.credits
    } catch (e) {
      errors.push({ source_id: 'summarize', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const itemsJson = top.map((it, i) => ({
    source_id: it.source_id,
    external_id: it.external_id,
    canonical_url: it.url,
    title: it.title,
    url: it.url,
    summary: summaries[i] ?? cleanShortSummary(it.summary),
    image_url: it.image_url ?? null,
    published_at: it.published_at ?? null,
    engagement: it.engagement ?? {},
    rank: i + 1,
  }))

  // Write the run-date in the CHANNEL's timezone so the cron's "already ran
  // today" check (also tz-based) agrees — UTC here caused double/skip near
  // midnight (issue #20).
  const today = dateInTz(new Date(), channel.timezone)
  const status: RunResult['status'] = errors.length === 0 ? 'ok' : itemsJson.length > 0 ? 'partial' : 'failed'

  const runRow = await dbInsert<{ id: string }>(
    'runs',
    {
      channel_id: channel.id,
      trigger,
      status,
      item_count: itemsJson.length,
      credits_used,
      errors: errors.length ? errors : null,
      items_json: itemsJson,
    },
    embedToken,
  ).catch((e) => {
    errors.push({ source_id: 'runs_insert', error: e instanceof Error ? e.message : String(e) })
    return null
  })

  if (channel.last_run_date !== today) {
    await dbUpdate<ChannelRow>('channels', channel.id, { last_run_date: today }, embedToken).catch(() => undefined)
  }

  return {
    status,
    item_count: itemsJson.length,
    credits_used,
    errors,
    run_id: runRow?.id,
  }
}

// Track per-web-source "empty run" streaks (issue #22). A run where the source
// returned items but none survived the article filter increments the streak;
// after SILENCE_AFTER_EMPTY_RUNS the source is disabled with a visible reason.
// A run that produces real items resets the streak. Fetch failures (0 fetched)
// are ignored here — they're transient, not drift. All writes are best-effort.
async function reconcileWebSourceHealth(
  sources: SourceRow[],
  raw: Raw[],
  clean: Raw[],
  srcType: Map<string, string>,
  embedToken: string,
): Promise<void> {
  const fetchedCount = new Map<string, number>()
  const goodCount = new Map<string, number>()
  for (const r of raw) fetchedCount.set(r.source_id, (fetchedCount.get(r.source_id) ?? 0) + 1)
  for (const r of clean) goodCount.set(r.source_id, (goodCount.get(r.source_id) ?? 0) + 1)

  const updates: Array<Promise<unknown>> = []
  for (const s of sources) {
    if (srcType.get(s.id) !== 'web') continue
    const fetched = fetchedCount.get(s.id) ?? 0
    if (fetched === 0) continue // fetch failed/empty — transient, don't penalize
    const good = goodCount.get(s.id) ?? 0
    const cfg = s.scrape_config ?? {}
    const prevEmpty = Number((cfg._empty_runs as number | undefined) ?? 0)

    if (good === 0) {
      const empty = prevEmpty + 1
      const patch: Partial<SourceRow> = { scrape_config: { ...cfg, _empty_runs: empty } }
      if (empty >= SILENCE_AFTER_EMPTY_RUNS) {
        patch.enabled = false
        patch.last_fetch_error = `Silenced: no article-like items in ${empty} runs (source may have changed)`
      }
      updates.push(dbUpdate<SourceRow>('sources', s.id, patch, embedToken).catch(() => undefined))
    } else if (prevEmpty !== 0) {
      updates.push(
        dbUpdate<SourceRow>(
          'sources',
          s.id,
          { scrape_config: { ...cfg, _empty_runs: 0 }, last_fetch_error: null },
          embedToken,
        ).catch(() => undefined),
      )
    }
  }
  await Promise.all(updates)
}

function cleanShortSummary(raw: string | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/\s*[·•|-]?\s*\d+\s*(?:min(?:ute)?s?)\s*read\s*\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260)
}

async function summarizeBatch(
  items: Raw[],
  niche: string,
  embedToken: string,
): Promise<{ summaries: string[]; credits: number }> {
  const prompt = [
    `You are summarizing news items for a feed about: "${niche}".`,
    'For each item, write ONE crisp sentence (max 28 words) using ONLY facts present in the provided title + snippet.',
    'Do NOT invent details (launches, dates, numbers, quotes) that are not in the input.',
    'If the snippet is empty or thin, just paraphrase the title — better short than fabricated.',
    'No marketing fluff. No "Click here". Plain prose.',
    'Return ONLY a JSON array of strings in input order. No prose outside the array.',
    '',
    'Items:',
    ...items.map((it, i) => `${i}: ${it.title} — ${cleanShortSummary(it.summary).slice(0, 240)}`),
  ].join('\n')

  const result = await callGateway(
    [{ role: 'user', content: prompt }],
    embedToken,
    { category: 'chat', tier: 'fast' },
  )

  return {
    summaries: parseSummaries(result.content, items.length, items.map((it) => cleanShortSummary(it.summary))),
    credits: result.credits_charged,
  }
}

function parseSummaries(text: string, expected: number, fallback: string[]): string[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return fallback
  try {
    const arr = JSON.parse(m[0]) as unknown[]
    return Array.from({ length: expected }, (_, i) => {
      const v = arr[i]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 320)
      return fallback[i] ?? ''
    })
  } catch {
    return fallback
  }
}
