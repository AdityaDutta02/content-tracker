const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|_hsenc|_hsmi|ref$|ref_src|igshid|si$)/i

export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input.trim())
    u.hash = ''
    u.host = u.host.toLowerCase().replace(/^www\./, '')
    u.protocol = 'https:'
    const keep = new URLSearchParams()
    for (const [k, v] of u.searchParams) if (!TRACKING_PARAMS.test(k)) keep.append(k, v)
    u.search = keep.toString()
    let pathname = u.pathname.replace(/\/+$/, '')
    if (!pathname) pathname = '/'
    u.pathname = pathname
    return u.toString().replace(/\/$/, '')
  } catch {
    return input
  }
}
