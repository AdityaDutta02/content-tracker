'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { Button, MonoCaption, SourceGlyph } from '@/components/ui/primitives'
import { relativeTime } from '@/lib/format'

interface Channel {
  id: string
  name: string
  niche: string
  target_group: string | null
  description: string | null
  timezone: string
  last_run_date: string | null
}

interface ChannelCard extends Channel {
  newCount: number
  updated: string
  sourceTypes: string[]
  sourcesCount: number
}

export default function HomePage() {
  const { token, viewerId } = useViewer()
  const [channels, setChannels] = useState<ChannelCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !viewerId) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await fetch(`/api/channels?viewerId=${encodeURIComponent(viewerId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())
        if (d.error) throw new Error(d.error)
        const list: Channel[] = d.channels ?? []
        const enriched = await Promise.all(
          list.map(async (c) => {
            const [runs, sources] = await Promise.all([
              fetch(`/api/runs?channelId=${c.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
              fetch(`/api/channels/${c.id}/sources`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
            ])
            const latest = runs.runs?.[0]
            const newCount = (latest?.items_json ?? []).length
            const updated = latest?.run_at ? relativeTime(latest.run_at) : c.last_run_date ?? 'never'
            const srcList = (sources.sources ?? []) as Array<{ type: string }>
            const sourceTypes = Array.from(new Set(srcList.map((s) => s.type)))
            return { ...c, newCount, updated, sourceTypes, sourcesCount: srcList.length }
          }),
        )
        if (!cancelled) setChannels(enriched)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, viewerId])

  if (!token) {
    return (
      <main className="mx-auto max-w-prose px-6 pb-28 pt-16">
        <MonoCaption>Loading</MonoCaption>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-prose px-6 pb-28 pt-16">
      <header className="flex items-end justify-between gap-6 border-b border-line pb-8">
        <div>
          <MonoCaption>Workspace</MonoCaption>
          <h1 className="mt-3 font-serif text-6xl leading-[0.95] tracking-tight text-ink">Channels</h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
            {(channels?.length ?? 0)} niche feeds, scanned across RSS, Reddit, X and YouTube. Refreshed daily at 10:00.
          </p>
        </div>
        <Link href="/c/new">
          <Button variant="primary" className="h-10 px-5">
            <Plus className="h-4 w-4" strokeWidth={2} />
            New channel
          </Button>
        </Link>
      </header>

      {error && (
        <div className="mt-6 rounded-lg border border-ink bg-surface px-4 py-3 text-[13px] text-ink">{error}</div>
      )}

      {channels === null && (
        <div className="py-7">
          <MonoCaption>Loading channels…</MonoCaption>
        </div>
      )}

      {channels?.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-line-2 bg-surface px-8 py-16 text-center">
          <p className="font-serif text-3xl tracking-tight text-ink">No channels yet</p>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
            Create one to start tracking news for your niche.
          </p>
          <Link href="/c/new" className="mt-6 inline-block">
            <Button variant="primary">
              <Plus className="h-4 w-4" strokeWidth={2} />
              Create your first channel
            </Button>
          </Link>
        </div>
      )}

      <ul>
        {channels?.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.id}`}
              className="group flex items-start justify-between gap-8 border-b border-line py-7 transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-serif text-[28px] leading-none tracking-tight text-ink">{c.name}</h2>
                  <span className="font-mono text-[11px] lowercase tracking-tight text-ink-4">{c.niche}</span>
                </div>
                <p className="mt-2.5 max-w-lg text-[13.5px] leading-relaxed text-ink-3 line-clamp-2">
                  {c.description ?? c.target_group ?? ''}
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex items-center -space-x-px">
                    {c.sourceTypes.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink-3"
                      >
                        <SourceGlyph type={t} className="h-3 w-3" />
                      </span>
                    ))}
                  </div>
                  <MonoCaption>{c.sourcesCount} sources</MonoCaption>
                  <span className="h-1 w-1 rounded-full bg-line-2" />
                  <MonoCaption>{c.updated}</MonoCaption>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-5 pt-1">
                <div className="text-right">
                  {c.newCount > 0 ? (
                    <>
                      <div className="font-serif text-4xl leading-none tracking-tight text-ink">{c.newCount}</div>
                      <MonoCaption className="!text-ink-3">new</MonoCaption>
                    </>
                  ) : (
                    <>
                      <div className="font-serif text-4xl leading-none tracking-tight text-ink-4">0</div>
                      <MonoCaption>quiet</MonoCaption>
                    </>
                  )}
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-4 transition-colors group-hover:border-ink group-hover:text-ink">
                  <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
