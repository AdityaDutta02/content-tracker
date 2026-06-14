'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'
import { MonoCaption } from './primitives'

interface Channel {
  id: string
  name: string
  niche: string
  timezone: string
  last_run_date: string | null
}

interface RailChannel extends Channel {
  newCount: number
}

export function ChannelRail() {
  const pathname = usePathname() ?? '/'
  const { token, viewerId } = useViewer()
  const [channels, setChannels] = useState<RailChannel[]>([])

  useEffect(() => {
    if (!token || !viewerId) return
    fetch(`/api/channels?viewerId=${encodeURIComponent(viewerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(async (d) => {
        const list: Channel[] = d.channels ?? []
        const enriched = await Promise.all(
          list.map(async (c) => {
            try {
              const rr = await fetch(`/api/runs?channelId=${c.id}&limit=1`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then((r) => r.json())
              const newCount = (rr.runs?.[0]?.items_json ?? []).length
              return { ...c, newCount }
            } catch {
              return { ...c, newCount: 0 }
            }
          }),
        )
        setChannels(enriched)
      })
      .catch(() => undefined)
  }, [token, viewerId])

  const onChannel = channels.some((c) => pathname === `/c/${c.id}`)
  if (!onChannel) return null

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-line md:block">
      <div className="flex h-full flex-col px-3 py-5">
        <div className="flex items-center justify-between px-2">
          <Link
            href="/"
            className={`font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors ${
              pathname === '/' ? 'text-ink' : 'text-ink-4 hover:text-ink'
            }`}
          >
            Channels
          </Link>
          <Link
            href="/c/new"
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>

        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto">
          {channels.map((c) => {
            const active = pathname === `/c/${c.id}`
            return (
              <Link
                key={c.id}
                href={`/c/${c.id}`}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors ${
                  active ? 'bg-surface-2' : 'hover:bg-surface-2'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.newCount > 0 ? 'bg-ink' : 'bg-line-2'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] ${active ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>
                    {c.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] lowercase tracking-tight text-ink-4">
                    {c.niche}
                  </span>
                </span>
                {c.newCount > 0 && <span className="font-mono text-[10px] text-ink-3">{c.newCount}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-line px-2 pt-3">
          <MonoCaption>Daily · 10:00 cron</MonoCaption>
        </div>
      </div>
    </aside>
  )
}
