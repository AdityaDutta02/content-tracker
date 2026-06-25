// Social fetch — single managed path via the Terminal AI gateway.
//
// The gateway scrapes every platform (IG / X / YT / FB / LinkedIn) behind one
// normalized shape (ScrapeCreators primary, Apify failover, managed for us). No
// more tier probing, dead RSSHub mirrors, BYOK keys, or hand-rolled actor inputs
// — one call per source, normalized post out. Scraping is owner-only, so the
// caller must pass an owner-scoped token (cron task token or owner embed token).
import type { FetchedItem, SourceType } from '../types'
import { instagram, youtube, twitter, facebook, linkedin, type SocialPost, type SocialList } from '../scrape-sdk'

// x/ig/yt are the handle-based social sources the pipeline counts toward its
// social quota; fb/linkedin are URL-based and handled by the same gateway path.
export type SocialPlatform = 'x' | 'ig' | 'yt'

const LIST_LIMIT = 25

function cleanHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, '')
    .replace(/\/+$/, '')
}

function facebookUrl(handleOrUrl: string): string {
  const v = handleOrUrl.trim()
  if (/^https?:\/\//i.test(v)) return v
  return `https://www.facebook.com/${v.replace(/^@/, '').replace(/\/+$/, '')}`
}

function linkedinUrl(handleOrUrl: string, kind: string | undefined): string {
  const v = handleOrUrl.trim()
  if (/^https?:\/\//i.test(v)) return v
  const slug = v.replace(/^@/, '').replace(/\/+$/, '')
  const seg = kind === 'company' ? 'company' : 'in'
  return `https://www.linkedin.com/${seg}/${slug}`
}

/** Map one normalized gateway post to the pipeline's FetchedItem shape. */
export function mapSocialPost(type: SourceType, p: SocialPost): FetchedItem {
  const text = (p.text ?? '').trim()
  const firstLine = text.split('\n').find((l) => l.trim()) ?? text
  return {
    external_id: `${type}:${p.id}`,
    title: (firstLine || text).slice(0, 200) || `${type} post`,
    url: p.url ?? '',
    summary: text.slice(0, 500),
    image_url: p.mediaUrls?.[0],
    published_at: p.createdAt ?? undefined,
    engagement: {
      likes: p.likes ?? undefined,
      comments: p.comments ?? undefined,
      reposts: p.shares ?? undefined,
      views: p.views ?? undefined,
    },
    raw: p as unknown as Record<string, unknown>,
  }
}

function mapList(type: SourceType, list: SocialList): FetchedItem[] {
  return (list.items ?? []).map((p) => mapSocialPost(type, p))
}

/**
 * Fetch recent items for a social source via the gateway. `handleOrUrl` is the
 * source handle (x/ig/yt) or page URL (fb/linkedin); `cfg` carries linkedin
 * `kind` (company|profile). Throws on gateway failure — the pipeline records it.
 */
export async function fetchSocial(
  type: SourceType,
  handleOrUrl: string,
  cfg: Record<string, unknown>,
  token: string,
): Promise<FetchedItem[]> {
  const opts = { limit: LIST_LIMIT }
  switch (type) {
    case 'ig': {
      const { data } = await instagram.posts(cleanHandle(handleOrUrl), opts, token)
      return mapList('ig', data)
    }
    case 'x': {
      const { data } = await twitter.tweets(cleanHandle(handleOrUrl), opts, token)
      return mapList('x', data)
    }
    case 'yt': {
      // No "channel videos" gateway op — search by the channel handle returns
      // that channel's recent uploads, newest-first.
      const { data } = await youtube.search(cleanHandle(handleOrUrl), opts, token)
      return mapList('yt', data)
    }
    case 'fb': {
      const { data } = await facebook.posts(facebookUrl(handleOrUrl), opts, token)
      return mapList('fb', data)
    }
    case 'linkedin': {
      const { data } = await linkedin.posts(linkedinUrl(handleOrUrl, cfg.kind as string | undefined), opts, token)
      return mapList('linkedin', data)
    }
    default:
      throw new Error(`fetchSocial: unsupported social type ${type}`)
  }
}
