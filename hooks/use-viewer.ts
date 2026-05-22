'use client'
import { useEmbedToken } from './use-embed-token'

function decodeViewerId(token: string | null): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { userId?: string; sub?: string }
    return payload.userId ?? payload.sub ?? null
  } catch {
    return null
  }
}

export function useViewer(): { token: string | null; viewerId: string | null } {
  const token = useEmbedToken()
  return { token, viewerId: decodeViewerId(token) }
}
