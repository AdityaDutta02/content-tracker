import { NextRequest, NextResponse } from 'next/server'
import { dbList } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'
import { errorResponse } from '@/lib/api-helpers'

interface RunRow {
  id: string
  channel_id: string
  run_at: string
  trigger: string
  status: string
  item_count: number
  credits_used: number
  errors: unknown
  items_json: Array<{
    title: string
    url: string
    summary: string | null
    published_at: string | null
    engagement: Record<string, number> | null
    ai_relevance: number | null
    final_score: number | null
    rank: number
    source_id: string | null
    canonical_url: string
  }>
}

export async function GET(req: NextRequest) {
  try {
    const token = getEmbedToken(req)
    const channelId = req.nextUrl.searchParams.get('channelId')
    if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

    const runs = await dbList<RunRow>('runs', { channel_id: channelId }, token)
    runs.sort((a, b) => (a.run_at < b.run_at ? 1 : -1))
    return NextResponse.json({ runs: runs.slice(0, 30) })
  } catch (e) {
    return errorResponse(e)
  }
}
