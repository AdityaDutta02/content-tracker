// Social fetch — managed gateway path for IG / X.
//
// The gateway scrapes IG / X behind one normalized shape (ScrapeCreators
// primary, Apify failover, managed for us). No more tier probing, dead RSSHub
// mirrors, BYOK keys, or hand-rolled actor inputs — one call per source,
// normalized post out. Scraping is owner-only, so the caller must pass an
// owner-scoped token (cron task token or owner embed token).
//
// YouTube is NOT here — it's fetched via free public RSS (see lib/sources/youtube.ts).
// FB / LinkedIn are intentionally NOT scraped by this app (see lib/sources/limits.ts).
import type { FetchedItem, SourceType } from '../types'
import { instagram, twitter, type SocialPost, type SocialList } from '../scrape-sdk'

// The handle-based social source types the pipeline counts toward its social
// quota. YT is included for capping/detection, but is fetched via native RSS,
// not this gateway path.
export type SocialPlatform = 'x' | 'ig' | 'yt'

const LIST_LIMIT = 25

function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, '')
    .replace(/\/+$/, '')
}

/** Map one normalized gateway post to the pipeline's FetchedItem shape. */
export function mapSocialPost(type: SourceType, p: SocialPost): FetchedItem {
  const text = (p.text ?? '').trim()
  const firstLine = text.split('\n').find((l) => l.trim()) ?? text
  return {
    external_id: `${type}:${p.id}`,
    title: (firstLine || text).slice(0, 200) || `${type} post`,
    url: p.url ?? '',
    summary: text.slice(0, 500),
    image_url: p.mediaUrls?.[0],
    published_at: p.createdAt ?? undefined,
    engagement: {
      likes: p.likes ?? undefined,
      comments: p.comments ?? undefined,
      reposts: p.shares ?? undefined,
      views: p.views ?? undefined,
    },
    raw: p as unknown as Record<string, unknown>,
  }
}

function mapList(type: SourceType, list: SocialList): FetchedItem[] {
  return (list.items ?? []).map((p) => mapSocialPost(type, p))
}

/** Items plus the exact gateway credits the scrape charged (for cost transparency). */
export interface SocialFetchResult {
  items: FetchedItem[]
  credits: number
}

/**
 * Fetch recent items for a gateway-scraped social source (IG/X). `handle` is the
 * account handle. Returns the items and the exact `credits_charged` the gateway
 * billed, so the pipeline can record a truthful per-run cost. Throws on gateway
 * failure — the pipeline records it. YouTube is fetched separately via native RSS
 * (lib/sources/youtube.ts), not here.
 */
export async function fetchSocial(
  type: SourceType,
  handle: string,
  token: string,
): Promise<SocialFetchResult> {
  const opts = { limit: LIST_LIMIT }
  const h = cleanHandle(handle)
  switch (type) {
    case 'ig': {
      const { data, credits_charged } = await instagram.posts(h, opts, token)
      return { items: mapList('ig', data), credits: credits_charged }
    }
    case 'x': {
      const { data, credits_charged } = await twitter.tweets(h, opts, token)
      return { items: mapList('x', data), credits: credits_charged }
    }
    default:
      throw new Error(`fetchSocial: unsupported social type ${type} (yt uses native RSS)`)
  }
}
