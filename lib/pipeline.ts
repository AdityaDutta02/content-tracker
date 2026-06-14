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

const TOP_N = 12
const RECENT_RUNS_FOR_DEDUPE = 7

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
        const items = await withTimeout(fetchSource(s, channel), ms, `source ${s.type}:${s.id}`)
        for (const it of items) raw.push({ ...it, source_id: s.id })
      } catch (e) {
        errors.push({ source_id: s.id, error: e instanceof Error ? e.message : String(e) })
      }
    }),
  )

  for (const r of raw) r.url = canonicalizeUrl(r.url || '')

  const recentRuns = await dbList<RunRow>('runs', { channel_id: channel.id }, embedToken)
  const seenUrls = new Set<string>()
  recentRuns
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1))
    .slice(0, RECENT_RUNS_FOR_DEDUPE)
    .forEach((r) => (r.items_json ?? []).forEach((it) => seenUrls.add(it.canonical_url)))

  const fresh = raw.filter((r) => r.url && !seenUrls.has(r.url))

  // In-run dedupe by canonical URL (keep first seen, which carries source_id).
  const seenThisRun = new Set<string>()
  const deduped: Raw[] = []
  for (const it of fresh) {
    if (seenThisRun.has(it.url)) continue
    seenThisRun.add(it.url)
    deduped.push(it)
  }

  // Chronological newest-first. Items with no published_at sink to bottom.
  deduped.sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0
    return tb - ta
  })

  // Per-source diversity cap so one chatty feed cannot dominate the run.
  // Cap = max(2, ceil(TOP_N / activeSourceCount)) but at least 2 to allow
  // small libraries (few sources) to still fill the page.
  const sourcesWithItems = new Set(deduped.map((d) => d.source_id)).size || 1
  const perSourceCap = Math.max(2, Math.ceil(TOP_N / sourcesWithItems))
  const perSourceCount = new Map<string, number>()
  const top: Raw[] = []
  for (const it of deduped) {
    const n = perSourceCount.get(it.source_id) ?? 0
    if (n >= perSourceCap) continue
    perSourceCount.set(it.source_id, n + 1)
    top.push(it)
    if (top.length >= TOP_N) break
  }
  // Fallback: if cap was too tight and we have headroom, top up from leftovers.
  if (top.length < TOP_N) {
    const inTop = new Set(top.map((t) => t.url))
    for (const it of deduped) {
      if (top.length >= TOP_N) break
      if (!inTop.has(it.url)) top.push(it)
    }
  }

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

  const today = new Date().toISOString().slice(0, 10)
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
    'For each item, write ONE crisp sentence (max 28 words) capturing the substance — what happened, who, why it matters.',
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
