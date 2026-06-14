'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import { useViewer } from '@/hooks/use-viewer'

export function TopBar() {
  const { token, viewerId } = useViewer()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!token || !viewerId) return
    fetch(`/api/channels?viewerId=${encodeURIComponent(viewerId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setCount((d.channels ?? []).length))
      .catch(() => undefined)
  }, [token, viewerId])

  const initial = viewerId ? viewerId.slice(0, 1).toUpperCase() : '·'

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-bg">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-ink text-white">
            <Radio className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-ink-4">marketing-os</span>
          <span className="text-ink-4">/</span>
          <span className="text-[13px] font-semibold tracking-tight text-ink">Niche Wire</span>
        </Link>

        <div className="flex items-center gap-3">
          {count !== null && (
            <span className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 font-mono text-[11px] text-ink-3">
              <span className="h-1.5 w-1.5 rounded-full bg-ink" />
              {count}
            </span>
          )}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
            {initial}
          </span>
        </div>
      </div>
    </header>
  )
}
