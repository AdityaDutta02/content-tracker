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
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  async function deleteChannel(id: string) {
    if (!token) return
    setDeletingId(id)
    setError(null)
    try {
      const r = await fetch(`/api/channels/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `Delete failed (${r.status})`)
      }
      setChannels((cur) => (cur ?? []).filter((c) => c.id !== id))
      setConfirmId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

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
        <div className="empty">
          <h3>No channels yet</h3>
          <p className="muted">Create one to start tracking news for your niche.</p>
          <Link href="/c/new"><button>+ Create your first channel</button></Link>
        </div>
      )}
      {channels?.map((c) => (
        <div key={c.id} className="card channel">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Link href={`/c/${c.id}`} style={{ flex: 1, display: 'block' }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
              <div className="muted">{c.niche}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {c.timezone} · last run {c.last_run_date ?? 'never'}
              </div>
            </Link>
            {confirmId === c.id ? (
              <div className="confirm-row" style={{ marginLeft: 12 }}>
                <span className="muted">Delete?</span>
                <button
                  className="danger"
                  onClick={() => deleteChannel(c.id)}
                  disabled={deletingId === c.id}
                >
                  {deletingId === c.id ? 'Deleting…' : 'Yes'}
                </button>
                <button
                  className="secondary"
                  onClick={() => setConfirmId(null)}
                  disabled={deletingId === c.id}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="danger"
                onClick={() => setConfirmId(c.id)}
                style={{ marginLeft: 12 }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </main>
  )
}
