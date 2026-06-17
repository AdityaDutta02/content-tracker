import { NextRequest, NextResponse } from 'next/server'
import { dbList } from '@/lib/db'
import { runChannelPipeline } from '@/lib/pipeline'
import { getEmbedToken } from '@/lib/auth'
import { dateInTz, hourInTz } from '@/lib/time'
import type { ChannelRow } from '@/lib/types'

// Hourly cron. For each channel: if local time = 10am and not yet run today, run.
// AUTH: the scheduled-task callback carries a task token in the Authorization
// header (app-creator identity, owner-scoped). The DB is per-app, so listing
// 'channels' with no filter returns every owned channel. We also accept the
// token in the POST body as a fallback. (issue #20)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = getEmbedToken(req, body)
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
