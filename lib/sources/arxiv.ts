import type { FetchedItem } from '../types'
import { fetchRss } from './rss'

// arxiv exposes RSS per category: http://export.arxiv.org/rss/cs.AI
// Also has a search API for queries: http://export.arxiv.org/api/query
export async function fetchArxiv(opts: { category?: string; query?: string }): Promise<FetchedItem[]> {
  if (opts.category) {
    return fetchRss(`http://export.arxiv.org/rss/${opts.category}`)
  }
  if (opts.query) {
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(opts.query)}&sortBy=submittedDate&sortOrder=descending&max_results=30`
    return fetchRss(url)
  }
  throw new Error('arxiv: category or query required')
}
