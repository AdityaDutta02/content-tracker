import { NextRequest } from 'next/server'

export function getEmbedToken(req: NextRequest, body?: { embedToken?: string }): string {
  const header = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = header ?? body?.embedToken ?? ''
  if (!token) throw Object.assign(new Error('Missing embed token'), { code: 'NO_TOKEN' })
  return token
}
