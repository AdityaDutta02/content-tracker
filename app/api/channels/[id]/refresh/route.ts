import { NextRequest, NextResponse } from 'next/server'
import { dbGet } from '@/lib/db'
import { runChannelPipeline } from '@/lib/pipeline'
import { errorResponse } from '@/lib/api-helpers'
import { getEmbedToken } from '@/lib/auth'
import type { ChannelRow } from '@/lib/types'

const HARD_TIMEOUT_MS = 60_000

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { embedToken?: string }
    const token = getEmbedToken(req, body)
    const channel = await dbGet<ChannelRow>('channels', params.id, token)

    const pipeline = runChannelPipeline(channel, token, 'manual')
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('Pipeline exceeded 60s'), { code: 'TIMEOUT' })), HARD_TIMEOUT_MS),
    )

    const result = await Promise.race([pipeline, timeout])
    return NextResponse.json(result)
  } catch (e) {
    const err = e as Error & { code?: string }
    if (err.code === 'TIMEOUT') {
      return NextResponse.json(
        { error: err.message, code: 'TIMEOUT', hint: 'Pipeline still running in background; check feed in ~1 min.' },
        { status: 504 },
      )
    }
    return errorResponse(e)
  }
}
