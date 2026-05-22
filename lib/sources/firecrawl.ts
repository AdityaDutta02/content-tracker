// Firecrawl BYOK adapter — used only if user supplies FIRECRAWL_API_KEY
// or per-channel scraper_byok_key. Returns array of items extracted from a listing page.
import type { FetchedItem } from '../types'

export async function firecrawlExtract(url: string, apiKey: string): Promise<FetchedItem[]> {
  const res = await fetch('https://api.firecrawl.dev/v1/extract', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: [url],
      prompt: 'Extract the latest articles/posts listed on this page as JSON array. Each item: {title, url, published_at (ISO if visible), summary}.',
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) throw new Error(`Firecrawl failed: ${res.status}`)
  const data = (await res.json()) as { data?: { items?: Array<{ title: string; url: string; published_at?: string; summary?: string }> } }
  const items = data.data?.items ?? []
  return items.map((i, idx) => ({
    external_id: i.url ?? `${url}#${idx}`,
    title: i.title,
    url: i.url,
    summary: i.summary,
    published_at: i.published_at,
  }))
}
