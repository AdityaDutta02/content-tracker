import Parser from 'rss-parser'
import type { FetchedItem } from '../types'

const parser = new Parser({ timeout: 15000, headers: { 'user-agent': 'ContentTrackerBot/1.0' } })

export async function fetchRss(url: string, since?: Date): Promise<FetchedItem[]> {
  const feed = await parser.parseURL(url)
  const items = (feed.items ?? []).map((it) => {
    const published = it.isoDate ?? it.pubDate
    const publishedDate = published ? new Date(published) : undefined
    return {
      external_id: it.guid ?? it.link ?? `${url}#${it.title}`,
      title: (it.title ?? '').trim(),
      url: it.link ?? '',
      summary: (it.contentSnippet ?? it.content ?? '').slice(0, 500),
      published_at: publishedDate?.toISOString(),
      raw: { feedTitle: feed.title },
    } satisfies FetchedItem
  })
  return since ? items.filter((i) => !i.published_at || new Date(i.published_at) > since) : items
}

export async function autodiscoverRss(siteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(siteUrl, { headers: { 'user-agent': 'ContentTrackerBot/1.0' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(/<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)
    if (!match) return null
    const hrefMatch = match[0].match(/href=["']([^"']+)["']/i)
    if (!hrefMatch) return null
    return new URL(hrefMatch[1], siteUrl).href
  } catch {
    return null
  }
}
