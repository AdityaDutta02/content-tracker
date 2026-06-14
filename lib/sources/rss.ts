import Parser from 'rss-parser'
import type { FetchedItem } from '../types'

interface RssExtras {
  enclosure?: { url?: string; type?: string }
  'media:content'?: { $?: { url?: string; medium?: string } } | Array<{ $?: { url?: string; medium?: string } }>
  'media:thumbnail'?: { $?: { url?: string } } | Array<{ $?: { url?: string } }>
  content?: string
  'content:encoded'?: string
}

const parser: Parser<unknown, RssExtras> = new Parser({
  timeout: 15000,
  headers: { 'user-agent': 'ContentTrackerBot/1.0' },
  customFields: {
    item: ['media:content', 'media:thumbnail', 'content:encoded'],
  },
})

function pickImage(it: Parser.Item & RssExtras): string | undefined {
  const enc = it.enclosure
  if (enc?.url && (!enc.type || enc.type.startsWith('image/'))) return enc.url

  const mc = it['media:content']
  if (mc) {
    const arr = Array.isArray(mc) ? mc : [mc]
    for (const m of arr) {
      const url = m.$?.url
      if (url && (m.$?.medium === 'image' || /\.(?:jpg|jpeg|png|webp|gif)/i.test(url))) return url
    }
  }

  const mt = it['media:thumbnail']
  if (mt) {
    const arr = Array.isArray(mt) ? mt : [mt]
    for (const m of arr) {
      if (m.$?.url) return m.$.url
    }
  }

  const html = it['content:encoded'] ?? it.content ?? ''
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (match) return match[1]

  return undefined
}

export async function fetchRss(url: string, since?: Date): Promise<FetchedItem[]> {
  const feed = await parser.parseURL(url)
  const items = (feed.items ?? []).map((raw) => {
    const it = raw as Parser.Item & RssExtras
    const published = it.isoDate ?? it.pubDate
    const publishedDate = published ? new Date(published) : undefined
    return {
      external_id: it.guid ?? it.link ?? `${url}#${it.title}`,
      title: (it.title ?? '').trim(),
      url: it.link ?? '',
      summary: (it.contentSnippet ?? it.content ?? '').slice(0, 500),
      image_url: pickImage(it),
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
