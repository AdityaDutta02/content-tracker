'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useViewer } from '@/hooks/use-viewer'

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

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>
  if (!channel) return <main className="container"><p className="muted">Loading channel…</p></main>

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
          {buildingFirstFeed && runs.length === 0 && (
            <div className="card">
              <p>Building your first feed… <span className="muted">(usually 20–60s)</span></p>
            </div>
          )}
          {!buildingFirstFeed && runs.length === 0 && (
            <div className="card">
              <p>No runs yet. Hit Refresh, or wait for tomorrow&apos;s 10am cron.</p>
            </div>
          )}
          {runs.map((run) => (
            <div key={run.id} className="stack">
              <h2>
                {new Date(run.run_at).toLocaleString()}{' '}
                <span
                  className={`badge ${
                    run.item_count > 0 && run.status === 'ok'
                      ? 'ok'
                      : run.item_count > 0
                        ? 'warn'
                        : 'err'
                  }`}
                  title={`status: ${run.status} · trigger: ${run.trigger}`}
                >
                  {run.item_count > 0
                    ? `${run.item_count} items · ${run.trigger}`
                    : `no items · ${run.trigger}`}
                </span>
              </h2>
              {(run.items_json ?? []).length === 0 && <div className="card muted">No items in this run</div>}
              {(run.items_json ?? []).map((it) => (
                <div key={`${run.id}:${it.canonical_url}`} className="card run">
                  <a href={it.url} target="_blank" rel="noopener noreferrer">
                    <span className="rank-num">{it.rank}.</span> {it.title}
                  </a>
                  {it.summary && <div className="muted" style={{ marginTop: 6 }}>{it.summary.slice(0, 200)}</div>}
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    rel {fmt(it.ai_relevance)} · score {fmt(it.final_score)}
                    {it.published_at && ` · ${new Date(it.published_at).toLocaleString()}`}
                  </div>
                </div>
              ))}
            </div>
          ))}
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

function fmt(n: number | null) {
  return n == null ? '–' : n.toFixed(2)
}
