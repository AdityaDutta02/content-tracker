export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  if (diff < MIN) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Source feeds often inject metadata into text fields:
//   - RSS titles prefixed with "Jun 10", "2025-06-10", "[Jun 10]"
//   - Summaries suffixed with "9 min read", "5 minute read"
// These look like real content but are noise. Strip them before render.
const DATE_PREFIX = /^\s*(?:\[)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s*\d{4})?(?:\])?\s*[-:·•|]?\s*/i
const ISO_PREFIX = /^\s*\d{4}-\d{2}-\d{2}\s*[-:·•|]?\s*/
const READ_TIME_SUFFIX = /\s*[·•|-]?\s*\d+\s*(?:min(?:ute)?s?)\s*read\s*\.?\s*$/i

export function cleanTitle(raw: string): string {
  let t = (raw ?? '').trim()
  for (let i = 0; i < 3 && t; i++) {
    const before = t
    t = t.replace(DATE_PREFIX, '').replace(ISO_PREFIX, '').trim()
    if (t === before) break
  }
  return t
}

export function cleanSummary(raw: string | null): string {
  if (!raw) return ''
  return raw.replace(READ_TIME_SUFFIX, '').trim()
}

// Open a URL reliably from inside an embedded iframe. target="_blank" silently
// fails when the host iframe lacks allow-popups; fall back to navigating the
// top frame so the user at least reaches the article.
export function openExternal(url: string): void {
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if (w) return
  } catch {
    /* popup blocked — fall through */
  }
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url
      return
    }
  } catch {
    /* cross-origin top frame — fall through */
  }
  window.location.href = url
}
