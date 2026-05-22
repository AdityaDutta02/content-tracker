import type { FetchedItem } from '../types'

interface RedditChild {
  data: {
    id: string
    title: string
    url: string
    permalink: string
    created_utc: number
    ups: number
    num_comments: number
    is_self: boolean
    selftext: string
  }
}

export async function fetchReddit(subreddit: string, sort: 'top' | 'hot' | 'new' = 'top'): Promise<FetchedItem[]> {
  const clean = subreddit.replace(/^r\//, '')
  const url = `https://www.reddit.com/r/${clean}/${sort}.json?t=day&limit=30`
  const res = await fetch(url, {
    headers: { 'user-agent': 'ContentTrackerBot/1.0 (by /u/none)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status}`)
  const data = (await res.json()) as { data: { children: RedditChild[] } }
  return data.data.children.map((c) => {
    const d = c.data
    return {
      external_id: `reddit:${d.id}`,
      title: d.title,
      url: d.is_self ? `https://www.reddit.com${d.permalink}` : d.url,
      summary: d.selftext?.slice(0, 500),
      published_at: new Date(d.created_utc * 1000).toISOString(),
      engagement: { upvotes: d.ups, comments: d.num_comments },
    }
  })
}
