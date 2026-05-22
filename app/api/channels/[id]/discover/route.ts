import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { dbGet } from '@/lib/db'
import { callGateway } from '@/lib/terminal-ai'
import { detectSource } from '@/lib/sources/detect'
import { errorResponse } from '@/lib/api-helpers'
import type { ChannelRow, DetectionResult } from '@/lib/types'

const BodySchema = z.object({ embedToken: z.string().min(1) })

interface Suggestion {
  name: string
  url: string
  type_hint?: string
  why?: string
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = BodySchema.parse(await req.json())
    const channel = await dbGet<ChannelRow>('channels', params.id, body.embedToken)

    const prompt = [
      'You are a research librarian curating sources for a content channel.',
      `Niche: "${channel.niche}"`,
      '',
      'List 10 top sources that creators in this niche actually read.',
      'Mix formats: news sites, blogs, X/IG/YT accounts, subreddits, papers, aggregators.',
      'Prefer sources with public RSS or APIs.',
      '',
      'Return ONLY a JSON array. No prose. Schema:',
      '[{ "name": string, "url": string, "type_hint": "rss"|"hn"|"reddit"|"arxiv"|"yt"|"x"|"ig"|"fb"|"web", "why": string }]',
    ].join('\n')

    const result = await callGateway(
      [{ role: 'user', content: prompt }],
      body.embedToken,
      { category: 'web_search', tier: 'good' },
    )

    const suggestions = parseSuggestions(result.content)

    // probe each in parallel — keep ones that detect cleanly, drop ones needing BYOK if no key
    const probed = await Promise.all(
      suggestions.map(async (s) => {
        try {
          const det = await detectSource(s.url)
          return { suggestion: s, detection: det }
        } catch (e) {
          return { suggestion: s, detection: null as DetectionResult | null, error: e instanceof Error ? e.message : String(e) }
        }
      }),
    )

    return NextResponse.json({
      suggestions: probed,
      credits_used: result.credits_charged,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

function parseSuggestions(text: string): Suggestion[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as Suggestion[]
    return arr.filter((s) => s.name && s.url).slice(0, 15)
  } catch {
    return []
  }
}
