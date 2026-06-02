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
      'You are a research librarian curating daily news sources for a content channel.',
      `Niche: "${channel.niche}"`,
      channel.target_group ? `Target audience: "${channel.target_group}"` : '',
      channel.description ? `What the feed should cover: "${channel.description}"` : '',
      '',
      'Find the 10 BEST sources that publish frequently (multiple posts per week) and are widely followed in this niche.',
      'You MUST return this exact mix:',
      '  - 4 news/blog websites (with RSS if possible)',
      '  - 2 X (Twitter) accounts — pick high-signal practitioners or official accounts',
      '  - 2 Instagram accounts',
      '  - 2 LinkedIn company pages or creators',
      '',
      'For social handles use the full profile URL:',
      '  - X: https://x.com/<handle>',
      '  - Instagram: https://instagram.com/<handle>',
      '  - LinkedIn: https://linkedin.com/company/<slug>  OR  https://linkedin.com/in/<slug>',
      '',
      'Skip generic feeds (Medium tag pages, Reddit unless niche-specific subreddit).',
      'Every source must be real and currently active.',
      '',
      'Return ONLY a JSON array. No prose. Schema:',
      '[{ "name": string, "url": string, "type_hint": "rss"|"web"|"x"|"ig"|"linkedin"|"yt"|"reddit", "why": string }]',
    ].filter(Boolean).join('\n')

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
