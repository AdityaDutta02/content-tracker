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
      '  - 4 news/blog websites that publish an RSS or Atom feed',
      '  - 2 X (Twitter) accounts — high-signal practitioners or official accounts',
      '  - 2 YouTube channels — channels that upload videos at least weekly',
      '  - 1 Instagram account',
      '  - 1 niche-specific subreddit',
      '',
      'For social handles use the full profile URL so we can detect the platform:',
      '  - X: https://x.com/<handle>',
      '  - YouTube: https://youtube.com/@<handle>   (channel handle, not random video URL)',
      '  - Instagram: https://instagram.com/<handle>',
      '  - Reddit: https://reddit.com/r/<subreddit>',
      '',
      'Avoid: LinkedIn, Facebook, Medium tag pages, dead blogs, generic news aggregators.',
      'Every source must be real and currently active.',
      '',
      'Return ONLY a JSON array. No prose. Schema:',
      '[{ "name": string, "url": string, "type_hint": "rss"|"web"|"x"|"ig"|"yt"|"reddit", "why": string }]',
    ].filter(Boolean).join('\n')

    const result = await callGateway(
      [{ role: 'user', content: prompt }],
      body.embedToken,
      { category: 'web_search', tier: 'good' },
    )

    const suggestions = parseSuggestions(result.content)
    let credits_used = result.credits_charged

    // Hard floor: guarantee ≥3 social handles. If the first pass came back
    // article-heavy, re-prompt once for more social and append.
    const SOCIAL_FLOOR = 3
    if (countSocial(suggestions) < SOCIAL_FLOOR) {
      const have = suggestions.map((s) => s.url)
      const more = await callGateway(
        [{ role: 'user', content: socialTopUpPrompt(channel, have) }],
        body.embedToken,
        { category: 'web_search', tier: 'good' },
      )
      credits_used += more.credits_charged
      const extra = parseSuggestions(more.content).filter((s) => !have.includes(s.url))
      suggestions.push(...extra)
    }

    // probe each in parallel — never drop, badges carry the FREE/BYOK/DOWN signal
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
      credits_used,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

const SOCIAL_HINTS = new Set(['x', 'ig', 'yt'])
function isSocialSuggestion(s: Suggestion): boolean {
  if (s.type_hint && SOCIAL_HINTS.has(s.type_hint)) return true
  return /(?:twitter\.com|x\.com|instagram\.com|youtube\.com)/i.test(s.url)
}

function countSocial(list: Suggestion[]): number {
  return list.filter(isSocialSuggestion).length
}

function socialTopUpPrompt(channel: ChannelRow, alreadyHave: string[]): string {
  return [
    'You are a research librarian curating SOCIAL sources for a content channel.',
    `Niche: "${channel.niche}"`,
    channel.target_group ? `Target audience: "${channel.target_group}"` : '',
    '',
    'Give me 3 more high-signal SOCIAL handles (X, YouTube, or Instagram) for this niche.',
    'Active accounts only, posting at least weekly. Do NOT repeat any of these URLs:',
    ...alreadyHave.map((u) => `  - ${u}`),
    '',
    'Use full profile URLs:',
    '  - X: https://x.com/<handle>',
    '  - YouTube: https://youtube.com/@<handle>',
    '  - Instagram: https://instagram.com/<handle>',
    '',
    'Return ONLY a JSON array. No prose. Schema:',
    '[{ "name": string, "url": string, "type_hint": "x"|"ig"|"yt", "why": string }]',
  ].filter(Boolean).join('\n')
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
