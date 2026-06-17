// Layered social fetch. For x / ig / yt we try tiers in order — cheapest
// working path wins per source:
//   native  — first-party RSS (YouTube only)
//   rsshub  — free public/self-hosted RSSHub mirror
//   apify   — BYOK paid scraper (channel key or APIFY_API_KEY)
// First tier returning ≥1 item wins; chosen tier is cached in
// scrape_config.fetch_tier so the next run skips probing dead tiers.
import type { ChannelRow, FetchedItem, FetchTier } from '../types'
import { fetchRss } from './rss'
import { fetchYoutubeNative } from './youtube'
import { rsshubFor } from './rsshub'
import { apifyRun } from './apify'

export type SocialPlatform = 'x' | 'ig' | 'yt'

const ALL_TIERS: readonly FetchTier[] = ['native', 'rsshub', 'apify']
const DEFAULT_TIERS: Record<SocialPlatform, FetchTier[]> = {
  yt: ['native', 'rsshub', 'apify'],
  x: ['rsshub', 'apify'],
  ig: ['rsshub', 'apify'],
}

function parseTierList(raw: string | undefined): FetchTier[] | null {
  if (!raw) return null
  const parsed = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t): t is FetchTier => (ALL_TIERS as readonly string[]).includes(t))
  return parsed.length ? parsed : null
}

function envTiers(platform: SocialPlatform): FetchTier[] | null {
  return (
    parseTierList(process.env[`SOCIAL_FETCH_TIERS_${platform.toUpperCase()}`]) ??
    parseTierList(process.env.SOCIAL_FETCH_TIERS)
  )
}

// Effective tier order: env/cfg overrides → platform default, native dropped
// for non-YT, and a previously-successful cached tier floated to the front.
export function tierOrder(platform: SocialPlatform, cfg: Record<string, unknown>): FetchTier[] {
  const base =
    parseTierList((cfg.fetch_tiers as string[] | undefined)?.join(',')) ??
    envTiers(platform) ??
    DEFAULT_TIERS[platform]
  const valid = base.filter((t) => (t === 'native' ? platform === 'yt' : true))
  const cached = cfg.fetch_tier as FetchTier | undefined
  if (cached && valid.includes(cached)) return [cached, ...valid.filter((t) => t !== cached)]
  return valid
}

export interface SocialFetchResult {
  items: FetchedItem[]
  tier: FetchTier
  /** scrape_config patch to persist (chosen tier + any resolved ids), or null. */
  configPatch: Record<string, unknown> | null
}

export async function fetchSocial(
  platform: SocialPlatform,
  handle: string,
  cfg: Record<string, unknown>,
  channel: ChannelRow,
): Promise<SocialFetchResult> {
  const tiers = tierOrder(platform, cfg)
  const errors: string[] = []
  for (const tier of tiers) {
    try {
      if (tier === 'native' && platform === 'yt') {
        const r = await fetchYoutubeNative(handle, cfg.channel_id as string | undefined)
        if (r.items.length > 0) {
          return { items: r.items, tier, configPatch: { fetch_tier: 'native', channel_id: r.channelId } }
        }
      } else if (tier === 'rsshub') {
        const m = rsshubFor(platform, handle)
        if (m) {
          const items = await fetchRss(m.rssUrl)
          if (items.length > 0) return { items, tier, configPatch: { fetch_tier: 'rsshub' } }
        }
      } else if (tier === 'apify') {
        const key = channel.scraper_byok_key ?? process.env.APIFY_API_KEY
        if (!key) {
          errors.push('apify: no BYOK key')
          continue
        }
        const items = await apifyRun(platform, handle, key, {})
        if (items.length > 0) return { items, tier, configPatch: { fetch_tier: 'apify' } }
      }
    } catch (e) {
      errors.push(`${tier}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(
    `all tiers exhausted for ${platform}:${handle}${errors.length ? ` (${errors.join('; ')})` : ''}`,
  )
}
