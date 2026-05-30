// Pipeline orchestrator. Slim DB profile: ~5 gateway calls per run.
//   1× list sources
//   1× list recent runs (for cross-day dedupe)
//   1× LLM ranking call (chat fast)
//   1× insert runs row (with top-N items packed inline as JSONB)
//   1× update channels.last_run_date
// No per-source updates and no per-item inserts — those previously caused viewer rate-limit blowups.
import type { ChannelRow, SourceRow, FetchedItem } from './types'
import { fetchSource } from './sources'
import { rankItems, type Candidate } from './rank'
import { canonicalizeUrl } from './canonical'
import { dbList, dbInsert, dbUpdate } from './db'

const TOP_N = 10
const RECENT_RUNS_FOR_DEDUPE = 7  // look back N most recent runs to dedupe by canonical URL

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

export async function runChannelPipeline(
  channel: ChannelRow,
  embedToken: string,
  trigger: 'cron' | 'manual',
): Promise<RunResult> {
  const errors: RunResult['errors'] = []

  // CALL 1: list enabled sources
  const allSources = await dbList<SourceRow>('sources', { channel_id: channel.id }, embedToken)
  const sources = allSources.filter((s) => s.enabled !== false)
  if (sources.length === 0) {
    return { status: 'failed', item_count: 0, credits_used: 0, errors: [{ source_id: 'none', error: 'no enabled sources' }] }
  }

  // Source fetches (HTTP, NOT gateway calls — no rate limit)
  const raw: Array<FetchedItem & { source_id: string }> = []
  await Promise.all(
    sources.map(async (s) => {
      try {
        const items = await fetchSource(s, channel)
        for (const it of items) raw.push({ ...it, source_id: s.id })
      } catch (e) {
        errors.push({ source_id: s.id, error: e instanceof Error ? e.message : String(e) })
      }
    }),
  )

  // canonicalize URLs in-memory
  for (const r of raw) r.url = canonicalizeUrl(r.url || '')

  // CALL 2: list recent runs for dedupe (canonical URLs from past N runs)
  const recentRuns = await dbList<RunRow>('runs', { channel_id: channel.id }, embedToken)
  const seenUrls = new Set<string>()
  recentRuns
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1))
    .slice(0, RECENT_RUNS_FOR_DEDUPE)
    .forEach((r) => (r.items_json ?? []).forEach((it) => seenUrls.add(it.canonical_url)))

  // CALL 3: LLM ranking (only one call regardless of source count)
  const { ranked, credits_used } = await rankItems({
    channel: { niche: channel.niche, smart_mode: channel.smart_mode },
    raw,
    topN: TOP_N,
    embedToken,
    alreadySeen: seenUrls,
  })

  // Pack items inline for the runs row
  const itemsJson = ranked.map((r: Candidate, i) => ({
    source_id: r.source_id,
    external_id: r.external_id,
    canonical_url: canonicalizeUrl(r.url),
    cluster_id: r.cluster_id,
    title: r.title,
    url: r.url,
    summary: r.summary ?? null,
    published_at: r.published_at ?? null,
    engagement: r.engagement ?? {},
    ai_relevance: r.ai_relevance,
    final_score: r.final_score,
    rank: i + 1,
  }))

  const today = new Date().toISOString().slice(0, 10)
  const status: RunResult['status'] = errors.length === 0 ? 'ok' : ranked.length > 0 ? 'partial' : 'failed'

  // CALL 4: insert runs row with items inline (replaces N per-item inserts)
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

  // CALL 5: bump channel.last_run_date (non-fatal)
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
