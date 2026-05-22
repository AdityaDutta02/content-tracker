'use client'
import { useState, useEffect } from 'react'

export function useEmbedToken(): string | null {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'TERMINAL_AI_TOKEN' && typeof event.data.token === 'string') {
        setToken(event.data.token)
      }
    }
    window.addEventListener('message', handleMessage)
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'TERMINAL_AI_READY' }, '*')
    }
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return token
}
