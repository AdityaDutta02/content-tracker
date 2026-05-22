'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useViewer } from '@/hooks/use-viewer'

interface Detection {
  type: string
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  tier?: string
  sample?: { title: string; url: string }
  needs_byok?: boolean
}

export default function AddSourcePage() {
  const { token } = useViewer()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const channelId = params?.id ?? ''
  const [input, setInput] = useState('')
  const [label, setLabel] = useState('')
  const [detection, setDetection] = useState<Detection | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function probe() {
    if (!input) return
    setLoading(true)
    setError(null)
    setDetection(null)
    try {
      const r = await fetch('/api/sources/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const d = (await r.json()) as Detection & { error?: string }
      if (!r.ok || d.error) throw new Error(d.error ?? 'Detection failed')
      setDetection(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!detection || !token) return
    setLoading(true)
    try {
      const r = await fetch(`/api/channels/${channelId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedToken: token,
          type: detection.type,
          url: detection.url ?? input,
          handle: detection.handle ?? null,
          label: label || null,
          scrape_config: detection.scrape_config,
          added_by: 'user_custom',
        }),
      })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error ?? 'Save failed')
      }
      router.push(`/c/${channelId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>

  return (
    <main className="container stack">
      <h1>Add source</h1>
      {error && <div className="card" style={{ borderColor: '#c33' }}>{error}</div>}

      <div className="card stack">
        <label>
          <div className="muted">URL or @handle</div>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://arxiv.org/list/cs.AI/new or @paulg" />
        </label>
        <button onClick={probe} disabled={loading || !input}>{loading ? 'Probing…' : 'Detect'}</button>
      </div>

      {detection && (
        <div className="card stack">
          <div className="row">
            <span className={`badge ${detection.needs_byok ? 'warn' : 'ok'}`}>{detection.type}</span>
            {detection.tier && <span className="badge">{detection.tier}</span>}
          </div>
          {detection.sample && (
            <div className="muted">Sample: <a href={detection.sample.url} target="_blank" rel="noreferrer">{detection.sample.title}</a></div>
          )}
          {detection.needs_byok && (
            <div className="muted">Needs Firecrawl key on channel to scrape.</div>
          )}
          <label>
            <div className="muted">Label (optional)</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="arxiv cs.AI" />
          </label>
          <button onClick={save} disabled={loading}>{loading ? 'Saving…' : 'Save source'}</button>
        </div>
      )}
    </main>
  )
}
