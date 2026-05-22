'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useViewer } from '@/hooks/use-viewer'

interface Suggestion {
  suggestion: { name: string; url: string; type_hint?: string; why?: string }
  detection: { type: string; tier?: string; url?: string; handle?: string; scrape_config: Record<string, unknown>; needs_byok?: boolean } | null
  error?: string
}

type Step = 'meta' | 'discover' | 'review'

export default function NewChannelPage() {
  const { token, viewerId } = useViewer()
  const router = useRouter()
  const [step, setStep] = useState<Step>('meta')
  const [name, setName] = useState('')
  const [niche, setNiche] = useState('')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token || !viewerId) return <main className="container"><p className="muted">Loading…</p></main>

  async function createChannel() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token, viewerId, name, niche, timezone }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Failed')
      setChannelId(d.channel.id)
      setStep('discover')
      await discover(d.channel.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function discover(id: string) {
    setLoading(true)
    try {
      const r = await fetch(`/api/channels/${id}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Discover failed')
      setSuggestions(d.suggestions)
      const pre: Record<number, boolean> = {}
      d.suggestions.forEach((s: Suggestion, i: number) => {
        if (s.detection && !s.detection.needs_byok) pre[i] = true
      })
      setPicked(pre)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function saveSources() {
    if (!channelId) return
    setLoading(true)
    setError(null)
    try {
      const chosen = suggestions
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => picked[i] && suggestions[i].detection)
      await Promise.all(
        chosen.map(({ s }) =>
          fetch(`/api/channels/${channelId}/sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embedToken: token,
              type: s.detection!.type,
              url: s.detection!.url ?? s.suggestion.url,
              handle: s.detection!.handle ?? null,
              label: s.suggestion.name,
              scrape_config: s.detection!.scrape_config,
              added_by: 'ai_discovery',
            }),
          }),
        ),
      )
      router.push(`/c/${channelId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="container stack">
      <h1>New channel</h1>
      {error && <div className="card" style={{ borderColor: '#c33' }}>{error}</div>}

      {step === 'meta' && (
        <div className="card stack">
          <label>
            <div className="muted">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="AI Coding Digest" />
          </label>
          <label>
            <div className="muted">Niche (be specific)</div>
            <textarea
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="AI coding tools, LLMs for software engineers, IDE assistants"
              rows={3}
            />
          </label>
          <label>
            <div className="muted">Timezone</div>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
          <button onClick={createChannel} disabled={loading || !name || niche.length < 5}>
            {loading ? 'Creating…' : 'Next: discover sources'}
          </button>
        </div>
      )}

      {step === 'discover' && (
        <div className="card"><p className="muted">Asking AI to find top sources for your niche…</p></div>
      )}

      {step === 'review' && (
        <div className="stack">
          <p className="muted">Review AI-suggested sources. All free-tier sources are pre-checked.</p>
          {suggestions.map((s, i) => (
            <div key={i} className="card">
              <label className="row" style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={!!picked[i]}
                  disabled={!s.detection}
                  onChange={(e) => setPicked({ ...picked, [i]: e.target.checked })}
                  style={{ width: 'auto', marginTop: 4 }}
                />
                <div style={{ flex: 1, marginLeft: 8 }}>
                  <div style={{ fontWeight: 600 }}>{s.suggestion.name}</div>
                  <div className="muted" style={{ wordBreak: 'break-all' }}>{s.suggestion.url}</div>
                  {s.suggestion.why && <div className="muted" style={{ marginTop: 4 }}>{s.suggestion.why}</div>}
                  <div style={{ marginTop: 6 }}>
                    {s.detection ? (
                      <span className={`badge ${s.detection.needs_byok ? 'warn' : 'ok'}`}>
                        {s.detection.type}{s.detection.tier ? ` · ${s.detection.tier}` : ''}
                      </span>
                    ) : (
                      <span className="badge err">unreachable</span>
                    )}
                  </div>
                </div>
              </label>
            </div>
          ))}
          <button onClick={saveSources} disabled={loading}>
            {loading ? 'Saving…' : `Save ${Object.values(picked).filter(Boolean).length} sources`}
          </button>
        </div>
      )}
    </main>
  )
}
