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

// RSS feeds occasionally emit doubled words at the join between two fields
// ("Saved" headline + "Saved" link label → "SavedSaved"). Collapse them.
function dedupeWords(t: string): string {
  return t
    .replace(/\b(\w{3,})\1\b/g, '$1')                  // "SavedSaved" → "Saved"
    .replace(/\b(\w{3,})\s+\1\b/gi, '$1')              // "Saved Saved" → "Saved"
}

export function cleanTitle(raw: string): string {
  let t = (raw ?? '').trim()
  for (let i = 0; i < 3 && t; i++) {
    const before = t
    t = t.replace(DATE_PREFIX, '').replace(ISO_PREFIX, '').trim()
    if (t === before) break
  }
  t = dedupeWords(t).replace(/\s+/g, ' ').trim()
  // Some feeds glue the article intro onto the title. If the result is huge
  // and contains a sentence break, snap to the first sentence.
  if (t.length > 130) {
    const cut = t.search(/[.!?]\s+[A-Z]/)
    if (cut > 30 && cut < 130) t = t.slice(0, cut + 1).trim()
  }
  if (t.length > 180) t = t.slice(0, 177).trim() + '…'
  return t
}

export function cleanSummary(raw: string | null): string {
  if (!raw) return ''
  return raw.replace(READ_TIME_SUFFIX, '').trim()
}

// Iframe sandboxes regularly block window.open and parent.postMessage.
// Most reliable cross-sandbox "share this URL" is clipboard write — works
// without any host shell cooperation. Caller renders a toast on success.
export async function copyUrl(url: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
