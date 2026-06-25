// lib/scrape-sdk.ts — Terminal AI Scraping SDK (server-side only)
//
// Scrape public social data via the Terminal AI gateway. The gateway manages the
// fetch backend (ScrapeCreators primary, Apify failover) and normalizes every
// platform to a shared shape — the app never touches actor inputs or BYOK keys.
//
// Social scrapes are async upstream: the gateway returns a jobId, and we poll
// `/scrape/result/:jobId` to completion here so callers do a single `await`.
// Scraping is owner-only — call it with the cron task token (owner identity) or
// the owner's embed token; other viewers get a 403.
//
// Wire contract (mirrors the documented SDK surface + the scrape_<platform> /
// scrape_result MCP pair):
//   START : POST ${GATEWAY_URL}/scrape/${platform}  body { operation, ...params }
//           → { jobId, status } | inline { data, credits_charged }
//   POLL  : GET  ${GATEWAY_URL}/scrape/result/${jobId}
//           → { status: 'running' } | { status:'done', data, credits_charged }
//                                    | { status:'error', error }

// Read lazily (not at module load) so the value is picked up at call time and
// tests can set it before exercising a call.
function gatewayUrl(): string {
  const url = process.env.TERMINAL_AI_GATEWAY_URL
  if (!url) throw new Error('TERMINAL_AI_GATEWAY_URL is not set')
  return url
}

const POLL_INTERVAL_MS = 2000
const POLL_DEADLINE_MS = 80_000

/** Normalized post shape returned by every social list op. */
export interface SocialPost {
  platform: string
  id: string
  author?: string | null
  text?: string | null
  createdAt?: string | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  views?: number | null
  mediaUrls?: string[]
  url?: string | null
}

/** Normalized list envelope (posts / tweets / reels / videos / search). */
export interface SocialList {
  items: SocialPost[]
  next?: string | null
}

export interface ScrapeEnvelope<T> {
  data: T
  credits_charged: number
}

interface StartResponse {
  jobId?: string
  status?: 'running' | 'done' | 'error'
  data?: unknown
  credits_charged?: number
  error?: string
}

interface PollResponse {
  status: 'running' | 'done' | 'error'
  data?: unknown
  credits_charged?: number
  error?: string
}

type ScrapeError = Error & { code?: string; status?: number; retryable?: boolean }

function scrapeError(message: string, extra: Partial<ScrapeError> = {}): ScrapeError {
  return Object.assign(new Error(message), extra)
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? res.statusText
}

async function startJob(
  platform: string,
  body: Record<string, unknown>,
  token: string,
): Promise<StartResponse> {
  const res = await fetch(`${gatewayUrl()}/scrape/${platform}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (res.status === 402) {
    const b = (await res.json().catch(() => ({}))) as { redirect?: string }
    throw scrapeError('Insufficient credits', { code: 'INSUFFICIENT_CREDITS', status: 402, retryable: false, ...b })
  }
  if (res.status === 403) {
    throw scrapeError('Scrape forbidden (owner-only)', { code: 'SCRAPE_FORBIDDEN', status: 403, retryable: false })
  }
  if (!res.ok) {
    throw scrapeError(`scrape start failed (${res.status}): ${await readError(res)}`, { status: res.status })
  }
  return res.json() as Promise<StartResponse>
}

async function pollJob(jobId: string, token: string): Promise<PollResponse> {
  const res = await fetch(`${gatewayUrl()}/scrape/result/${jobId}`, { headers: authHeaders(token) })
  if (!res.ok) throw scrapeError(`scrape poll failed (${res.status}): ${await readError(res)}`, { status: res.status })
  return res.json() as Promise<PollResponse>
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Start a scrape job and poll it to completion. Handles the inline-result case
 * (gateway answered synchronously) and the async jobId case uniformly.
 */
export async function scrape<T>(
  platform: string,
  operation: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ScrapeEnvelope<T>> {
  if (!token) throw scrapeError('Missing token', { code: 'NO_TOKEN', retryable: false })
  const started = await startJob(platform, { operation, ...params }, token)

  // Inline completion — no polling needed.
  if (started.status === 'done' && started.data !== undefined) {
    return { data: started.data as T, credits_charged: started.credits_charged ?? 0 }
  }
  if (started.status === 'error') throw scrapeError(started.error ?? 'scrape failed')
  if (!started.jobId) throw scrapeError('scrape start returned no jobId and no data')

  const deadline = Date.now() + POLL_DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const r = await pollJob(started.jobId, token)
    if (r.status === 'done') return { data: r.data as T, credits_charged: r.credits_charged ?? 0 }
    if (r.status === 'error') throw scrapeError(r.error ?? 'scrape failed')
  }
  throw scrapeError(`scrape timed out after ${POLL_DEADLINE_MS}ms (${platform}:${operation})`, { code: 'SCRAPE_TIMEOUT' })
}

const clampLimit = (n: number | undefined): number => Math.min(25, Math.max(1, n ?? 25))

// Platform clients — one object per source, mirroring the documented SDK surface.
// List ops return SocialList; single-entity ops return a platform profile object.

export const instagram = {
  profile: (handle: string, token: string) =>
    scrape<Record<string, unknown>>('instagram', 'profile', { handle }, token),
  posts: (handle: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('instagram', 'posts', { handle, limit: clampLimit(opts.limit) }, token),
  reels: (handle: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('instagram', 'reels', { handle, limit: clampLimit(opts.limit) }, token),
}

export const youtube = {
  channel: (handle: string, token: string) =>
    scrape<Record<string, unknown>>('youtube', 'channel', { handle }, token),
  search: (query: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('youtube', 'search', { query, limit: clampLimit(opts.limit) }, token),
}

export const twitter = {
  profile: (handle: string, token: string) =>
    scrape<Record<string, unknown>>('twitter', 'profile', { handle }, token),
  tweets: (handle: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('twitter', 'tweets', { handle, limit: clampLimit(opts.limit) }, token),
}

export const facebook = {
  posts: (url: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('facebook', 'posts', { url, limit: clampLimit(opts.limit) }, token),
}

export const linkedin = {
  profile: (url: string, token: string) =>
    scrape<Record<string, unknown>>('linkedin', 'profile', { url }, token),
  posts: (url: string, opts: { limit?: number }, token: string) =>
    scrape<SocialList>('linkedin', 'posts', { url, limit: clampLimit(opts.limit) }, token),
}
