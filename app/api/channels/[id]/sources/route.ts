import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { dbList, dbInsert } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'
import { errorResponse } from '@/lib/api-helpers'
import type { SourceRow, SourceType } from '@/lib/types'

const CreateSchema = z.object({
  embedToken: z.string().min(1),
  type: z.enum(['rss', 'hn', 'reddit', 'arxiv', 'yt', 'x', 'ig', 'fb', 'web']),
  url: z.string().optional(),
  handle: z.string().optional(),
  label: z.string().optional(),
  scrape_config: z.record(z.unknown()).default({}),
  added_by: z.enum(['ai_discovery', 'user_custom']).default('user_custom'),
})

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getEmbedToken(req)
    const rows = await dbList<SourceRow>('sources', { channel_id: params.id }, token)
    return NextResponse.json({ sources: rows })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = CreateSchema.parse(await req.json())
    const row = await dbInsert<SourceRow>(
      'sources',
      {
        channel_id: params.id,
        type: body.type as SourceType,
        url: body.url ?? null,
        handle: body.handle ?? null,
        label: body.label ?? null,
        enabled: true,
        scrape_config: body.scrape_config,
        added_by: body.added_by,
      },
      body.embedToken,
    )
    return NextResponse.json({ source: row })
  } catch (e) {
    return errorResponse(e, 400)
  }
}
