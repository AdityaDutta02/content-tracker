import type { FetchedItem, SourceRow, ChannelRow } from '../types'
import { fetchRss } from './rss'
import { fetchHn } from './hn'
import { fetchReddit } from './reddit'
import { fetchArxiv } from './arxiv'
import { fetchWeb } from './web'
import { fetchSocial } from './social-fetch'
import { fetchYoutubeNative } from './youtube'

// Items plus the exact gateway credits this fetch charged. Free fetch paths
// (rss/hn/reddit/arxiv/web/yt) report 0; only IG/X gateway scrapes cost credits.
export interface SourceFetchResult {
  items: FetchedItem[]
  credits: number
}

const free = (items: FetchedItem[]): SourceFetchResult => ({ items, credits: 0 })

// embedToken authenticates gateway calls. IG/X scrape via the gateway
// (owner-only), so the token is REQUIRED for them — the pipeline passes the cron
// task token (owner identity) or the owner's embed token. YouTube is fetched via
// its free public RSS feed instead, so it needs no token and burns no credits.
export async function fetchSource(
  source: SourceRow,
  channel: ChannelRow,
  embedToken?: string,
): Promise<SourceFetchResult> {
  const cfg = source.scrape_config ?? {}
  switch (source.type) {
    case 'rss':
      return free(await fetchRss((cfg.feed_url as string) ?? source.url!))
    case 'hn':
      return free(await fetchHn(cfg.query as string | undefined))
    case 'reddit':
      return free(await fetchReddit(source.handle!, (cfg.sort as 'top' | 'hot' | 'new') ?? 'top'))
    case 'arxiv':
      return free(await fetchArxiv({ category: cfg.category as string, query: cfg.query as string }))
    case 'web':
      return free(
        await fetchWeb(source.url!, {
          list_selector: cfg.list_selector as string,
          tier: cfg.tier as 'cheerio' | 'jina' | 'firecrawl',
          firecrawl_key: channel.scraper_byok_key ?? undefined,
        }),
      )
    case 'yt': {
      // Free public RSS — no gateway, no credits. Resolve the channel id once
      // and cache it back so later runs skip the resolution HTTP hop.
      const handle = source.handle ?? source.url ?? ''
      const { items, channelId } = await fetchYoutubeNative(handle, cfg.channel_id as string | undefined)
      if (channelId && channelId !== cfg.channel_id) {
        source.scrape_config = { ...cfg, channel_id: channelId, feed_url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` }
      }
      return free(items)
    }
    case 'x':
    case 'ig': {
      if (!embedToken) throw new Error(`${source.type} source needs a gateway token (owner-only scrape)`)
      const handle = source.handle ?? source.url ?? ''
      // fetchSocial already returns { items, credits } from the gateway charge.
      return fetchSocial(source.type, handle, embedToken)
    }
    case 'fb':
    case 'linkedin':
      // Not scraped by this app (too pricey / low signal) — see lib/sources/limits.ts.
      return free([])
    default:
      throw new Error(`unknown source type: ${source.type}`)
  }
}

export { detectSource } from './detect'
