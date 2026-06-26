// Native YouTube RSS adapter. No API key, no gateway credits.
// YouTube ships a per-channel Atom feed at
//   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
// Engagement (views/likes) is intentionally blank — native RSS omits it.
import type { FetchedItem } from '../types'
import { fetchRss } from './rss'

const UC_ID = /^UC[\w-]{20,}$/
const channelFeedUrl = (channelId: string): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

/** True when the string is already a canonical UC… channel id. */
export function isChannelId(handle: string): boolean {
  return UC_ID.test(handle.trim().replace(/^@/, ''))
}

// Resolve a @handle / custom URL slug to a UC… channel id by scraping the
// public channel page once. Caller should cache the result in
// scrape_config.channel_id so later runs skip this network hop.
export async function resolveYoutubeChannelId(handle: string): Promise<string | null> {
  const h = handle.trim().replace(/^@/, '')
  if (!h) return null
  if (UC_ID.test(h)) return h
  const candidates = [
    `https://www.youtube.com/@${h}`,
    `https://www.youtube.com/c/${h}`,
    `https://www.youtube.com/user/${h}`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'ContentTrackerBot/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const html = await res.text()
      const m =
        html.match(/"channelId":"(UC[\w-]+)"/) ??
        html.match(/<meta[^>]+itemprop="(?:channelId|identifier)"[^>]+content="(UC[\w-]+)"/i) ??
        html.match(/channel\/(UC[\w-]+)/)
      if (m) return m[1]
    } catch {
      /* try next candidate */
    }
  }
  return null
}

export interface YoutubeNativeResult {
  items: FetchedItem[]
  channelId: string
}

// Fetch a channel's latest uploads via the native RSS feed. Pass a cached
// channelId to skip resolution. Throws if the handle cannot be resolved.
export async function fetchYoutubeNative(
  handleOrId: string,
  knownChannelId?: string,
): Promise<YoutubeNativeResult> {
  const channelId = knownChannelId && UC_ID.test(knownChannelId)
    ? knownChannelId
    : await resolveYoutubeChannelId(handleOrId)
  if (!channelId) throw new Error(`youtube: could not resolve channel id for "${handleOrId}"`)
  const items = await fetchRss(channelFeedUrl(channelId))
  return { items, channelId }
}
