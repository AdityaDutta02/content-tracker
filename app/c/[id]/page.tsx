'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useViewer } from '@/hooks/use-viewer'
import { hostname, faviconUrl, relativeTime, absoluteTime, cleanTitle, cleanSummary, copyUrl } from '@/lib/format'

interface Channel {
  id: string
  name: string
  niche: string
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
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<'feed' | 'sources'>('feed')
  const [reloadKey, setReloadKey] = useState(0)
  const [buildingFirstFeed, setBuildingFirstFeed] = useState(initialRefresh)
  const [showHistory, setShowHistory] = useState(false)
  const [showSilent, setShowSilent] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
          setRefreshMsg('First feed taking longer than expected. Hit Refresh to retry.')
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

  function flashToast(msg: string) {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2400)
  }

  async function handleCopy(url: string) {
    const ok = await copyUrl(url)
    flashToast(ok ? 'Link copied — paste in a new tab' : 'Could not copy — long-press the link')
  }

  async function refresh() {
    if (!token) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const r = await fetch(`/api/channels/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ embedToken: token }),
        signal: AbortSignal.timeout(90_000),
      })
      const d = await r.json()
      if (!r.ok) {
        setRefreshMsg(d.error ?? 'Refresh failed')
      } else {
        setRefreshMsg(`Got ${d.item_count} items · ${d.credits_used} credits`)
        setReloadKey((k) => k + 1)
      }
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  // Clean + filter items per run, drop runs with nothing to show.
  const visibleRuns = useMemo(() => {
    return runs
      .map((run) => ({
        ...run,
        items: (run.items_json ?? [])
          .map((it) => ({ ...it, title: cleanTitle(it.title), summary: cleanSummary(it.summary) }))
          .filter((it) => it.title && it.url?.trim()),
      }))
      .filter((r) => r.items.length > 0)
  }, [runs])

  // Source IDs that produced items in last 3 runs — used to hide silent sources.
  const activeSourceIds = useMemo(() => {
    const ids = new Set<string>()
    runs.slice(0, 3).forEach((r) => (r.items_json ?? []).forEach((it) => it.source_id && ids.add(it.source_id)))
    return ids
  }, [runs])

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>
  if (!channel) return <main className="container"><p className="muted">Loading channel…</p></main>

  const latestRun = visibleRuns[0]
  const olderRuns = visibleRuns.slice(1)
  const visibleSources = showSilent ? sources : sources.filter((s) => activeSourceIds.has(s.id))
  const silentCount = sources.length - visibleSources.length

  return (
    <main className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>{channel.name}</h1>
          <div className="muted">{channel.niche}</div>
        </div>
        <Link href="/"><button className="secondary">Back</button></Link>
      </div>

      <div className="row tab-row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <button onClick={() => setTab('feed')} className={tab === 'feed' ? '' : 'secondary'}>Feed</button>
          <button onClick={() => setTab('sources')} className={tab === 'sources' ? '' : 'secondary'}>Sources ({sources.length})</button>
        </div>
        <button onClick={refresh} disabled={refreshing} className="secondary">{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>
      {refreshMsg && <div className="card muted">{refreshMsg}</div>}

      {tab === 'feed' && (
        <div className="stack">
          {buildingFirstFeed && visibleRuns.length === 0 && (
            <div className="card">
              <p><span className="spinner" />Building your first feed… <span className="muted">(usually 20–60s)</span></p>
            </div>
          )}
          {!buildingFirstFeed && visibleRuns.length === 0 && (
            <div className="card">
              <p>No items yet. Hit Refresh, or wait for tomorrow&apos;s 10am cron.</p>
            </div>
          )}

          {latestRun && (
            <RunBlock label={`Latest · ${relativeTime(latestRun.run_at)}`} runAt={latestRun.run_at} items={latestRun.items} onCopy={handleCopy} />
          )}

          {olderRuns.length > 0 && (
            <div className="stack">
              <button
                className="secondary older-toggle"
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? '− Hide history' : `+ ${olderRuns.length} earlier run${olderRuns.length === 1 ? '' : 's'}`}
              </button>
              {showHistory && olderRuns.map((run) => (
                <RunBlock
                  key={run.id}
                  label={relativeTime(run.run_at)}
                  runAt={run.run_at}
                  items={run.items}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Link href={`/c/${id}/sources/add`}><button>+ Add source</button></Link>
            {silentCount > 0 && (
              <button className="secondary older-toggle" onClick={() => setShowSilent((v) => !v)}>
                {showSilent ? `− Hide ${silentCount} silent` : `+ Show ${silentCount} silent`}
              </button>
            )}
          </div>
          {visibleSources.length === 0 && (
            <p className="muted">No sources to show. {silentCount > 0 && 'All sources have been silent in recent runs.'}</p>
          )}
          {visibleSources.map((s) => {
            const isSilent = !activeSourceIds.has(s.id)
            return (
              <div key={s.id} className={`card source compact${isSilent ? ' silent' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.label ?? s.url ?? s.handle}</div>
                    <div className="muted" style={{ wordBreak: 'break-all' }}>{s.url ?? `@${s.handle}`}</div>
                    <div style={{ marginTop: 6 }}>
                      <span className="badge">{s.type}</span>
                      {!s.enabled && <span className="badge warn" style={{ marginLeft: 6 }}>disabled</span>}
                      {s.last_fetch_error && <span className="badge err" style={{ marginLeft: 6 }}>err</span>}
                      {isSilent && <span className="badge warn" style={{ marginLeft: 6 }}>silent</span>}
                    </div>
                    {s.last_fetch_error && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{s.last_fetch_error}</div>}
                  </div>
                  <button
                    className="danger"
                    onClick={async () => {
                      await fetch(`/api/channels/${id}/sources/${s.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                      })
                      setSources(sources.filter((x) => x.id !== s.id))
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  )
}

function RunBlock({
  label,
  runAt,
  items,
  onCopy,
}: {
  label: string
  runAt: string
  items: Item[]
  onCopy: (url: string) => void
}) {
  return (
    <section className="run-block">
      <header className="run-header">
        <span className="run-label">{label}</span>
        <span className="muted" title={absoluteTime(runAt)}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </header>
      <div className="feed-grid">
        {items.map((it) => (
          <FeedCard key={it.canonical_url} item={it} onCopy={onCopy} />
        ))}
      </div>
    </section>
  )
}

function FeedCard({ item, onCopy }: { item: Item; onCopy: (url: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const host = hostname(item.url)
  const showHero = !!item.image_url && !imgFailed
  return (
    <article className={`card-item${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="card-clickable"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {showHero && (
          <div className="card-hero">
            <img
              src={item.image_url!}
              alt=""
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          </div>
        )}
        <div className="card-body">
          <div className="card-source">
            <img className="card-favicon" src={faviconUrl(host)} alt="" width={16} height={16} />
            <span className="card-host">{host}</span>
            {item.published_at && (
              <>
                <span className="card-dot" aria-hidden>·</span>
                <span title={absoluteTime(item.published_at)}>{relativeTime(item.published_at)}</span>
              </>
            )}
          </div>
          <h3 className="card-title">{item.title}</h3>
          {item.summary && <p className={`card-summary${expanded ? '' : ' clamp'}`}>{item.summary}</p>}
        </div>
      </button>
      {expanded && (
        <div className="card-actions">
          <button
            type="button"
            className="card-open"
            onClick={(e) => {
              e.stopPropagation()
              onCopy(item.url)
            }}
          >
            Copy link ⧉
          </button>
          <a
            className="card-link-fallback"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            or open ↗
          </a>
        </div>
      )}
    </article>
  )
}
