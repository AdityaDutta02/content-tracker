import { NextRequest, NextResponse } from 'next/server'
import { dbList } from '@/lib/db'
import { runChannelPipeline } from '@/lib/pipeline'
import { getEmbedToken } from '@/lib/auth'
import type { ChannelRow } from '@/lib/types'

// Hourly cron. For each channel: if local time = 10am and not yet run today, run.
export async function POST(req: NextRequest) {
  try {
    const token = getEmbedToken(req)
    const channels = await dbList<ChannelRow>('channels', {}, token)
    const utcNow = new Date()

    const results: Array<{ channel_id: string; status: string; item_count?: number; skipped?: string }> = []

    for (const channel of channels) {
      const localHour = hourInTz(utcNow, channel.timezone)
      const todayInTz = dateInTz(utcNow, channel.timezone)

      if (localHour !== 10) {
        results.push({ channel_id: channel.id, status: 'skipped', skipped: `local=${localHour}h` })
        continue
      }
      if (channel.last_run_date === todayInTz) {
        results.push({ channel_id: channel.id, status: 'skipped', skipped: 'already_ran_today' })
        continue
      }

      try {
        const r = await runChannelPipeline(channel, token, 'cron')
        results.push({ channel_id: channel.id, status: r.status, item_count: r.item_count })
      } catch (e) {
        results.push({ channel_id: channel.id, status: 'error', skipped: e instanceof Error ? e.message : 'unknown' })
      }
    }

    return NextResponse.json({ ran_at: utcNow.toISOString(), results })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'cron failed' }, { status: 500 })
  }
}

function hourInTz(utc: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    return Number(fmt.format(utc).replace(/[^0-9]/g, ''))
  } catch {
    return utc.getUTCHours()
  }
}

function dateInTz(utc: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    return fmt.format(utc)
  } catch {
    return utc.toISOString().slice(0, 10)
  }
}
