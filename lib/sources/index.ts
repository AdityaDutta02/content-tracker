import type { FetchedItem, SourceRow, ChannelRow } from '../types'
import { fetchRss } from './rss'
import { fetchHn } from './hn'
import { fetchReddit } from './reddit'
import { fetchArxiv } from './arxiv'
import { fetchWeb } from './web'
import { apifyRun } from './apify'

export async function fetchSource(source: SourceRow, channel: ChannelRow): Promise<FetchedItem[]> {
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
    case 'fb':
    case 'yt':
    case 'linkedin': {
      const key = channel.scraper_byok_key ?? process.env.APIFY_API_KEY
      if (!key) throw new Error(`${source.type} source needs Apify BYOK key (channel.scraper_byok_key or APIFY_API_KEY env)`)
      return apifyRun(source.type, source.handle ?? source.url ?? '', key, {
        actor_id: cfg.actor_id as string,
        input: cfg.input as Record<string, unknown> | undefined,
        kind: cfg.kind as string | undefined,
      })
    }
    default:
      throw new Error(`unknown source type: ${source.type}`)
  }
}

export { detectSource } from './detect'
