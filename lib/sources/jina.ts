// Jina Reader: r.jina.ai prefix returns clean markdown for any URL.
// Free tier: 100 RPM. Provide JINA_API_KEY to lift to 500 RPM.
export async function jinaFetch(url: string): Promise<string> {
  const target = `https://r.jina.ai/${url}`
  const headers: Record<string, string> = { 'X-Return-Format': 'markdown' }
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`
  const res = await fetch(target, { headers, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`Jina reader failed: ${res.status}`)
  return res.text()
}
