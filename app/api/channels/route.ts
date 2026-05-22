import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { dbList, dbInsert } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'
import { errorResponse } from '@/lib/api-helpers'
import type { ChannelRow } from '@/lib/types'

const CreateSchema = z.object({
  embedToken: z.string().min(1),
  viewerId: z.string().min(1),
  name: z.string().min(1).max(80),
  niche: z.string().min(2).max(200),
  timezone: z.string().min(1).default('UTC'),
  general_web_search: z.boolean().optional(),
  smart_mode: z.boolean().optional(),
  scraper_byok_key: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const token = getEmbedToken(req)
    const viewerId = req.nextUrl.searchParams.get('viewerId')
    if (!viewerId) return NextResponse.json({ error: 'viewerId required' }, { status: 400 })
    const rows = await dbList<ChannelRow>('channels', { viewer_id: viewerId }, token)
    return NextResponse.json({ channels: rows })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = CreateSchema.parse(await req.json())
    const row = await dbInsert<ChannelRow>(
      'channels',
      {
        viewer_id: body.viewerId,
        name: body.name,
        niche: body.niche,
        timezone: body.timezone,
        general_web_search: body.general_web_search ?? false,
        smart_mode: body.smart_mode ?? false,
        scraper_byok_key: body.scraper_byok_key ?? null,
      },
      body.embedToken,
    )
    return NextResponse.json({ channel: row })
  } catch (e) {
    return errorResponse(e, 400)
  }
}
