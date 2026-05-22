import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbUpdate, dbDelete } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'
import { errorResponse } from '@/lib/api-helpers'
import type { ChannelRow } from '@/lib/types'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getEmbedToken(req)
    const row = await dbGet<ChannelRow>('channels', params.id, token)
    return NextResponse.json({ channel: row })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json()) as { embedToken: string; patch: Record<string, unknown> }
    const row = await dbUpdate<ChannelRow>('channels', params.id, body.patch, body.embedToken)
    return NextResponse.json({ channel: row })
  } catch (e) {
    return errorResponse(e, 400)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getEmbedToken(req)
    await dbDelete('channels', params.id, token)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
