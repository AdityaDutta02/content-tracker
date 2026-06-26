// Single source of truth for per-source gateway credit costs, used everywhere we
// show the user what a refresh costs. Mirrors the gateway's flat per-(source,op)
// pricing verified 2026-06-26 — keep in sync with lib/sources/social-fetch.ts.
//
// Only IG/X scrape through the paid gateway. Everything else (rss/hn/reddit/
// arxiv/web and YouTube via native RSS) is free. The AI summary is one cheap
// chat/fast call per run.

/** Gateway credits charged per refresh, by source type. 0 = free fetch path. */
export const SOURCE_CREDIT_COST: Record<string, number> = {
  ig: 3, // instagram.posts (list op)
  x: 2, // twitter.tweets (single-entity op)
  // free fetch paths — listed for completeness so callers can rely on the map:
  rss: 0,
  hn: 0,
  reddit: 0,
  arxiv: 0,
  web: 0,
  yt: 0,
  fb: 0,
  linkedin: 0,
}

/** Credits for one AI summary call (callGateway chat/fast = gpt-4o-mini). */
export const AI_SUMMARY_COST = 1

/** Credits a single source of this type costs per refresh (0 if free). */
export function costForSourceType(type: string): number {
  return SOURCE_CREDIT_COST[type] ?? 0
}

/** Human label for a source's per-refresh cost: "Free" or "3 cr / refresh". */
export function costLabel(type: string): string {
  const c = costForSourceType(type)
  return c === 0 ? 'Free' : `${c} cr / refresh`
}

/**
 * Estimated credits one daily refresh of this channel costs: the sum of its paid
 * social sources plus the single AI summary call. Free sources add nothing. This
 * is an estimate — a cross-user cache hit can make a scrape cheaper (1 cr), and a
 * run with fewer than 3 items skips the AI call entirely.
 */
export function dailyCostEstimate(sourceTypes: string[]): number {
  const scrape = sourceTypes.reduce((sum, t) => sum + costForSourceType(t), 0)
  return scrape + AI_SUMMARY_COST
}
