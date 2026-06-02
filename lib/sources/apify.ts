// Apify BYOK adapter — for X / IG / FB / YT scrapers.
// User supplies per-channel scraper_byok_key. Each source.scrape_config has actor_id + input.
// Feature-flagged: when SCRAPER_PROVIDER=gateway, route via TAI gateway instead.
import type { FetchedItem, SourceType } from '../types'

const DEFAULT_ACTORS: Record<string, string> = {
  x: 'apidojo~tweet-scraper',
  ig: 'apify~instagram-scraper',
  fb: 'apify~facebook-pages-scraper',
  yt: 'streamers~youtube-scraper',
  linkedin: 'apimaestro~linkedin-company-posts',
}
const LINKEDIN_PROFILE_ACTOR = 'harvestapi~linkedin-profile-posts'

export async function apifyRun(
  type: SourceType,
  handle: string,
  apiKey: string,
  overrides: { actor_id?: string; input?: Record<string, unknown>; kind?: string } = {},
): Promise<FetchedItem[]> {
  if (!apiKey) throw new Error('apify: missing BYOK key')
  const kind = overrides.kind
  let actor = overrides.actor_id ?? DEFAULT_ACTORS[type]
  if (type === 'linkedin' && kind === 'profile') actor = overrides.actor_id ?? LINKEDIN_PROFILE_ACTOR
  if (!actor) throw new Error(`apify: no actor for ${type}`)

  const input = overrides.input ?? defaultInput(type, handle, kind)
  const res = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`Apify ${actor} failed: ${res.status}`)
  const items = (await res.json()) as Array<Record<string, unknown>>
  return items.map((r) => normalizeApify(type, r))
}

function defaultInput(type: SourceType, handle: string, kind?: string): Record<string, unknown> {
  switch (type) {
    case 'x':
      return { handles: [handle.replace(/^@/, '')], maxItems: 25 }
    case 'ig':
      return { usernames: [handle.replace(/^@/, '')], resultsLimit: 25 }
    case 'fb':
      return { startUrls: [{ url: `https://www.facebook.com/${handle}` }], maxPosts: 25 }
    case 'yt':
      return { startUrls: [{ url: `https://www.youtube.com/@${handle.replace(/^@/, '')}/videos` }], maxResults: 25 }
    case 'linkedin':
      if (kind === 'profile') {
        return { profileUrls: [`https://www.linkedin.com/in/${handle}`], maxPosts: 25 }
      }
      return { companyUrls: [`https://www.linkedin.com/company/${handle}`], maxPosts: 25 }
    default:
      return {}
  }
}

function normalizeApify(type: SourceType, r: Record<string, unknown>): FetchedItem {
  const id = (r.id ?? r.url ?? r.permalink ?? r.shortCode ?? Math.random().toString(36)) as string
  const text = (r.text ?? r.caption ?? r.title ?? r.fullText ?? '') as string
  const url = (r.url ?? r.permalink ?? r.link ?? '') as string
  const published = (r.timestamp ?? r.publishedAt ?? r.createdAt ?? r.publishedTime ?? null) as string | null
  return {
    external_id: `${type}:${id}`,
    title: text.slice(0, 200),
    url,
    summary: text.slice(0, 500),
    published_at: published ?? undefined,
    engagement: {
      likes: (r.likes ?? r.likesCount ?? r.likeCount) as number | undefined,
      comments: (r.comments ?? r.commentsCount ?? r.commentCount) as number | undefined,
      reposts: (r.retweets ?? r.shares ?? r.retweetCount) as number | undefined,
      views: (r.views ?? r.viewCount ?? r.playCount) as number | undefined,
    },
    raw: r,
  }
}
