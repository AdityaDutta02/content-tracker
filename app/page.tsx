'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useViewer } from '@/hooks/use-viewer'

interface Channel {
  id: string
  name: string
  niche: string
  timezone: string
  last_run_date: string | null
}

export default function HomePage() {
  const { token, viewerId } = useViewer()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !viewerId) return
    fetch(`/api/channels?viewerId=${encodeURIComponent(viewerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setChannels(d.channels ?? [])
      })
      .catch((e) => setError(String(e)))
  }, [token, viewerId])

  if (!token) return <main className="container"><p className="muted">Loading…</p></main>

  return (
    <main className="container stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Channels</h1>
        <Link href="/c/new"><button>+ New</button></Link>
      </div>
      {error && <div className="card" style={{ borderColor: '#c33' }}>{error}</div>}
      {channels === null && <p className="muted">Loading channels…</p>}
      {channels?.length === 0 && (
        <div className="card">
          <p>No channels yet. Create one to start tracking news for your niche.</p>
        </div>
      )}
      {channels?.map((c) => (
        <Link key={c.id} href={`/c/${c.id}`} style={{ display: 'block' }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
            <div className="muted">{c.niche}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {c.timezone} · last run {c.last_run_date ?? 'never'}
            </div>
          </div>
        </Link>
      ))}
    </main>
  )
}
