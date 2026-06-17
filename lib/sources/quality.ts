// Article-quality scoring. One source of truth used by BOTH:
//   - detectSource (issue #21): score the fetched sample at channel-creation time
//     so nav/listicle junk lands in the picker pre-deselected.
//   - runChannelPipeline (issue #22): a runtime backstop so a source that PASSED
//     detection but later drifted (redesign turns articles into nav) never leaks
//     junk into the feed.
// Pure, no network, no LLM — heuristics over title shape + URL slug/depth.
import type { FetchedItem } from '../types'

// Exact normalized titles that are site chrome, never article headlines.
const NAV_WORDS = new Set<string>([
  'home', 'about', 'about us', 'contact', 'contact us', 'pricing', 'login', 'log in',
  'sign in', 'sign up', 'signup', 'register', 'careers', 'jobs', 'courses', 'course',
  'patterns', 'pattern', 'resources', 'resource library', 'library', 'docs', 'documentation',
  'blog', 'newsletter', 'community', 'support', 'help', 'faq', 'terms', 'privacy',
  'privacy policy', 'search', 'menu', 'products', 'product', 'features', 'feature',
  'company', 'team', 'customers', 'integrations', 'download', 'downloads', 'get started',
  'learn more', 'read more', 'subscribe', 'follow', 'share', 'more', 'all posts',
  'view all', 'see all', 'categories', 'category', 'tags', 'tag', 'archive', 'archives',
  'overview', 'examples', 'showcase', 'gallery', 'pricing plans', 'enterprise', 'solutions',
])

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Does this fetched item look like a real article rather than nav/section chrome?
// `sourceUrl` (the page being scraped) lets us reject self-links to the root.
export function looksLikeArticle(item: FetchedItem, sourceUrl?: string): boolean {
  const title = (item.title ?? '').trim()
  if (title.length < 8) return false

  const norm = normalize(title)
  if (NAV_WORDS.has(norm)) return false
  const words = norm.split(' ').filter(Boolean)

  let u: URL
  try {
    u = new URL(item.url)
  } catch {
    return false
  }

  const segs = u.pathname.split('/').filter(Boolean)
  const depth = segs.length
  if (depth === 0) return false // points at the domain root

  // Self-link back to the page we scraped → it's the page header, not an item.
  if (sourceUrl) {
    try {
      if (u.pathname.replace(/\/+$/, '') === new URL(sourceUrl).pathname.replace(/\/+$/, '')) return false
    } catch {
      /* ignore bad sourceUrl */
    }
  }

  // An on-page #anchor on a shallow path == one listicle shredded into H2 sections.
  if (u.hash && depth <= 1) return false

  // title == summary is a strong "no real content" signal (echo summaries).
  if (item.summary && normalize(item.summary) === norm) return false

  const slug = segs[depth - 1] ?? ''
  const articleSlug =
    slug.includes('-') || /\d{4,}/.test(slug) || slug.length >= 16 || /\/20\d\d\//.test(u.pathname)

  if (articleSlug && words.length >= 2) return true // deep hyphenated/dated slug
  if (words.length >= 5) return true // long descriptive headline carries its own weight
  if (words.length <= 2) return false // short + no article slug = nav label
  return depth >= 2 // 3-4 words: trust only if the URL is genuinely deep
}

export type SampleHealth = 'ok' | 'low' | 'down'

export interface SampleScore {
  fraction: number // share of items that look like articles, after penalties
  passing: number
  total: number
  health: SampleHealth // >=0.6 ok, 0.3–0.6 low, <0.3 down
}

// Score a whole fetched sample. Used to gate web sources at detection time.
export function scoreSample(items: FetchedItem[], sourceUrl?: string): SampleScore {
  const total = items.length
  if (total === 0) return { fraction: 0, passing: 0, total: 0, health: 'down' }

  const passing = items.filter((it) => looksLikeArticle(it, sourceUrl)).length
  let fraction = passing / total

  // Same-base collision: >50% of items resolve to the same path == one article
  // sliced into sections, not a feed of distinct articles.
  const pathCounts = new Map<string, number>()
  for (const it of items) {
    try {
      const p = new URL(it.url).pathname.replace(/\/+$/, '')
      pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1)
    } catch {
      /* ignore */
    }
  }
  const maxSamePath = Math.max(0, ...pathCounts.values())
  if (maxSamePath / total > 0.5) fraction = Math.min(fraction, 0.2)

  // Datedness: a web sample with zero published_at anywhere is a soft downgrade.
  if (!items.some((it) => it.published_at)) fraction *= 0.85

  const health: SampleHealth = fraction >= 0.6 ? 'ok' : fraction >= 0.3 ? 'low' : 'down'
  return { fraction, passing, total, health }
}
