import type { DetectionResult, SourceType } from '../types'
import { autodiscoverRss } from './rss'
import { cheerioExtract, jinaExtract } from './web'

interface PlatformMatch {
  type: SourceType
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  tier: 'platform'
}

function matchKnownPlatform(input: string): PlatformMatch | null {
  const url = input.trim()
  const ytChan = url.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)([^/?#]+)/i)
  if (ytChan) return { type: 'yt', handle: ytChan[1], scrape_config: {}, tier: 'platform' }

  const tw = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i)
  if (tw && tw[1] !== 'search') return { type: 'x', handle: tw[1], scrape_config: {}, tier: 'platform' }

  const ig = url.match(/instagram\.com\/([^/?#]+)/i)
  if (ig) return { type: 'ig', handle: ig[1], scrape_config: {}, tier: 'platform' }

  const fb = url.match(/facebook\.com\/([^/?#]+)/i)
  if (fb) return { type: 'fb', handle: fb[1], scrape_config: {}, tier: 'platform' }

  const reddit = url.match(/reddit\.com\/r\/([^/?#]+)/i)
  if (reddit) return { type: 'reddit', handle: reddit[1], scrape_config: { sort: 'top' }, tier: 'platform' }

  if (/news\.ycombinator\.com/i.test(url)) {
    const q = url.match(/[?&]q=([^&]+)/)
    return { type: 'hn', scrape_config: q ? { query: decodeURIComponent(q[1]) } : {}, tier: 'platform' }
  }

  const arxiv = url.match(/arxiv\.org\/(?:list|abs|rss)\/([a-z\-.]+)/i)
  if (arxiv) return { type: 'arxiv', scrape_config: { category: arxiv[1] }, tier: 'platform' }

  return null
}

export async function detectSource(input: string): Promise<DetectionResult> {
  const known = matchKnownPlatform(input)
  if (known) return known

  if (/^@[A-Za-z0-9_]+$/.test(input)) {
    return { type: 'x', handle: input.slice(1), scrape_config: {}, tier: 'platform' }
  }

  let url = input
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  const feed = await autodiscoverRss(url)
  if (feed) {
    return { type: 'rss', url: feed, scrape_config: { feed_url: feed }, tier: 'rss' }
  }

  try {
    const items = await cheerioExtract(url)
    if (items.length >= 3) {
      return {
        type: 'web',
        url,
        scrape_config: { tier: 'cheerio' },
        tier: 'cheerio',
        sample: { title: items[0].title, url: items[0].url },
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const items = await jinaExtract(url)
    if (items.length >= 3) {
      return {
        type: 'web',
        url,
        scrape_config: { tier: 'jina' },
        tier: 'jina',
        sample: { title: items[0].title, url: items[0].url },
      }
    }
  } catch {
    /* ignore */
  }

  return { type: 'web', url, scrape_config: { tier: 'firecrawl' }, tier: 'firecrawl_required', needs_byok: true }
}
