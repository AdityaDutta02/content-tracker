import { NextRequest, NextResponse } from 'next/server'
import { dbList } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'
import { errorResponse } from '@/lib/api-helpers'

interface ItemRow {
  id: string
  channel_id: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  engagement: Record<string, number> | null
  ai_relevance: number | null
  final_score: number | null
  rank: number | null
  run_date: string
  source_id: string | null
}

export async function GET(req: NextRequest) {
  try {
    const token = getEmbedToken(req)
    const channelId = req.nextUrl.searchParams.get('channelId')
    const date = req.nextUrl.searchParams.get('date')
    if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

    const filters: Record<string, string> = { channel_id: channelId }
    if (date) filters.run_date = date
    const items = await dbList<ItemRow>('items', filters, token)
    items.sort((a, b) => {
      if (a.run_date !== b.run_date) return a.run_date < b.run_date ? 1 : -1
      return (a.rank ?? 999) - (b.rank ?? 999)
    })
    return NextResponse.json({ items })
  } catch (e) {
    return errorResponse(e)
  }
}
