// Pipeline orchestrator: fetch all sources → dedupe + cluster + rank → persist top N
import type { ChannelRow, SourceRow, FetchedItem } from './types'
import { fetchSource } from './sources'
import { rankItems } from './rank'
import { canonicalizeUrl } from './canonical'
import { dbList, dbInsert, dbUpdate } from './db'

const TOP_N = 10

export interface RunResult {
  status: 'ok' | 'partial' | 'failed'
  item_count: number
  credits_used: number
  errors: Array<{ source_id: string; error: string }>
}

export async function runChannelPipeline(
  channel: ChannelRow,
  embedToken: string,
  trigger: 'cron' | 'manual',
): Promise<RunResult> {
  const sources = await dbList<SourceRow>('sources', { channel_id: channel.id, enabled: 'true' }, embedToken)
  const today = new Date().toISOString().slice(0, 10)
  const errors: RunResult['errors'] = []

  // 1. fetch all sources in parallel (with per-source error isolation)
  const raw: Array<FetchedItem & { source_id: string }> = []
  await Promise.all(
    sources.map(async (s) => {
      try {
        const items = await fetchSource(s, channel)
        for (const it of items) raw.push({ ...it, source_id: s.id })
        await dbUpdate('sources', s.id, { last_fetch_at: new Date().toISOString(), last_fetch_error: null }, embedToken)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push({ source_id: s.id, error: msg })
        await dbUpdate('sources', s.id, { last_fetch_at: new Date().toISOString(), last_fetch_error: msg }, embedToken).catch(() => undefined)
      }
    }),
  )

  // 2. canonicalize URLs
  for (const r of raw) r.url = canonicalizeUrl(r.url || '')

  // 3. fetch already-seen canonical URLs from last 7 days
  const recentItems = await dbList<{ canonical_url: string }>(
    'items',
    { channel_id: channel.id },
    embedToken,
  )
  const alreadySeen = new Set(recentItems.map((i) => i.canonical_url))

  // 4. rank
  const { ranked, credits_used } = await rankItems({
    channel: { niche: channel.niche, smart_mode: channel.smart_mode },
    raw,
    topN: TOP_N,
    embedToken,
    alreadySeen,
  })

  // 5. persist
  let inserted = 0
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    try {
      await dbInsert(
        'items',
        {
          channel_id: channel.id,
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
          run_date: today,
          raw_json: r.raw ?? null,
        },
        embedToken,
      )
      inserted++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push({ source_id: r.source_id, error: `insert: ${msg}` })
    }
  }

  // 6. update channel + log run
  await dbUpdate<ChannelRow>('channels', channel.id, { last_run_date: today }, embedToken).catch(() => undefined)

  const status: RunResult['status'] = errors.length === 0 ? 'ok' : inserted > 0 ? 'partial' : 'failed'
  await dbInsert(
    'runs',
    {
      channel_id: channel.id,
      trigger,
      status,
      item_count: inserted,
      credits_used,
      errors: errors.length ? errors : null,
    },
    embedToken,
  ).catch(() => undefined)

  return { status, item_count: inserted, credits_used, errors }
}
