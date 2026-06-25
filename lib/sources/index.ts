import type { FetchedItem, SourceRow, ChannelRow } from '../types'
import { fetchRss } from './rss'
import { fetchHn } from './hn'
import { fetchReddit } from './reddit'
import { fetchArxiv } from './arxiv'
import { fetchWeb } from './web'
import { fetchSocial } from './social-fetch'

const SOCIAL_TYPES = new Set<SourceRow['type']>(['x', 'ig', 'yt', 'fb', 'linkedin'])

// embedToken authenticates gateway calls. Social sources scrape via the gateway
// (owner-only), so the token is REQUIRED for them — the pipeline passes the cron
// task token (owner identity) or the owner's embed token.
export async function fetchSource(
  source: SourceRow,
  channel: ChannelRow,
  embedToken?: string,
): Promise<FetchedItem[]> {
  const cfg = source.scrape_config ?? {}
  switch (source.type) {
    case 'rss':
      return fetchRss((cfg.feed_url as string) ?? source.url!)
    case 'hn':
      return fetchHn(cfg.query as string | undefined)
    case 'reddit':
      return fetchReddit(source.handle!, (cfg.sort as 'top' | 'hot' | 'new') ?? 'top')
    case 'arxiv':
      return fetchArxiv({ category: cfg.category as string, query: cfg.query as string })
    case 'web':
      return fetchWeb(source.url!, {
        list_selector: cfg.list_selector as string,
        tier: cfg.tier as 'cheerio' | 'jina' | 'firecrawl',
        firecrawl_key: channel.scraper_byok_key ?? undefined,
      })
    case 'x':
    case 'ig':
    case 'yt':
    case 'fb':
    case 'linkedin': {
      if (!embedToken) throw new Error(`${source.type} source needs a gateway token (owner-only scrape)`)
      const handle = source.handle ?? source.url ?? ''
      return fetchSocial(source.type, handle, cfg, embedToken)
    }
    default:
      throw new Error(`unknown source type: ${source.type}`)
  }
}

export { detectSource } from './detect'
export { SOCIAL_TYPES }
