import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbList } from '@/lib/db'
import { runChannelPipeline } from '@/lib/pipeline'
import { errorResponse } from '@/lib/api-helpers'
import { getEmbedToken } from '@/lib/auth'
import type { ChannelRow } from '@/lib/types'

const RATE_LIMIT_MINUTES = 60

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { embedToken?: string }
    const token = getEmbedToken(req, body)
    const channel = await dbGet<ChannelRow>('channels', params.id, token)

    // rate-limit: check last manual run
    const runs = await dbList<{ run_at: string; trigger: string }>(
      'runs',
      { channel_id: channel.id, trigger: 'manual' },
      token,
    )
    const lastManual = runs
      .map((r) => new Date(r.run_at).getTime())
      .sort((a, b) => b - a)[0]
    if (lastManual && Date.now() - lastManual < RATE_LIMIT_MINUTES * 60 * 1000) {
      const waitMin = Math.ceil((RATE_LIMIT_MINUTES * 60 * 1000 - (Date.now() - lastManual)) / 60000)
      return NextResponse.json({ error: `Wait ${waitMin}m before next refresh`, code: 'RATE_LIMIT' }, { status: 429 })
    }

    const result = await runChannelPipeline(channel, token, 'manual')
    return NextResponse.json(result)
  } catch (e) {
    return errorResponse(e)
  }
}
