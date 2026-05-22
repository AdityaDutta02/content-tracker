'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
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
  id: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  rank: number | null
  run_date: string
  final_score: number | null
  ai_relevance: number | null
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
  const id = params?.id ?? ''
  const [channel, setChannel] = useState<Channel | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<'feed' | 'sources'>('feed')

  useEffect(() => {
    if (!token || !id) return
    const headers = { Authorization: `Bearer ${token}` }
    Promise.all([
      fetch(`/api/channels/${id}`, { headers }).then((r) => r.json()),
      fetch(`/api/items?channelId=${id}`, { headers }).then((r) => r.json()),
      fetch(`/api/channels/${id}/sources`, { headers }).then((r) => r.json()),
    ]).then(([c, it, src]) => {
      setChannel(c.channel)
      setItems(it.items ?? [])
      setSources(src.sources ?? [])
    })
  }, [token, id, refreshing])

  async function refresh() {
    if (!token) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const r = await fetch(`/api/channels/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ embedToken: token }),
      })
      const d = await r.json()
      if (!r.ok) {
        setRefreshMsg(d.error ?? 'Refresh failed')
      } else {
        setRefreshMsg(`Got ${d.item_count} items · ${d.credits_used} credits`)
      }
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>
  if (!channel) return <main className="container"><p className="muted">Loading channel…</p></main>

  const grouped = groupByDate(items)

  return (
    <main className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>{channel.name}</h1>
          <div className="muted">{channel.niche}</div>
        </div>
        <Link href="/"><button className="secondary">Back</button></Link>
      </div>

      <div className="row">
        <button onClick={() => setTab('feed')} className={tab === 'feed' ? '' : 'secondary'}>Feed</button>
        <button onClick={() => setTab('sources')} className={tab === 'sources' ? '' : 'secondary'}>Sources ({sources.length})</button>
        <button onClick={refresh} disabled={refreshing} className="secondary">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {refreshMsg && <div className="card muted">{refreshMsg}</div>}

      {tab === 'feed' && (
        <div className="stack">
          {items.length === 0 && (
            <div className="card">
              <p>No items yet. Hit Refresh, or wait for tomorrow&apos;s 10am run.</p>
            </div>
          )}
          {Object.entries(grouped).map(([date, dayItems]) => (
            <div key={date} className="stack">
              <h2>{date}</h2>
              {dayItems.map((it) => (
                <div key={it.id} className="card">
                  <a href={it.url} target="_blank" rel="noopener noreferrer">
                    <span className="rank-num">{it.rank ?? '–'}.</span> {it.title}
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
            <div key={s.id} className="card">
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
                  className="secondary"
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

function groupByDate(items: Item[]): Record<string, Item[]> {
  const out: Record<string, Item[]> = {}
  for (const it of items) {
    if (!out[it.run_date]) out[it.run_date] = []
    out[it.run_date].push(it)
  }
  return out
}
