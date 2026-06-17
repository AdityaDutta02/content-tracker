import type { DetectionResult, SourceType, FetchTier } from '../types'
import { autodiscoverRss, fetchRss } from './rss'
import { cheerioExtract, jinaExtract } from './web'
import { rsshubFor } from './rsshub'
import { resolveYoutubeChannelId } from './youtube'
import type { SocialPlatform } from './social-fetch'

interface KnownMatch {
  // Social handles are probed asynchronously by detectSocial; everything else
  // resolves synchronously to a DetectionResult.
  social?: { platform: SocialPlatform; handle: string }
  result?: DetectionResult
}

const SOCIAL_DEFAULT_TIERS: Record<SocialPlatform, FetchTier[]> = {
  yt: ['native', 'rsshub', 'apify'],
  x: ['rsshub', 'apify'],
  ig: ['rsshub', 'apify'],
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

  // Facebook has no reliable public RSS path even via RSSHub. Surface but mark needs_byok.
  const fb = url.match(/facebook\.com\/([^/?#]+)/i)
  if (fb) return plain({ type: 'fb', handle: fb[1], scrape_config: {}, tier: 'platform', cost: 'byok', needs_byok: !process.env.APIFY_API_KEY })

  // LinkedIn posts/profiles aren't reliably available via RSSHub either.
  // Keep platform type so user can BYOK or skip.
  const liCo = url.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i)
  if (liCo) return plain({ type: 'linkedin', handle: liCo[1], scrape_config: { kind: 'company' }, tier: 'platform', cost: 'byok' })
  const liIn = url.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (liIn) return plain({ type: 'linkedin', handle: liIn[1], scrape_config: { kind: 'profile' }, tier: 'platform', cost: 'byok' })
  const liPosts = url.match(/linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)\/(?:recent-activity|posts)/i)
  if (liPosts) return plain({ type: 'linkedin', handle: liPosts[1], scrape_config: { kind: 'profile' }, tier: 'platform', cost: 'byok' })
  const liBare = url.match(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/([^/?#]+)\/?$/i)
  if (liBare && !/^(feed|login|signup|jobs|learning|notifications|messaging|mynetwork|search|help)$/i.test(liBare[1])) {
    return plain({ type: 'linkedin', handle: liBare[1], scrape_config: { kind: 'profile' }, tier: 'platform', cost: 'byok' })
  }

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

// Quick "does this feed return anything" probe with a hard timeout so discovery
// of 10 sources doesn't stall on one slow RSSHub route.
async function probeRss(url: string, ms = 8000): Promise<boolean> {
  try {
    const items = await Promise.race([
      fetchRss(url),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), ms)),
    ])
    return items.length > 0
  } catch {
    return false
  }
}

// Probe a social handle across tiers but NEVER drop it. Worst case returns the
// suggestion marked health:'down' so the UI can show it and let the user decide.
async function detectSocial(platform: SocialPlatform, rawHandle: string): Promise<DetectionResult> {
  const handle = rawHandle.trim().replace(/^@/, '')
  const tiers = SOCIAL_DEFAULT_TIERS[platform]
  const base = (cfg: Record<string, unknown>): DetectionResult => ({
    type: platform,
    handle,
    scrape_config: { fetch_tiers: tiers, ...cfg },
    tier: 'platform',
    available_tiers: tiers,
  })

  // YouTube tier 1: native RSS. Resolve + cache the channel id.
  if (platform === 'yt') {
    const channelId = await resolveYoutubeChannelId(handle)
    if (channelId) {
      return { ...base({ channel_id: channelId }), recommended_tier: 'native', cost: 'free', health: 'ok' }
    }
  }

  // Tier 2: RSSHub (free).
  const m = rsshubFor(platform, handle)
  if (m && (await probeRss(m.rssUrl))) {
    return { ...base({}), recommended_tier: 'rsshub', cost: 'free', health: 'ok' }
  }

  // RSSHub didn't answer. Apify (BYOK) is the remaining viable path.
  if (process.env.APIFY_API_KEY) {
    return { ...base({}), recommended_tier: 'apify', cost: 'byok', health: 'untested', needs_byok: false }
  }

  // No free probe succeeded and no Apify key — surface as down, still keep it.
  return { ...base({}), recommended_tier: 'rsshub', cost: 'byok', health: 'down', needs_byok: true }
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

  try {
    const items = await cheerioExtract(url)
    if (items.length >= 3) {
      return {
        type: 'web',
        url,
        scrape_config: { tier: 'cheerio' },
        tier: 'cheerio',
        cost: 'free',
        health: 'ok',
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
        cost: 'free',
        health: 'ok',
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
    cost: hasFirecrawl ? 'free' : 'byok',
    needs_byok: !hasFirecrawl,
  }
}
