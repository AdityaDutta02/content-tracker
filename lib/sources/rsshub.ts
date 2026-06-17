// Map social platforms to RSSHub feed URLs. RSSHub is a free public service
// (rsshub.app) that exposes RSS for sites that don't ship their own feed —
// X, Instagram, YouTube channels, LinkedIn jobs, etc. We funnel everything
// through it so the rest of the pipeline only deals with one source type: rss.
//
// Routes reference: https://docs.rsshub.app

// Point RSSHUB_BASE_URL at a self-hosted instance for reliability (rsshub.app
// frequently 429/503s, especially on IG/X routes). Defaults to the public host.
const BASE = (process.env.RSSHUB_BASE_URL?.replace(/\/+$/, '')) || 'https://rsshub.app'

export interface RssHubMatch {
  rssUrl: string
  display: string
}

export function rsshubFor(platform: string, handle: string): RssHubMatch | null {
  const h = handle.trim().replace(/^@/, '')
  if (!h) return null
  switch (platform) {
    case 'yt':
      // RSSHub accepts /youtube/user/:name, /youtube/@:handle, /youtube/channel/:id
      if (/^UC[\w-]{20,}$/.test(h)) return { rssUrl: `${BASE}/youtube/channel/${h}`, display: `YouTube ${h}` }
      return { rssUrl: `${BASE}/youtube/user/${h}`, display: `YouTube @${h}` }
    case 'x':
      return { rssUrl: `${BASE}/twitter/user/${h}`, display: `X @${h}` }
    case 'ig':
      return { rssUrl: `${BASE}/instagram/user/${h}`, display: `Instagram @${h}` }
    case 'reddit':
      // Native: reddit.com/r/X/top.rss — cleaner than RSSHub, no third-party dep.
      return { rssUrl: `https://www.reddit.com/r/${h}/top.rss?t=day`, display: `r/${h}` }
    case 'google_alerts':
      // Caller supplies the alert RSS ID (must come from a user-created Google Alert).
      return { rssUrl: `${BASE}/google/alerts/${h}`, display: `Google Alert ${h}` }
    default:
      return null
  }
}
