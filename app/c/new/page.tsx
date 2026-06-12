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
  const [targetGroup, setTargetGroup] = useState('')
  const [description, setDescription] = useState('')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveResults, setSaveResults] = useState<Record<number, 'ok' | string>>({})

  if (!token || !viewerId) return <main className="container"><p className="muted">Loading…</p></main>

  async function createChannel() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedToken: token,
          viewerId,
          name,
          niche,
          target_group: targetGroup || null,
          description: description || null,
          timezone,
        }),
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
    setSaveResults({})
    try {
      const chosen = suggestions
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => picked[i] && suggestions[i].detection)
      const results = await Promise.all(
        chosen.map(async ({ s, i }) => {
          try {
            const r = await fetch(`/api/channels/${channelId}/sources`, {
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
            })
            if (!r.ok) {
              const d = await r.json().catch(() => ({}))
              return { i, status: (d.error as string) ?? `HTTP ${r.status}` }
            }
            return { i, status: 'ok' as const }
          } catch (e) {
            return { i, status: e instanceof Error ? e.message : String(e) }
          }
        }),
      )
      const next: Record<number, 'ok' | string> = {}
      let okCount = 0
      let failCount = 0
      for (const { i, status } of results) {
        next[i] = status
        if (status === 'ok') okCount++
        else failCount++
      }
      setSaveResults(next)
      if (failCount > 0) {
        setError(`${okCount}/${results.length} saved. ${failCount} failed — review the badges below, then continue.`)
        return // do not auto-navigate; user must dismiss to proceed
      }
      // trigger first refresh in background, navigate with poll hint
      fetch(`/api/channels/${channelId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      }).catch(() => undefined)
      router.push(`/c/${channelId}?initialRefresh=1`)
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
            <div className="muted">Niche (short, e.g. &quot;AI coding tools&quot;)</div>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="AI coding tools"
            />
          </label>
          <label>
            <div className="muted">Target group (who&apos;s this for?)</div>
            <input
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              placeholder="senior software engineers shipping prod LLM apps"
            />
          </label>
          <label>
            <div className="muted">Description (what should the feed cover?)</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Daily news on AI coding assistants, IDE integrations, agent frameworks. Skip hype-only posts. Prefer benchmarks, launches, and dev-team adoption stories."
              rows={4}
            />
          </label>
          <label>
            <div className="muted">Timezone</div>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
          <button onClick={createChannel} disabled={loading || !name || niche.length < 2}>
            {loading ? 'Creating…' : 'Next: discover sources'}
          </button>
        </div>
      )}

      {step === 'discover' && (
        <div className="stack">
          <div className="card">
            <p><span className="spinner" />Asking AI to find top sources for your niche…</p>
            <p className="muted">Usually 15–30s. We&apos;re scanning RSS, news sites, Reddit, YouTube, X, LinkedIn, and more.</p>
          </div>
          <div className="card">
            <div className="skeleton" style={{ width: '60%' }} />
            <div className="skeleton" style={{ width: '85%' }} />
            <div className="skeleton tall" />
          </div>
          <div className="card">
            <div className="skeleton" style={{ width: '55%' }} />
            <div className="skeleton" style={{ width: '80%' }} />
            <div className="skeleton tall" />
          </div>
        </div>
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
                    {saveResults[i] === 'ok' && <span className="badge ok" style={{ marginLeft: 6 }}>✓ saved</span>}
                    {saveResults[i] && saveResults[i] !== 'ok' && (
                      <span className="badge err" style={{ marginLeft: 6 }}>✗ {saveResults[i]}</span>
                    )}
                  </div>
                </div>
              </label>
            </div>
          ))}
          <div className="row">
            <button onClick={saveSources} disabled={loading}>
              {loading ? 'Saving…' : `Save ${Object.values(picked).filter(Boolean).length} sources`}
            </button>
            {Object.values(saveResults).some((v) => v === 'ok') && (
              <button
                className="secondary"
                onClick={() => {
                  if (!channelId) return
                  fetch(`/api/channels/${channelId}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embedToken: token }),
                  }).catch(() => undefined)
                  router.push(`/c/${channelId}?initialRefresh=1`)
                }}
              >
                Continue to channel →
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
