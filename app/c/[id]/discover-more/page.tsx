'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, RotateCw } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { Badge, Button, Checkbox, MonoCaption } from '@/components/ui/primitives'
import { hostname } from '@/lib/format'

interface Detection {
  type: string
  tier?: string
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  needs_byok?: boolean
  cost?: 'free' | 'byok'
  health?: 'ok' | 'untested' | 'down'
}
interface Suggestion {
  suggestion: { name: string; url: string; type_hint?: string; why?: string }
  detection: Detection | null
  error?: string
}

// FREE (green) — native / working rsshub. BYOK (amber) — apify-only.
// DOWN (red) — every tier probe-failed. Defaults to FREE when unmarked.
function CostBadge({ d }: { d: Detection }) {
  if (d.health === 'down') return <Badge tone="err">down</Badge>
  if (d.cost === 'byok') return <Badge tone="warn">byok</Badge>
  return <Badge tone="ok">free</Badge>
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
  const [picked, setPicked] = useState<Set<number>>(new Set())
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
        const pre = new Set<number>()
        fresh.forEach((s: Suggestion, i: number) => {
          if (s.detection && !s.detection.needs_byok) pre.add(i)
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

  function togglePick(i: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function saveSources() {
    if (!token) return
    setSaving(true)
    setError(null)
    setSaveResults({})
    const chosen = Array.from(picked).filter((i) => suggestions[i]?.detection)
    const results = await Promise.all(
      chosen.map(async (i) => {
        const s = suggestions[i]
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
      fetch(`/api/channels/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      }).catch(() => undefined)
      router.push(`/c/${id}?initialRefresh=1`)
    } else if (failCount > 0) {
      setError(`${okCount}/${results.length} saved. ${failCount} failed.`)
    }
  }

  const pickedCount = useMemo(() => picked.size, [picked])

  if (!token) {
    return (
      <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
        <MonoCaption>Loading…</MonoCaption>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
      <Link
        href={`/c/${id}`}
        className="mb-8 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Back to channel
      </Link>

      <h1 className="font-serif text-5xl tracking-tight text-ink">Find more sources</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
        AI re-scans your niche and proposes new sources. Anything you already track is hidden.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-ink bg-surface px-4 py-3 text-[13px] text-ink">{error}</div>
      )}

      {loading && (
        <>
          <div className="mt-8 flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4">
            <Loader2 className="h-4 w-4 animate-spin text-ink" strokeWidth={1.75} />
            <div>
              <p className="text-[14px] font-medium text-ink">Re-scanning your niche…</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">Checking RSS, Reddit, X, YouTube and the open web.</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-5">
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-2" />
                <div className="mt-2.5 h-2.5 w-3/4 animate-pulse rounded bg-surface-2" />
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && suggestions.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-line-2 bg-surface px-8 py-16 text-center">
          <p className="font-serif text-2xl tracking-tight text-ink">No new sources found</p>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
            Everything relevant to this niche is already in the channel. Try again in a few days.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => router.refresh()}>
              <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Scan again
            </Button>
            <Link href={`/c/${id}`}>
              <Button variant="primary">Back to channel</Button>
            </Link>
          </div>
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <>
          <div className="mt-6">
            <MonoCaption>
              {suggestions.length} new candidates · {existingHosts.size} already tracked
            </MonoCaption>
          </div>
          <div className="mt-6 space-y-3">
            {suggestions.map((s, i) => {
              const on = picked.has(i)
              const saved = saveResults[i]
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => s.detection && togglePick(i)}
                  disabled={!s.detection}
                  className={`flex w-full gap-4 rounded-lg border bg-surface p-5 text-left transition-colors disabled:opacity-50 ${
                    on ? 'border-ink' : 'border-line hover:border-line-2'
                  }`}
                >
                  <Checkbox checked={on} onClick={() => s.detection && togglePick(i)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold tracking-tight text-ink">{s.suggestion.name}</span>
                      {s.detection ? (
                        <>
                          <Badge>{s.detection.type}</Badge>
                          <CostBadge d={s.detection} />
                        </>
                      ) : (
                        <Badge muted>unreachable</Badge>
                      )}
                      {saved === 'ok' && <Badge tone="ok">✓ saved</Badge>}
                      {saved && saved !== 'ok' && <Badge tone="err">{saved}</Badge>}
                    </div>
                    <div className="mt-1 font-mono text-[11.5px] text-ink-4 break-all">{s.suggestion.url}</div>
                    {s.suggestion.why && <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{s.suggestion.why}</p>}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-8 flex items-center gap-3 border-t border-line pt-7">
            <Button variant="primary" className="h-11 px-6" disabled={pickedCount === 0 || saving} onClick={saveSources}>
              {saving ? 'Saving…' : `Add ${pickedCount} ${pickedCount === 1 ? 'source' : 'sources'}`}
            </Button>
            <Link href={`/c/${id}`}>
              <Button variant="ghost">Cancel</Button>
            </Link>
          </div>
        </>
      )}
    </main>
  )
}
