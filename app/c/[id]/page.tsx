'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useViewer } from '@/hooks/use-viewer'
import { hostname, faviconUrl, relativeTime, absoluteTime, cleanTitle, cleanSummary, openExternal } from '@/lib/format'

interface Channel {
  id: string
  name: string
  niche: string
  timezone: string
  last_run_date: string | null
}
interface Item {
  title: string
  url: string
  summary: string | null
  published_at: string | null
  rank: number
  final_score: number | null
  ai_relevance: number | null
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // Build the display list: filter out empty items per run, then drop runs that
  // have nothing left to show. Keep them sorted newest-first (the API already
  // returns runs ordered by run_at desc).
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

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>
  if (!channel) return <main className="container"><p className="muted">Loading channel…</p></main>

  const latestRun = visibleRuns[0]
  const olderRuns = visibleRuns.slice(1)

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
            <RunBlock label={`Latest · ${relativeTime(latestRun.run_at)}`} runAt={latestRun.run_at} items={latestRun.items} />
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
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="stack">
          <Link href={`/c/${id}/sources/add`}><button>+ Add source</button></Link>
          {sources.map((s) => (
            <div key={s.id} className="card source compact">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.label ?? s.url ?? s.handle}</div>
                  <div className="muted" style={{ wordBreak: 'break-all' }}>{s.url ?? `@${s.handle}`}</div>
                  <div style={{ marginTop: 6 }}>
                    <span className="badge">{s.type}</span>
                    {!s.enabled && <span className="badge warn" style={{ marginLeft: 6 }}>disabled</span>}
                    {s.last_fetch_error && <span className="badge err" style={{ marginLeft: 6 }}>err</span>}
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
          ))}
        </div>
      )}
    </main>
  )
}

function RunBlock({ label, runAt, items }: { label: string; runAt: string; items: Item[] }) {
  return (
    <section className="run-block">
      <header className="run-header">
        <span className="run-label">{label}</span>
        <span className="muted" title={absoluteTime(runAt)}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </header>
      <ol className="feed-list">
        {items.map((it, idx) => (
          <FeedItem key={it.canonical_url} item={it} rank={idx + 1} />
        ))}
      </ol>
    </section>
  )
}

function FeedItem({ item, rank }: { item: Item; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const host = hostname(item.url)
  return (
    <li className={`feed-item${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="feed-row"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="feed-rank">{rank}</span>
        <span className="feed-body">
          <span className="feed-title">{item.title}</span>
          <span className="feed-meta">
            <img className="feed-favicon" src={faviconUrl(host)} alt="" width={14} height={14} />
            <span className="feed-host">{host}</span>
            {item.published_at && (
              <>
                <span className="feed-dot" aria-hidden>·</span>
                <span title={absoluteTime(item.published_at)}>{relativeTime(item.published_at)}</span>
              </>
            )}
          </span>
        </span>
        <span className="feed-chev" aria-hidden>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="feed-expand">
          {item.summary && <p className="feed-summary">{item.summary}</p>}
          <button
            type="button"
            className="feed-open"
            onClick={(e) => { e.stopPropagation(); openExternal(item.url) }}
          >
            Open original ↗
          </button>
        </div>
      )}
    </li>
  )
}
