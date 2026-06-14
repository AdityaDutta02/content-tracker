'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useViewer } from '@/hooks/use-viewer'
import { hostname } from '@/lib/format'

interface Suggestion {
  suggestion: { name: string; url: string; type_hint?: string; why?: string }
  detection: { type: string; tier?: string; url?: string; handle?: string; scrape_config: Record<string, unknown>; needs_byok?: boolean } | null
  error?: string
}

interface SourceRow {
  id: string
  url: string | null
  handle: string | null
}

export default function DiscoverMorePage() {
  const { token } = useViewer()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id ?? ''
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [existingHosts, setExistingHosts] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saveResults, setSaveResults] = useState<Record<number, 'ok' | string>>({})

  useEffect(() => {
    if (!token || !id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const headers = { Authorization: `Bearer ${token}` }
        // Pull current sources so we can filter duplicates from suggestions.
        const existing = await fetch(`/api/channels/${id}/sources`, { headers }).then((r) => r.json())
        const hosts = new Set<string>()
        for (const s of (existing.sources ?? []) as SourceRow[]) {
          if (s.url) hosts.add(hostname(s.url))
          if (s.handle) hosts.add(s.handle.toLowerCase())
        }
        if (cancelled) return
        setExistingHosts(hosts)

        const d = await fetch(`/api/channels/${id}/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embedToken: token }),
        }).then((r) => r.json())
        if (cancelled) return
        if (d.error) throw new Error(d.error)

        const fresh = (d.suggestions ?? []).filter((s: Suggestion) => {
          const host = hostname(s.suggestion.url)
          const handle = s.detection?.handle?.toLowerCase()
          if (hosts.has(host)) return false
          if (handle && hosts.has(handle)) return false
          return true
        })
        setSuggestions(fresh)
        const pre: Record<number, boolean> = {}
        fresh.forEach((s: Suggestion, i: number) => {
          if (s.detection && !s.detection.needs_byok) pre[i] = true
        })
        setPicked(pre)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, id])

  async function saveSources() {
    if (!token) return
    setSaving(true)
    setError(null)
    setSaveResults({})
    const chosen = suggestions
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => picked[i] && suggestions[i].detection)
    const results = await Promise.all(
      chosen.map(async ({ s, i }) => {
        try {
          const r = await fetch(`/api/channels/${id}/sources`, {
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
    setSaving(false)
    if (failCount === 0 && okCount > 0) {
      // kick a refresh so the new sources contribute to the next run
      fetch(`/api/channels/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      }).catch(() => undefined)
      router.push(`/c/${id}?initialRefresh=1`)
    } else if (failCount > 0) {
      setError(`${okCount}/${results.length} saved. ${failCount} failed — review badges below.`)
    }
  }

  const pickedCount = useMemo(() => Object.values(picked).filter(Boolean).length, [picked])

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>

  return (
    <main className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Find more sources</h1>
        <Link href={`/c/${id}`}><button className="secondary">Back</button></Link>
      </div>
      <p className="muted">
        AI re-scans your niche and proposes new sources. Sources you already have are hidden.
      </p>
      {error && <div className="card" style={{ borderColor: '#c33' }}>{error}</div>}

      {loading && (
        <div className="card">
          <p><span className="spinner" />Asking AI to find more sources…</p>
          <p className="muted">Usually 15–30s. Scanning RSS feeds, YouTube channels, X accounts, Instagram, subreddits.</p>
        </div>
      )}

      {!loading && suggestions.length === 0 && (
        <div className="card">
          <p>No new sources found. You may already have the best ones for this niche.</p>
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <div className="stack">
          <p className="muted">{suggestions.length} new candidates ({existingHosts.size} hidden as duplicates).</p>
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
            <button onClick={saveSources} disabled={saving || pickedCount === 0}>
              {saving ? 'Saving…' : `Add ${pickedCount} source${pickedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
