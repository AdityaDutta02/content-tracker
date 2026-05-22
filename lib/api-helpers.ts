import { NextResponse } from 'next/server'

export function errorResponse(err: unknown, fallback = 500) {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; redirect?: string }
    if (e.code === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json(
        { error: e.message, code: 'INSUFFICIENT_CREDITS', redirect: e.redirect },
        { status: 402 },
      )
    }
    if (e.code === 'TOKEN_EXPIRED' || e.code === 'NO_TOKEN') {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 401 })
    }
    return NextResponse.json({ error: e.message }, { status: fallback })
  }
  return NextResponse.json({ error: 'Internal error' }, { status: fallback })
}

export function parseJSON<T extends Record<string, unknown> = Record<string, unknown>>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
