// Ranking engine: pre-filter → local cluster → single batched AI call → composite score → top N
import type { FetchedItem } from '../types'
import { callGateway } from '../terminal-ai'
import { clusterItems } from './cluster'

export interface Candidate extends FetchedItem {
  source_id: string
  cluster_id: string
  cluster_size: number
  ai_relevance: number
  final_score: number
}

interface RankInput {
  channel: { niche: string; smart_mode: boolean }
  raw: Array<FetchedItem & { source_id: string }>
  topN: number
  embedToken: string
  alreadySeen: Set<string>
}

interface RankOutput {
  ranked: Candidate[]
  credits_used: number
}

const PRE_TOP = 30 // only AI-score top 30 candidates by recency+engagement

function engagementScore(item: FetchedItem): number {
  const e = item.engagement ?? {}
  const sum = (e.likes ?? 0) + (e.upvotes ?? 0) + 2 * (e.comments ?? 0) + 0.5 * (e.reposts ?? 0) + 0.01 * (e.views ?? 0)
  return Math.log1p(sum)
}

function recencyScore(item: FetchedItem, now: number): number {
  if (!item.published_at) return 0.3
  const ageH = Math.max(0, (now - new Date(item.published_at).getTime()) / 3_600_000)
  return Math.exp(-ageH / 24) // ~1.0 at now, 0.37 at 24h, 0.14 at 48h
}

export async function rankItems(input: RankInput): Promise<RankOutput> {
  const now = Date.now()
  let credits = 0

  // 1. drop already-seen
  const fresh = input.raw.filter((i) => !input.alreadySeen.has(canonical(i.url)))
  if (fresh.length === 0) return { ranked: [], credits_used: 0 }

  // 2. local cluster
  const assigns = clusterItems(fresh)

  // 3. pre-rank by recency+engagement, take top PRE_TOP
  const preScored = fresh.map((it, idx) => ({
    item: it,
    cluster_id: assigns[idx].cluster_id,
    cluster_size: assigns[idx].size,
    pre: 0.6 * recencyScore(it, now) + 0.4 * engagementScore(it),
  }))
  preScored.sort((a, b) => b.pre - a.pre)
  const candidates = preScored.slice(0, PRE_TOP)

  // 4. single AI call for relevance scoring (skip if dry run)
  let aiScores: number[] = candidates.map(() => 0.5)
  if (candidates.length >= 8) {
    const result = await scoreBatch(candidates.map((c) => c.item.title), input.channel.niche, input.channel.smart_mode, input.embedToken)
    aiScores = result.scores
    credits = result.credits
  }

  // 5. composite score
  const composited = candidates.map((c, i) => {
    const eng = engagementScore(c.item)
    const rec = recencyScore(c.item, now)
    const rel = aiScores[i]
    const clu = Math.log1p(c.cluster_size) / Math.log(5)
    const final = 0.4 * rel + 0.3 * eng / 4 + 0.2 * rec + 0.1 * Math.min(1, clu)
    return { ...c, ai_relevance: rel, final, eng }
  })
  composited.sort((a, b) => b.final - a.final)

  // 6. take top N, but only one per cluster
  const seenClusters = new Set<string>()
  const ranked: Candidate[] = []
  for (const c of composited) {
    if (seenClusters.has(c.cluster_id)) continue
    seenClusters.add(c.cluster_id)
    const it = c.item as FetchedItem & { source_id: string }
    ranked.push({
      ...it,
      source_id: it.source_id,
      cluster_id: c.cluster_id,
      cluster_size: c.cluster_size,
      ai_relevance: c.ai_relevance,
      final_score: c.final,
    })
    if (ranked.length >= input.topN) break
  }

  return { ranked, credits_used: credits }
}

async function scoreBatch(
  titles: string[],
  niche: string,
  smart: boolean,
  embedToken: string,
): Promise<{ scores: number[]; credits: number }> {
  const prompt = [
    `Channel niche: "${niche}"`,
    'Score each item 0.0-1.0 by relevance to the niche. 0.0 = unrelated, 1.0 = perfect fit.',
    'Return ONLY a JSON array of numbers, in input order. No prose.',
    '',
    'Items:',
    ...titles.map((t, i) => `${i}: ${t}`),
  ].join('\n')

  const result = await callGateway([{ role: 'user', content: prompt }], embedToken, {
    category: 'chat',
    tier: smart ? 'good' : 'fast',
  })

  const scores = parseScores(result.content, titles.length)
  return { scores, credits: result.credits_charged }
}

function parseScores(text: string, expected: number): number[] {
  const match = text.match(/\[[\s\S]*?\]/)
  if (!match) return Array(expected).fill(0.5)
  try {
    const arr = JSON.parse(match[0]) as unknown[]
    return arr.map((v) => {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5
    }).concat(Array(Math.max(0, expected - arr.length)).fill(0.5)).slice(0, expected)
  } catch {
    return Array(expected).fill(0.5)
  }
}

function canonical(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.host = u.host.toLowerCase().replace(/^www\./, '')
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return url
  }
}
