// Social fetch — single managed path via the Terminal AI gateway.
//
// The gateway scrapes IG / X / YT behind one normalized shape (ScrapeCreators
// primary, Apify failover, managed for us). No more tier probing, dead RSSHub
// mirrors, BYOK keys, or hand-rolled actor inputs — one call per source,
// normalized post out. Scraping is owner-only, so the caller must pass an
// owner-scoped token (cron task token or owner embed token).
//
// FB / LinkedIn are intentionally NOT scraped by this app (see lib/sources/limits.ts).
import type { FetchedItem, SourceType } from '../types'
import { instagram, youtube, twitter, type SocialPost, type SocialList } from '../scrape-sdk'

// The handle-based social sources the pipeline counts toward its social quota.
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

/**
 * Fetch recent items for a social source (IG/X/YT) via the gateway. `handle` is
 * the account handle. Throws on gateway failure — the pipeline records it.
 */
export async function fetchSocial(
  type: SourceType,
  handle: string,
  token: string,
): Promise<FetchedItem[]> {
  const opts = { limit: LIST_LIMIT }
  const h = cleanHandle(handle)
  switch (type) {
    case 'ig': {
      const { data } = await instagram.posts(h, opts, token)
      return mapList('ig', data)
    }
    case 'x': {
      const { data } = await twitter.tweets(h, opts, token)
      return mapList('x', data)
    }
    case 'yt': {
      // No "channel videos" gateway op — search by the channel handle returns
      // that channel's recent uploads, newest-first.
      const { data } = await youtube.search(h, opts, token)
      return mapList('yt', data)
    }
    default:
      throw new Error(`fetchSocial: unsupported social type ${type}`)
  }
}
