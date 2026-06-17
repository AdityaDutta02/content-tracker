import type { FetchedItem, SourceRow, ChannelRow } from '../types'
import { fetchRss } from './rss'
import { fetchHn } from './hn'
import { fetchReddit } from './reddit'
import { fetchArxiv } from './arxiv'
import { fetchWeb } from './web'
import { apifyRun } from './apify'
import { fetchSocial, type SocialPlatform } from './social-fetch'
import { dbUpdate } from '../db'

// embedToken (optional) lets the social path persist the chosen fetch tier back
// to scrape_config so later runs skip dead tiers. Best-effort; never blocks items.
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
    case 'yt': {
      const handle = source.handle ?? source.url ?? ''
      const res = await fetchSocial(source.type as SocialPlatform, handle, cfg, channel)
      if (res.configPatch && embedToken) {
        const changed = Object.entries(res.configPatch).some(([k, v]) => cfg[k] !== v)
        if (changed) {
          await dbUpdate('sources', source.id, { scrape_config: { ...cfg, ...res.configPatch } }, embedToken).catch(
            () => undefined,
          )
        }
      }
      return res.items
    }
    case 'fb':
    case 'linkedin': {
      // No reliable free tier — Apify BYOK only.
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
