// Local MinHash-style title clustering. Free, in-process. Groups near-duplicate
// headlines across sources before any AI is invoked.
import type { FetchedItem } from '../types'

const STOP = new Set([
  'a', 'an', 'the', 'is', 'of', 'in', 'to', 'and', 'or', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'it', 'be', 'are', 'was', 'were', 'this', 'that',
  'has', 'have', 'had', 'will', 'can', 'new',
])

function shingles(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
  const grams = new Set<string>()
  for (let i = 0; i < tokens.length - 1; i++) grams.add(`${tokens[i]} ${tokens[i + 1]}`)
  if (grams.size === 0) for (const t of tokens) grams.add(t)
  return grams
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export interface ClusterAssignment {
  cluster_id: string
  size: number
}

// Returns array parallel to input: clusterId for each item.
export function clusterItems(items: FetchedItem[], threshold = 0.55): ClusterAssignment[] {
  const sigs = items.map((i) => shingles(i.title))
  const ids = new Array<number>(items.length).fill(-1)
  let nextId = 0
  for (let i = 0; i < items.length; i++) {
    if (ids[i] !== -1) continue
    ids[i] = nextId
    for (let j = i + 1; j < items.length; j++) {
      if (ids[j] !== -1) continue
      if (jaccard(sigs[i], sigs[j]) >= threshold) ids[j] = nextId
    }
    nextId++
  }
  const sizes = new Map<number, number>()
  for (const id of ids) sizes.set(id, (sizes.get(id) ?? 0) + 1)
  return ids.map((id) => ({ cluster_id: `c${id}`, size: sizes.get(id) ?? 1 }))
}
