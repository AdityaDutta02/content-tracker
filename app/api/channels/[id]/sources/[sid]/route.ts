import { NextRequest, NextResponse } from 'next/server'
import { dbUpdate, dbDelete } from '@/lib/db'
import { errorResponse } from '@/lib/api-helpers'
import { getEmbedToken } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const body = (await req.json()) as { embedToken: string; patch: Record<string, unknown> }
    const row = await dbUpdate('sources', params.sid, body.patch, body.embedToken)
    return NextResponse.json({ source: row })
  } catch (e) {
    return errorResponse(e, 400)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    const token = getEmbedToken(req)
    await dbDelete('sources', params.sid, token)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
