import type { FetchedItem } from '../types'

interface HnHit {
  objectID: string
  title: string | null
  story_title: string | null
  url: string | null
  story_url: string | null
  points: number | null
  num_comments: number | null
  created_at: string
}

export async function fetchHn(query?: string): Promise<FetchedItem[]> {
  const endpoint = query
    ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`
    : 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30'
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HN fetch failed: ${res.status}`)
  const data = (await res.json()) as { hits: HnHit[] }
  return data.hits
    .filter((h) => (h.title ?? h.story_title) && (h.url ?? h.story_url))
    .map((h) => ({
      external_id: `hn:${h.objectID}`,
      title: (h.title ?? h.story_title)!.trim(),
      url: (h.url ?? h.story_url)!,
      published_at: h.created_at,
      engagement: { upvotes: h.points ?? 0, comments: h.num_comments ?? 0 },
      raw: { hnId: h.objectID },
    }))
}
