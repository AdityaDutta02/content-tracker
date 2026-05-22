import * as cheerio from 'cheerio'
import type { FetchedItem } from '../types'
import { jinaFetch } from './jina'
import { firecrawlExtract } from './firecrawl'

interface WebConfig {
  list_selector?: string
  tier?: 'cheerio' | 'jina' | 'firecrawl'
  firecrawl_key?: string
}

const UA = 'Mozilla/5.0 (compatible; ContentTrackerBot/1.0)'

export async function fetchWeb(url: string, config: WebConfig = {}): Promise<FetchedItem[]> {
  const tier = config.tier ?? 'cheerio'

  if (tier === 'cheerio') {
    const items = await cheerioExtract(url, config.list_selector)
    if (items.length >= 3) return items
    return tryJinaThenFirecrawl(url, config)
  }
  if (tier === 'jina') return jinaExtract(url)
  if (tier === 'firecrawl') {
    const key = config.firecrawl_key ?? process.env.FIRECRAWL_API_KEY
    if (!key) throw new Error('web tier=firecrawl needs FIRECRAWL_API_KEY')
    return firecrawlExtract(url, key)
  }
  return tryJinaThenFirecrawl(url, config)
}

async function tryJinaThenFirecrawl(url: string, config: WebConfig): Promise<FetchedItem[]> {
  try {
    const items = await jinaExtract(url)
    if (items.length >= 3) return items
  } catch {
    /* fall through */
  }
  const key = config.firecrawl_key ?? process.env.FIRECRAWL_API_KEY
  if (key) return firecrawlExtract(url, key)
  return []
}

export async function cheerioExtract(url: string, selector?: string): Promise<FetchedItem[]> {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`web fetch failed: ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)
  const candidates: FetchedItem[] = []

  const selectors = selector
    ? [selector]
    : [
        'article h2 a, article h3 a',
        '.post-title a, .entry-title a',
        'h2.title a, h3.title a',
        'a.post-link, a.entry-link, a.story-link',
        'main a[href]',
      ]

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      const title = $el.text().trim()
      if (!href || !title || title.length < 8) return
      try {
        const abs = new URL(href, url).href
        candidates.push({ external_id: abs, title, url: abs })
      } catch {
        /* skip */
      }
    })
    if (candidates.length >= 3) break
  }

  const seen = new Set<string>()
  const deduped = candidates.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
  return deduped.slice(0, 30)
}

export async function jinaExtract(url: string): Promise<FetchedItem[]> {
  const md = await jinaFetch(url)
  return parseMarkdownLinks(md, url).slice(0, 30)
}

function parseMarkdownLinks(md: string, base: string): FetchedItem[] {
  const re = /\[([^\]]{8,200})\]\((https?:\/\/[^)\s]+)\)/g
  const out: FetchedItem[] = []
  const seen = new Set<string>()
  for (const m of md.matchAll(re)) {
    const title = m[1].trim()
    let urlOut: string
    try {
      urlOut = new URL(m[2], base).href
    } catch {
      continue
    }
    if (seen.has(urlOut)) continue
    seen.add(urlOut)
    out.push({ external_id: urlOut, title, url: urlOut })
  }
  return out
}
