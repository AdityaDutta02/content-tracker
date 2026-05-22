import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { detectSource } from '@/lib/sources/detect'
import { errorResponse } from '@/lib/api-helpers'

const BodySchema = z.object({ input: z.string().min(2) })

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json())
    const result = await detectSource(body.input)
    return NextResponse.json(result)
  } catch (e) {
    return errorResponse(e, 400)
  }
}
