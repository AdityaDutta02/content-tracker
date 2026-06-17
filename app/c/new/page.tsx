'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { Badge, Button, Checkbox, MonoCaption } from '@/components/ui/primitives'

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

type Stage = 'form' | 'discovering' | 'approve'

const TIMEZONES = [
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  'Asia/Calcutta',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Australia/Sydney',
].filter((v, i, a) => a.indexOf(v) === i)

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline gap-2">
        <MonoCaption className="!text-ink-2">{label}</MonoCaption>
        {hint && <span className="font-mono text-[10.5px] lowercase tracking-tight text-ink-4">{hint}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </label>
  )
}

const inputCls =
  'w-full h-11 rounded-md border border-line-2 bg-surface px-3.5 text-[14.5px] text-ink placeholder:text-ink-4 transition-colors focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink'

export default function NewChannelPage() {
  const { token, viewerId } = useViewer()
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('form')
  const [name, setName] = useState('')
  const [niche, setNiche] = useState('')
  const [target, setTarget] = useState('')
  const [desc, setDesc] = useState('')
  const [tz, setTz] = useState(TIMEZONES[0])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [saveResults, setSaveResults] = useState<Record<number, 'ok' | string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!token || !viewerId) {
    return (
      <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
        <MonoCaption>Loading…</MonoCaption>
      </main>
    )
  }

  const canDiscover = name.trim().length > 0 && niche.trim().length >= 2

  async function startDiscovery(e: React.FormEvent) {
    e.preventDefault()
    if (!canDiscover) return
    setStage('discovering')
    setError(null)
    try {
      const cr = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedToken: token,
          viewerId,
          name,
          niche,
          target_group: target || null,
          description: desc || null,
          timezone: tz,
        }),
      })
      const cd = await cr.json()
      if (!cr.ok) throw new Error(cd.error ?? 'Channel create failed')
      setChannelId(cd.channel.id)

      const dr = await fetch(`/api/channels/${cd.channel.id}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      })
      const dd = await dr.json()
      if (!dr.ok) throw new Error(dd.error ?? 'Discover failed')
      setSuggestions(dd.suggestions ?? [])
      const pre = new Set<number>()
      ;(dd.suggestions ?? []).forEach((s: Suggestion, i: number) => {
        if (s.detection && !s.detection.needs_byok) pre.add(i)
      })
      setPicked(pre)
      setStage('approve')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('form')
    }
  }

  function togglePick(i: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function saveSources() {
    if (!channelId) return
    setSaving(true)
    setError(null)
    setSaveResults({})
    try {
      const chosen = Array.from(picked).filter((i) => suggestions[i]?.detection)
      const results = await Promise.all(
        chosen.map(async (i) => {
          const s = suggestions[i]
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
          } catch (err) {
            return { i, status: err instanceof Error ? err.message : String(err) }
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
        setError(`${okCount}/${results.length} saved. ${failCount} failed — uncheck them or retry.`)
        return
      }
      fetch(`/api/channels/${channelId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedToken: token }),
      }).catch(() => undefined)
      router.push(`/c/${channelId}?initialRefresh=1`)
    } finally {
      setSaving(false)
    }
  }

  if (stage === 'form') {
    return (
      <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
        <Link
          href="/"
          className="mb-8 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          All channels
        </Link>

        <MonoCaption>Step 1 of 2</MonoCaption>
        <h1 className="mt-3 font-serif text-6xl leading-[0.95] tracking-tight text-ink">New channel</h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
          Describe the niche. AI scans RSS, Reddit, X and YouTube to assemble a starting set of sources.
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-ink bg-surface px-4 py-3 text-[13px] text-ink">{error}</div>
        )}

        <form className="mt-10 space-y-7" onSubmit={startDiscovery}>
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="AI Coding Digest" />
          </Field>

          <Field label="Niche" hint='short — e.g. "ai coding tools"'>
            <input className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="AI coding tools" />
          </Field>

          <Field label="Target group" hint="who's this for?">
            <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Senior software engineers shipping prod LLM apps" />
          </Field>

          <Field label="Description" hint="what should the feed cover?">
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              placeholder="Daily news on AI coding assistants, IDE integrations, and agent frameworks."
              className="w-full resize-none rounded-md border border-line-2 bg-surface p-3.5 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-4 transition-colors focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </Field>

          <Field label="Timezone">
            <div className="relative">
              <select value={tz} onChange={(e) => setTz(e.target.value)} className={`${inputCls} appearance-none pr-10`}>
                {TIMEZONES.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
              <ArrowRight className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-ink-4" strokeWidth={1.75} />
            </div>
          </Field>

          <div className="border-t border-line pt-7">
            <Button type="submit" variant="primary" className="h-11 px-6" disabled={!canDiscover}>
              Discover sources
              <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </div>
        </form>
      </main>
    )
  }

  if (stage === 'discovering') {
    return (
      <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
        <MonoCaption>Step 2 of 2</MonoCaption>
        <h1 className="mt-3 font-serif text-6xl leading-[0.95] tracking-tight text-ink">{name || 'New channel'}</h1>

        <div className="mt-10 flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-ink" strokeWidth={1.75} />
          <div>
            <p className="text-[14px] font-medium text-ink">Asking AI to find top sources for your niche…</p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Usually 15–30s. Scanning RSS, Reddit, X, YouTube and the open web.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-5">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-2" />
              <div className="mt-2.5 h-2.5 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="mt-4 h-5 w-16 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
      <MonoCaption>Step 2 of 2 · Review</MonoCaption>
      <h1 className="mt-3 font-serif text-5xl leading-[0.95] tracking-tight text-ink">{name || 'New channel'}</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
        Found {suggestions.length} candidate sources for{' '}
        <span className="text-ink">{niche || 'your niche'}</span>. Uncheck anything off-target — you can always tune it later.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-ink bg-surface px-4 py-3 text-[13px] text-ink">{error}</div>
      )}

      <div className="mt-8 space-y-3">
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
        <Button variant="primary" className="h-11 px-6" disabled={picked.size === 0 || saving} onClick={saveSources}>
          {saving ? 'Saving…' : `Create channel with ${picked.size} ${picked.size === 1 ? 'source' : 'sources'}`}
        </Button>
        <Button variant="ghost" onClick={() => setStage('form')} disabled={saving}>
          Back to details
        </Button>
      </div>
    </main>
  )
}
