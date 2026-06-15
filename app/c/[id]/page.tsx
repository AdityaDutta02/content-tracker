'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  EyeOff,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { hostname, faviconUrl, relativeTime, absoluteTime, cleanTitle, cleanSummary, copyUrl } from '@/lib/format'
import { Badge, Button, MonoCaption, SourceGlyph } from '@/components/ui/primitives'

interface Channel {
  id: string
  name: string
  niche: string
  target_group: string | null
  description: string | null
  timezone: string
  last_run_date: string | null
}
interface Item {
  source_id?: string
  title: string
  url: string
  summary: string | null
  image_url: string | null
  published_at: string | null
  canonical_url: string
}
interface Run {
  id: string
  run_at: string
  trigger: string
  status: string
  item_count: number
  credits_used: number
  items_json: Item[]
}
interface Source {
  id: string
  type: string
  label: string | null
  url: string | null
  handle: string | null
  enabled: boolean
  last_fetch_error: string | null
}

export default function ChannelPage() {
  const { token } = useViewer()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params?.id ?? ''
  const initialRefresh = searchParams?.get('initialRefresh') === '1'

  const [channel, setChannel] = useState<Channel | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'feed' | 'sources'>('feed')
  const [feedView, setFeedView] = useState<'grid' | 'list'>('grid')
  const [reloadKey, setReloadKey] = useState(0)
  const [buildingFirstFeed, setBuildingFirstFeed] = useState(initialRefresh)
  const [showSilent, setShowSilent] = useState(false)
  const [toast, setToast] = useState<{ msg: string; actionLabel?: string; onAction?: () => void } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoRefreshedRef = useRef(false)

  useEffect(() => {
    if (!token || !id) return
    const headers = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch(`/api/channels/${id}`, { headers }).then((r) => r.json()),
      fetch(`/api/runs?channelId=${id}`, { headers }).then((r) => r.json()),
      fetch(`/api/channels/${id}/sources`, { headers }).then((r) => r.json()),
    ]).then(([c, rn, src]) => {
      setChannel(c.channel)
      setRuns(rn.runs ?? [])
      setSources(src.sources ?? [])
    })
  }, [token, id, reloadKey])

  useEffect(() => {
    if (!buildingFirstFeed || !token || !id) return
    const start = Date.now()
    const MAX_POLL_MS = 90_000
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/runs?channelId=${id}`, { headers: { Authorization: `Bearer ${token}` } })
        const d = await r.json()
        if ((d.runs ?? []).length > 0) {
          setRuns(d.runs)
          setBuildingFirstFeed(false)
          if (pollRef.current) clearInterval(pollRef.current)
          router.replace(`/c/${id}`)
        } else if (Date.now() - start > MAX_POLL_MS) {
          setBuildingFirstFeed(false)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        /* keep polling */
      }
    }, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [buildingFirstFeed, token, id, router])

  function showToast(msg: string, actionLabel?: string, onAction?: () => void) {
    setToast({ msg, actionLabel, onAction })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  async function handleCopy(url: string) {
    const ok = await copyUrl(url)
    showToast(ok ? 'Link copied — paste in a new tab' : 'Could not copy — long-press the link')
  }

  async function refresh() {
    if (!token || refreshing) return
    setRefreshing(true)
    try {
      const r = await fetch(`/api/channels/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ embedToken: token }),
        signal: AbortSignal.timeout(90_000),
      })
      const d = await r.json()
      if (!r.ok) {
        showToast(d.error ?? 'Refresh failed')
      } else {
        showToast(d.item_count > 0 ? `Got ${d.item_count} fresh items` : 'Scan complete — still quiet')
        setReloadKey((k) => k + 1)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  async function deleteSource(s: Source) {
    if (!token) return
    setSources((prev) => prev.filter((x) => x.id !== s.id))
    showToast(`Removed ${s.label ?? s.url ?? s.handle}`)
    await fetch(`/api/channels/${id}/sources/${s.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined)
  }

  // No client-side age filter: pipeline already gates. Drop only obvious junk
  // (missing title/url, future-dated > 24h). Undated items kept and rendered
  // with "—" timestamp so the feed is never empty.
  const visibleRuns = useMemo(() => {
    const now = Date.now()
    return runs
      .map((run) => ({
        ...run,
        items: (run.items_json ?? [])
          .map((it) => ({ ...it, title: cleanTitle(it.title), summary: cleanSummary(it.summary) }))
          .filter((it) => {
            if (!it.title || !it.url?.trim()) return false
            if (it.published_at) {
              const t = new Date(it.published_at).getTime()
              if (Number.isFinite(t) && t - now > 24 * 60 * 60 * 1000) return false
            }
            return true
          }),
      }))
      .filter((r) => r.items.length > 0)
  }, [runs])

  const activeSourceIds = useMemo(() => {
    const ids = new Set<string>()
    runs.slice(0, 3).forEach((r) => (r.items_json ?? []).forEach((it) => it.source_id && ids.add(it.source_id)))
    return ids
  }, [runs])

  const sourceById = useMemo(() => {
    const m = new Map<string, Source>()
    sources.forEach((s) => m.set(s.id, s))
    return m
  }, [sources])

  const allItems = useMemo(() => visibleRuns.flatMap((r) => r.items), [visibleRuns])

  // Auto-refresh once when channel has sources but no usable items yet.
  // Covers: brand-new channel without a cron run, or a run that returned 0 items.
  useEffect(() => {
    if (autoRefreshedRef.current) return
    if (!token || !channel || refreshing || buildingFirstFeed) return
    if (sources.length === 0) return
    if (allItems.length > 0) return
    autoRefreshedRef.current = true
    setBuildingFirstFeed(true)
    refresh().finally(() => setBuildingFirstFeed(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, channel, sources.length, allItems.length, refreshing, buildingFirstFeed])

  const silentCount = sources.filter((s) => !activeSourceIds.has(s.id)).length
  const errorCount = sources.filter((s) => s.last_fetch_error).length
  const visibleSources = showSilent ? sources : sources.filter((s) => activeSourceIds.has(s.id))

  if (!token) {
    return (
      <main className="mx-auto max-w-prose px-6 py-24 text-center">
        <MonoCaption>Loading…</MonoCaption>
      </main>
    )
  }
  if (!channel) {
    return (
      <main className="mx-auto max-w-prose px-6 py-24 text-center">
        <MonoCaption>Loading channel…</MonoCaption>
      </main>
    )
  }

  const toastEl = toast && (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-4 rounded-lg bg-ink px-4 py-3 text-white"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      <span className="text-[13px]">{toast.msg}</span>
      {toast.actionLabel && (
        <button
          onClick={() => {
            toast.onAction?.()
            setToast(null)
          }}
          className="font-mono text-[10.5px] uppercase tracking-[0.12em] underline underline-offset-2"
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  )

  const latestRunAt = visibleRuns[0]?.run_at ?? runs[0]?.run_at ?? null
  const lastScan = latestRunAt ? relativeTime(latestRunAt) : 'never'

  return (
    <main className="mx-auto max-w-prose px-6 pb-28 pt-12">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          All channels
        </Link>
        <Button variant="outline" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {refreshing ? 'Scanning' : 'Refresh'}
        </Button>
      </div>

      <div className="mt-7">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-5xl leading-none tracking-tight text-ink">{channel.name}</h1>
          <span className="font-mono text-[12px] lowercase tracking-tight text-ink-4">{channel.niche}</span>
        </div>
        {(channel.target_group || channel.description) && (
          <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-ink-3">
            {channel.target_group ?? channel.description}
          </p>
        )}
      </div>

      <div className="mt-9 flex items-center gap-7 border-b border-line">
        {(['feed', 'sources'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px flex items-center gap-2 border-b-2 pb-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
              tab === t ? 'border-ink text-ink' : 'border-transparent text-ink-4 hover:text-ink-2'
            }`}
          >
            {t}
            <span className={`rounded-full px-1.5 text-[10px] ${tab === t ? 'bg-ink text-white' : 'bg-surface-2 text-ink-4'}`}>
              {t === 'feed' ? allItems.length : sources.length}
            </span>
          </button>
        ))}
      </div>

      {tab === 'feed' && (
        <>
          {errorCount > 0 && (
            <button
              onClick={() => setTab('sources')}
              className="mt-7 flex w-full items-center gap-2.5 rounded-lg border border-line-2 bg-surface-2 px-4 py-3 text-left transition-colors hover:border-ink"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-ink" strokeWidth={1.75} />
              <span className="flex-1 text-[13px] text-ink-2">
                {errorCount} {errorCount > 1 ? 'sources' : 'source'} failed to fetch in the last run.
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink underline underline-offset-2">Review</span>
            </button>
          )}

          {buildingFirstFeed && allItems.length === 0 ? (
            <div className="mt-7 rounded-lg border border-line bg-surface px-5 py-4 flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-ink" strokeWidth={1.75} />
              <div>
                <p className="text-[14px] font-medium text-ink">Building your first feed…</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">Usually 20–60s.</p>
              </div>
            </div>
          ) : allItems.length === 0 ? (
            <div className="mt-7 rounded-lg border border-dashed border-line-2 bg-surface px-8 py-14 text-center">
              <p className="font-serif text-2xl tracking-tight text-ink">Feed is quiet right now</p>
              <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
                Sources returned nothing usable. Scan again, add more sources, or wait for tomorrow&rsquo;s 10:00 cron.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button variant="primary" onClick={refresh} disabled={refreshing}>
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {refreshing ? 'Scanning' : 'Refresh now'}
                </Button>
                <Button variant="outline" onClick={() => setTab('sources')}>
                  Manage sources
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 mt-7 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <MonoCaption className="!text-ink-2">Latest · {lastScan}</MonoCaption>
                  <span className="h-1 w-1 rounded-full bg-line-2" />
                  <MonoCaption>{allItems.length} items</MonoCaption>
                </div>
                <div className="flex items-center rounded-md border border-line bg-surface p-0.5">
                  {([['grid', LayoutGrid], ['list', List]] as const).map(([v, Icon]) => (
                    <button
                      key={v}
                      onClick={() => setFeedView(v)}
                      className={`flex h-6 w-7 items-center justify-center rounded-[5px] transition-colors ${
                        feedView === v ? 'bg-ink text-white' : 'text-ink-4 hover:text-ink'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  ))}
                </div>
              </div>

              {feedView === 'grid' ? (
                <div className="columns-1 gap-4 md:columns-2">
                  {allItems.map((item) => (
                    <FeedCard key={item.canonical_url} item={item} source={item.source_id ? sourceById.get(item.source_id) : undefined} onCopy={handleCopy} />
                  ))}
                </div>
              ) : (
                <div className="border-t border-line">
                  {allItems.map((item) => (
                    <FeedRow key={item.canonical_url} item={item} source={item.source_id ? sourceById.get(item.source_id) : undefined} onCopy={handleCopy} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'sources' && (
        <div className="mt-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/c/${id}/sources/add`}>
                <Button variant="primary">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  Add source
                </Button>
              </Link>
              <Link href={`/c/${id}/discover-more`}>
                <Button variant="outline">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Find more
                </Button>
              </Link>
            </div>
            {silentCount > 0 && (
              <Button variant="ghost" onClick={() => setShowSilent((v) => !v)}>
                <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                {showSilent ? 'Hide' : 'Show'} {silentCount} silent
              </Button>
            )}
          </div>

          {visibleSources.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-line-2 bg-surface px-8 py-12 text-center">
              {sources.length === 0 ? (
                <>
                  <p className="font-serif text-2xl tracking-tight text-ink">No sources yet</p>
                  <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
                    Add a feed by hand or let AI find sources for your niche.
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Link href={`/c/${id}/sources/add`}>
                      <Button variant="primary">
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        Add source
                      </Button>
                    </Link>
                    <Link href={`/c/${id}/discover-more`}>
                      <Button variant="outline">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Find more
                      </Button>
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-serif text-2xl tracking-tight text-ink">All {silentCount} sources are silent</p>
                  <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-3">
                    Silent sources are scanned but kept out of the feed. Show them to manage or remove.
                  </p>
                  <Button variant="primary" className="mt-6" onClick={() => setShowSilent(true)}>
                    <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Show silent sources
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="mt-5 border-t border-line">
              {visibleSources.map((s) => {
                const error = !!s.last_fetch_error
                const silent = !activeSourceIds.has(s.id)
                return (
                  <div key={s.id} className="group flex items-center justify-between gap-4 border-b border-line py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface ${
                          error ? 'border-ink text-ink' : 'border-line text-ink-3'
                        }`}
                      >
                        <SourceGlyph type={s.type} className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-ink">
                            {s.label ?? s.url ?? s.handle ?? '—'}
                          </span>
                          <Badge>{s.type}</Badge>
                          {silent && <Badge muted>silent</Badge>}
                          {!s.enabled && <Badge muted>disabled</Badge>}
                          {error && (
                            <span className="inline-flex h-[18px] items-center gap-1 rounded-[4px] border border-ink px-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink">
                              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
                              fetch failed
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-4">
                          {error ? (s.last_fetch_error ?? 'Could not reach this feed') : s.url ?? `@${s.handle}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => deleteSource(s)}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4 opacity-0 transition-colors hover:bg-surface-2 hover:text-ink group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {toastEl}
    </main>
  )
}

function FeedCard({ item, source, onCopy }: { item: Item; source?: Source; onCopy: (url: string) => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  const host = hostname(item.url)
  const sourceName = source?.label ?? host
  const showHero = !!item.image_url && !imgFailed
  return (
    <article className="mb-4 break-inside-avoid rounded-lg border border-line bg-surface transition-colors hover:border-line-2 overflow-hidden">
      {showHero && (
        <div className="relative aspect-[16/9] overflow-hidden bg-surface-2">
          <img
            src={item.image_url!}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
          />
        </div>
      )}
      <div className="p-5">
        <div className="flex items-center gap-2 text-ink-3">
          <SourceGlyph type={source?.type ?? 'web'} className="h-3.5 w-3.5" />
          <MonoCaption className="!text-ink-3">{sourceName}</MonoCaption>
          {item.published_at && (
            <>
              <span className="h-0.5 w-0.5 rounded-full bg-line-2" />
              <MonoCaption title={absoluteTime(item.published_at)}>{relativeTime(item.published_at)}</MonoCaption>
            </>
          )}
          <img className="ml-auto opacity-60" src={faviconUrl(host)} alt="" width={14} height={14} />
        </div>
        <h3 className="mt-3 font-serif text-[21px] leading-[1.15] tracking-tight text-ink line-clamp-3">{item.title}</h3>
        {item.summary && <p className="mt-2 text-[13px] leading-relaxed text-ink-3 line-clamp-3">{item.summary}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCopy(item.url)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-surface px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            Copy link
          </button>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4 transition-colors hover:text-ink"
          >
            Open <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </article>
  )
}

function FeedRow({ item, source, onCopy }: { item: Item; source?: Source; onCopy: (url: string) => void }) {
  const sourceName = source?.label ?? hostname(item.url)
  return (
    <article className="border-b border-line py-4">
      <div className="flex items-center gap-2 text-ink-3">
        <SourceGlyph type={source?.type ?? 'web'} className="h-3.5 w-3.5" />
        <MonoCaption className="!text-ink-3">{sourceName}</MonoCaption>
        {item.published_at && (
          <>
            <span className="h-0.5 w-0.5 rounded-full bg-line-2" />
            <MonoCaption title={absoluteTime(item.published_at)}>{relativeTime(item.published_at)}</MonoCaption>
          </>
        )}
        <button
          type="button"
          onClick={() => onCopy(item.url)}
          className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4 transition-colors hover:text-ink"
        >
          Copy
        </button>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-4 transition-colors hover:text-ink"
        >
          Open ↗
        </a>
      </div>
      <h3 className="mt-1.5 font-serif text-xl leading-snug tracking-tight text-ink">{item.title}</h3>
      {item.summary && <p className="mt-1 text-[13px] leading-relaxed text-ink-3 line-clamp-1">{item.summary}</p>}
    </article>
  )
}
