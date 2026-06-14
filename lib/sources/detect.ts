import type { DetectionResult, SourceType } from '../types'
import { autodiscoverRss } from './rss'
import { cheerioExtract, jinaExtract } from './web'
import { rsshubFor } from './rsshub'

interface PlatformMatch {
  type: SourceType
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  tier: 'platform' | 'rss'
  display?: string
}

// Wraps a social handle into a normalized RSS source backed by RSSHub.
// This collapses x/ig/yt/reddit into the same rss fetch path, so the
// pipeline only has one fetcher to maintain.
function asRss(platform: 'yt' | 'x' | 'ig' | 'reddit', handle: string): PlatformMatch | null {
  const m = rsshubFor(platform, handle)
  if (!m) return null
  return {
    type: 'rss',
    url: m.rssUrl,
    handle,
    scrape_config: { feed_url: m.rssUrl, via: 'rsshub', original_platform: platform },
    tier: 'rss',
    display: m.display,
  }
}

function matchKnownPlatform(input: string): PlatformMatch | null {
  const url = input.trim()
  const ytChan = url.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)([^/?#]+)/i)
  if (ytChan) return asRss('yt', ytChan[1])

  const tw = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i)
  if (tw && tw[1] !== 'search') return asRss('x', tw[1])

  const ig = url.match(/instagram\.com\/([^/?#]+)/i)
  if (ig) return asRss('ig', ig[1])

  // Facebook has no reliable public RSS path even via RSSHub. Surface but mark needs_byok.
  const fb = url.match(/facebook\.com\/([^/?#]+)/i)
  if (fb) return { type: 'fb', handle: fb[1], scrape_config: {}, tier: 'platform' }

  // LinkedIn posts/profiles aren't reliably available via RSSHub either.
  // Keep platform type so user can BYOK or skip.
  const liCo = url.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i)
  if (liCo) return { type: 'linkedin', handle: liCo[1], scrape_config: { kind: 'company' }, tier: 'platform' }
  const liIn = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (liIn) return { type: 'linkedin', handle: liIn[1], scrape_config: { kind: 'profile' }, tier: 'platform' }
  const liPosts = url.match(/linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)\/(?:recent-activity|posts)/i)
  if (liPosts) return { type: 'linkedin', handle: liPosts[1], scrape_config: { kind: 'profile' }, tier: 'platform' }
  const liBare = url.match(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/([^/?#]+)\/?$/i)
  if (liBare && !/^(feed|login|signup|jobs|learning|notifications|messaging|mynetwork|search|help)$/i.test(liBare[1])) {
    return { type: 'linkedin', handle: liBare[1], scrape_config: { kind: 'profile' }, tier: 'platform' }
  }

  const reddit = url.match(/reddit\.com\/r\/([^/?#]+)/i)
  if (reddit) return asRss('reddit', reddit[1])

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
    const m = rsshubFor('x', input.slice(1))
    if (m) return { type: 'rss', url: m.rssUrl, handle: input.slice(1), scrape_config: { feed_url: m.rssUrl, via: 'rsshub', original_platform: 'x' }, tier: 'rss' }
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

  const hasFirecrawl = !!process.env.FIRECRAWL_API_KEY
  return {
    type: 'web',
    url,
    scrape_config: { tier: 'firecrawl' },
    tier: 'firecrawl_required',
    needs_byok: !hasFirecrawl,
  }
}
