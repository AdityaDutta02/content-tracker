export type SourceType = 'rss' | 'hn' | 'reddit' | 'arxiv' | 'yt' | 'x' | 'ig' | 'fb' | 'linkedin' | 'web'

// Per-source social fetch tier (see lib/sources/social-fetch.ts).
export type FetchTier = 'native' | 'rsshub' | 'apify'

// Typed shape of scrape_config for social sources. scrape_config stays a loose
// Record on SourceRow; this documents the keys the social path reads/writes.
export interface SocialScrapeConfig {
  fetch_tier?: FetchTier
  fetch_tiers?: FetchTier[]
  channel_id?: string
}

export interface FetchedItem {
  external_id: string
  title: string
  url: string
  summary?: string
  image_url?: string
  published_at?: string
  engagement?: { likes?: number; comments?: number; reposts?: number; upvotes?: number; views?: number }
  raw?: Record<string, unknown>
}

export interface SourceRow {
  id: string
  channel_id: string
  type: SourceType
  url: string | null
  handle: string | null
  label: string | null
  enabled: boolean
  scrape_config: Record<string, unknown>
  added_by: string
  last_fetch_at: string | null
  last_fetch_error: string | null
}

export interface ChannelRow {
  id: string
  viewer_id: string
  name: string
  niche: string
  target_group: string | null
  description: string | null
  timezone: string
  general_web_search: boolean
  smart_mode: boolean
  niche_embedding: number[] | null
  scraper_byok_key: string | null
  last_run_date: string | null
}

export interface DetectionResult {
  type: SourceType
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  tier?: 'rss' | 'cheerio' | 'jina' | 'firecrawl_required' | 'platform'
  sample?: { title: string; url: string }
  needs_byok?: boolean
  // Social tier metadata (see lib/sources/detect.ts probeSocial).
  available_tiers?: FetchTier[]
  recommended_tier?: FetchTier
  cost?: 'free' | 'byok'
  health?: 'ok' | 'untested' | 'down'
}
