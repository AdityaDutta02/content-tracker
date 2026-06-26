import type { DetectionResult, SourceType } from '../types'
import { autodiscoverRss } from './rss'
import { cheerioExtractDetailed, jinaExtract } from './web'
import { scoreSample } from './quality'
import type { FetchedItem } from '../types'
import { rsshubFor } from './rsshub'
import { resolveYoutubeChannelId } from './youtube'
import type { SocialPlatform } from './social-fetch'

interface KnownMatch {
  // Social handles are probed asynchronously by detectSocial; everything else
  // resolves synchronously to a DetectionResult.
  social?: { platform: SocialPlatform; handle: string }
  result?: DetectionResult
}

function plain(result: DetectionResult): KnownMatch {
  return { result }
}

function matchKnownPlatform(input: string): KnownMatch | null {
  const url = input.trim()
  const ytChan = url.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)([^/?#]+)/i)
  if (ytChan) return { social: { platform: 'yt', handle: ytChan[1] } }

  const tw = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i)
  if (tw && tw[1] !== 'search') return { social: { platform: 'x', handle: tw[1] } }

  const ig = url.match(/instagram\.com\/([^/?#]+)/i)
  if (ig) return { social: { platform: 'ig', handle: ig[1] } }

  // FB / LinkedIn are not scraped by this app (see lib/sources/limits.ts) — fall
  // through so they aren't suggested as addable sources.

  const reddit = url.match(/reddit\.com\/r\/([^/?#]+)/i)
  if (reddit) {
    const m = rsshubFor('reddit', reddit[1])
    if (m) return plain({ type: 'rss', url: m.rssUrl, handle: reddit[1], scrape_config: { feed_url: m.rssUrl, via: 'reddit', original_platform: 'reddit' }, tier: 'rss', cost: 'free', health: 'ok' })
  }

  if (/news\.ycombinator\.com/i.test(url)) {
    const q = url.match(/[?&]q=([^&]+)/)
    return plain({ type: 'hn', scrape_config: q ? { query: decodeURIComponent(q[1]) } : {}, tier: 'platform', cost: 'free' })
  }

  const arxiv = url.match(/arxiv\.org\/(?:list|abs|rss)\/([a-z\-.]+)/i)
  if (arxiv) return plain({ type: 'arxiv', scrape_config: { category: arxiv[1] }, tier: 'platform', cost: 'free' })

  return null
}

// IG/X resolve through the managed gateway scrape path (owner-only, paid at run
// time). YouTube resolves to its free public RSS feed: we resolve the @handle to
// a UC… channel id once here and cache it + the feed_url so runtime fetches are
// a plain RSS GET with no gateway credits. The user supplies no key either way,
// so from the add-source UX every social source is no-setup ('free').
async function detectSocial(platform: SocialPlatform, rawHandle: string): Promise<DetectionResult> {
  const handle = rawHandle.trim().replace(/^@/, '')

  if (platform === 'yt') {
    const channelId = await resolveYoutubeChannelId(handle)
    if (channelId) {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      return {
        type: 'yt',
        handle,
        scrape_config: { fetch_tier: 'native', channel_id: channelId, feed_url: feedUrl },
        tier: 'platform',
        available_tiers: ['native'],
        recommended_tier: 'native',
        cost: 'free',
        health: 'ok',
      }
    }
    // Couldn't resolve now (private/renamed/blocked) — still accept; runtime
    // retries resolution. Flag 'low' so the picker shows it as unverified.
    return {
      type: 'yt',
      handle,
      scrape_config: { fetch_tier: 'native' },
      tier: 'platform',
      available_tiers: ['native'],
      recommended_tier: 'native',
      cost: 'free',
      health: 'low',
    }
  }

  return {
    type: platform,
    handle,
    scrape_config: { fetch_tier: 'gateway' },
    tier: 'platform',
    available_tiers: ['gateway'],
    recommended_tier: 'gateway',
    cost: 'free',
    health: 'ok',
  }
}

// Build a web DetectionResult, persisting a tight list_selector when one won
// (null = the nav-harvesting fallback was used, so don't pin it).
function webResult(
  url: string,
  tier: 'cheerio' | 'jina',
  health: 'ok' | 'low' | 'down',
  items: FetchedItem[],
  listSelector: string | null,
): DetectionResult {
  const scrape_config: Record<string, unknown> = { tier }
  if (listSelector) scrape_config.list_selector = listSelector
  return {
    type: 'web',
    url,
    scrape_config,
    tier,
    cost: 'free',
    health,
    sample: { title: items[0].title, url: items[0].url },
  }
}

export async function detectSource(input: string): Promise<DetectionResult> {
  const known = matchKnownPlatform(input)
  if (known) {
    if (known.social) return detectSocial(known.social.platform, known.social.handle)
    return known.result!
  }

  if (/^@[A-Za-z0-9_]+$/.test(input)) {
    return detectSocial('x', input.slice(1))
  }

  let url = input
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  const feed = await autodiscoverRss(url)
  if (feed) {
    return { type: 'rss', url: feed, scrape_config: { feed_url: feed }, tier: 'rss', cost: 'free', health: 'ok' }
  }

  // Web scrape. Don't just count links (issue #21) — score the sample. A
  // nav/listicle page returns health 'down' and lands pre-deselected in the
  // picker; only 'ok'/'low' samples short-circuit. The winning tight selector is
  // persisted as list_selector so runtime fetches skip the nav-harvesting
  // 'main a[href]' fallback.
  let weakWeb: DetectionResult | null = null

  try {
    const { items, selector } = await cheerioExtractDetailed(url)
    if (items.length >= 3) {
      const score = scoreSample(items, url)
      const result = webResult(url, 'cheerio', score.health, items, selector)
      if (score.health !== 'down') return result
      weakWeb = result
    }
  } catch {
    /* ignore */
  }

  try {
    const items = await jinaExtract(url)
    if (items.length >= 3) {
      const score = scoreSample(items, url)
      const result = webResult(url, 'jina', score.health, items, null)
      if (score.health !== 'down') return result
      weakWeb = weakWeb ?? result
    }
  } catch {
    /* ignore */
  }

  // A scrape that only ever returned junk: surface it flagged 'down' rather than
  // forcing a Firecrawl key for a source that probably isn't worth tracking.
  if (weakWeb) return weakWeb

  const hasFirecrawl = !!process.env.FIRECRAWL_API_KEY
  return {
    type: 'web',
    url,
    scrape_config: { tier: 'firecrawl' },
    tier: 'firecrawl_required',
    cost: hasFirecrawl ? 'free' : 'byok',
    needs_byok: !hasFirecrawl,
  }
}
