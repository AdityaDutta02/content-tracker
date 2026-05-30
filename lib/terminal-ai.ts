import config from './validate-config'

const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!

// Single attempt — no retry. Pipeline now batches DB ops to ~5 calls so a 429
// indicates a real bottleneck; sleeping 60s inside a request only compounds it.
async function callOnce(url: string, options: RequestInit): Promise<Response> {
  return fetch(url, options)
}

interface GenerateResponse {
  id: string
  content: string
  model_used: string
  usage: { input_tokens: number; output_tokens: number }
  credits_charged: number
}

export async function callGateway(
  messages: { role: string; content: string }[],
  embedToken: string,
  options?: { category?: string; tier?: string; model?: string; system?: string },
): Promise<GenerateResponse> {
  if (!embedToken) throw new Error('Missing embed token')
  const routing = options?.model
    ? { model: options.model }
    : { category: options?.category ?? config.category, tier: options?.tier ?? config.tier }
  const res = await callOnce(`${GATEWAY_URL}/v1/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${embedToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...routing, messages, ...(options?.system ? { system: options.system } : {}) }),
  })
  if (res.status === 401) {
    throw Object.assign(new Error('Session expired'), { code: 'TOKEN_EXPIRED', retryable: true })
  }
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { redirect?: string }
    throw Object.assign(new Error('Insufficient credits'), {
      code: 'INSUFFICIENT_CREDITS',
      redirect: body.redirect ?? '/pricing',
      retryable: false,
    })
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as Record<string, string>
    throw new Error(`Gateway error (${res.status}): ${err.error ?? res.statusText}`)
  }
  return res.json() as Promise<GenerateResponse>
}
