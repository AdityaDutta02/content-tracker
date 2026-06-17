'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Globe, Loader2 } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { Badge, Button, MonoCaption } from '@/components/ui/primitives'

interface Detection {
  type: string
  url?: string
  handle?: string
  scrape_config: Record<string, unknown>
  tier?: string
  sample?: { title: string; url: string }
  needs_byok?: boolean
  cost?: 'free' | 'byok'
  health?: 'ok' | 'low' | 'untested' | 'down'
}

// FREE (green) — native / working rsshub. BYOK (amber) — apify-only.
// DOWN (red) — every tier probe-failed. Defaults to FREE when unmarked.
function CostBadge({ d }: { d: Detection }) {
  if (d.health === 'down') return <Badge tone="err">down</Badge>
  if (d.health === 'low') return <Badge tone="warn">low quality</Badge>
  if (d.cost === 'byok') return <Badge tone="warn">byok</Badge>
  return <Badge tone="ok">free</Badge>
}

const inputCls =
  'w-full h-11 rounded-md border border-line-2 bg-surface px-3.5 text-[14.5px] text-ink placeholder:text-ink-4 transition-colors focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink'

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
        href={`/c/${channelId}`}
        className="mb-8 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Back to channel
      </Link>

      <MonoCaption>Manual</MonoCaption>
      <h1 className="mt-3 font-serif text-5xl leading-[0.95] tracking-tight text-ink">Add source</h1>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
        Paste a URL or @handle. We&apos;ll probe it to pick the best fetch method.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-ink bg-surface px-4 py-3 text-[13px] text-ink">{error}</div>
      )}

      <div className="mt-8 space-y-5">
        <label className="block">
          <MonoCaption className="!text-ink-2">URL or @handle</MonoCaption>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && probe()}
                placeholder="https://arxiv.org/list/cs.AI/new  or  @paulg"
                className={`${inputCls} pl-10`}
              />
            </div>
            <Button variant="primary" onClick={probe} disabled={loading || !input}>
              {loading && !detection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {loading && !detection ? 'Probing' : 'Detect'}
            </Button>
          </div>
        </label>

        {detection && (
          <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{detection.type}</Badge>
              <CostBadge d={detection} />
              {detection.needs_byok && detection.type === 'web' && <Badge muted>needs Firecrawl key</Badge>}
            </div>

            {detection.sample && (
              <div className="text-[13px] text-ink-3">
                Sample:{' '}
                <a className="text-ink underline underline-offset-2" href={detection.sample.url} target="_blank" rel="noreferrer">
                  {detection.sample.title}
                </a>
              </div>
            )}

            <label className="block">
              <MonoCaption className="!text-ink-2">Label (optional)</MonoCaption>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="arxiv cs.AI"
                className={`${inputCls} mt-2`}
              />
            </label>

            <div className="flex items-center gap-3 border-t border-line pt-4">
              <Button variant="primary" onClick={save} disabled={loading}>
                {loading ? 'Saving…' : 'Save source'}
              </Button>
              <Button variant="ghost" onClick={() => setDetection(null)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
