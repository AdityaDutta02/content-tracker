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

// also used by the channel-level firecrawl tier branch above


// Tight, structural selectors first. The catch-all 'main a[href]' is a LAST
// RESORT (issue #21): it harvests every link in <main> including nav, so it only
// runs when no structured selector yielded a feed. detectSource persists the
// winning tight selector so future fetches skip the catch-all entirely.
const CHEERIO_SELECTORS = [
  'article h2 a, article h3 a',
  '.post-title a, .entry-title a',
  'h2.title a, h3.title a',
  'a.post-link, a.entry-link, a.story-link',
]
const CHEERIO_FALLBACK_SELECTOR = 'main a[href]'

export async function cheerioExtract(url: string, selector?: string): Promise<FetchedItem[]> {
  return (await cheerioExtractDetailed(url, selector)).items
}

// Like cheerioExtract but also reports which selector produced the feed, so the
// caller can persist a tight list_selector instead of re-harvesting nav links.
// `selector` is null when the catch-all fallback was used (don't persist it).
export async function cheerioExtractDetailed(
  url: string,
  selector?: string,
): Promise<{ items: FetchedItem[]; selector: string | null }> {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`web fetch failed: ${res.status}`)
  const html = await res.text()
  const $ = cheerio.load(html)

  const tryList = selector ? [selector] : [...CHEERIO_SELECTORS, CHEERIO_FALLBACK_SELECTOR]

  const collect = (sel: string): FetchedItem[] => {
    const out: FetchedItem[] = []
    const seen = new Set<string>()
    $(sel).each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      const title = $el.text().trim()
      if (!href || !title || title.length < 8) return
      try {
        const abs = new URL(href, url).href
        if (seen.has(abs)) return
        seen.add(abs)
        out.push({ external_id: abs, title, url: abs })
      } catch {
        /* skip */
      }
    })
    return out.slice(0, 30)
  }

  for (const sel of tryList) {
    const items = collect(sel)
    if (items.length >= 3) {
      const isFallback = sel === CHEERIO_FALLBACK_SELECTOR
      return { items, selector: isFallback ? null : sel }
    }
  }
  return { items: [], selector: null }
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
    // Skip markdown IMAGE syntax ![alt](url) — its alt-text is not a headline.
    // (This is what produced junk titles like "![Image ]" / "Image 1".)
    if (m.index !== undefined && m.index > 0 && md[m.index - 1] === '!') continue

    const title = sanitizeTitle(m[1])
    if (title.length < 8) continue

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

// Strip leftover markdown tokens (nested images/links, stray brackets/bangs)
// that leak into titles from scraped markdown.
export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // nested ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // nested [text](url) -> text
    .replace(/[![\]]/g, '') // stray ! [ ]
    .replace(/\s+/g, ' ')
    .trim()
}
