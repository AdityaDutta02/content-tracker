import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { scrape, instagram } from './scrape-sdk'

process.env.TERMINAL_AI_GATEWAY_URL = 'https://gw.test'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface Call {
  url: string
  method: string
  body: Record<string, unknown> | null
}
let calls: Call[] = []

function fakeRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

function mockFetch(router: (url: string, opts: RequestInit) => Response): void {
  calls = []
  globalThis.fetch = (async (url: string | URL | Request, opts: RequestInit = {}) => {
    const u = String(url)
    calls.push({ url: u, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body as string) : null })
    return router(u, opts)
  }) as typeof fetch
}

test('scrape: inline done returns data and hits POST /scrape/:platform', async () => {
  mockFetch(() => fakeRes(200, { status: 'done', data: { items: [] }, credits_charged: 11 }))
  const r = await scrape<{ items: unknown[] }>('instagram', 'posts', { handle: 'nasa' }, 'tok')
  assert.deepEqual(r, { data: { items: [] }, credits_charged: 11 })
  assert.equal(calls[0].url, 'https://gw.test/scrape/instagram')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].body?.operation, 'posts')
  assert.equal(calls[0].body?.handle, 'nasa')
})

test('scrape: polls jobId to completion via GET /scrape/result/:jobId', async () => {
  mockFetch((url) => {
    if (url.endsWith('/scrape/youtube')) return fakeRes(200, { jobId: 'j1', status: 'running' })
    return fakeRes(200, { status: 'done', data: { items: [{ id: 'a' }] }, credits_charged: 25 })
  })
  const r = await scrape<{ items: Array<{ id: string }> }>('youtube', 'search', { query: 'x' }, 'tok')
  assert.equal(r.data.items[0].id, 'a')
  assert.equal(r.credits_charged, 25)
  assert.equal(calls[1].url, 'https://gw.test/scrape/result/j1')
  assert.equal(calls[1].method, 'GET')
})

test('scrape: inline error throws', async () => {
  mockFetch(() => fakeRes(200, { status: 'error', error: 'boom' }))
  await assert.rejects(scrape('twitter', 'tweets', { handle: 'a' }, 'tok'), /boom/)
})

test('scrape: 402 maps to INSUFFICIENT_CREDITS', async () => {
  mockFetch(() => fakeRes(402, { redirect: '/pricing' }))
  await assert.rejects(
    scrape('instagram', 'posts', { handle: 'a' }, 'tok'),
    (e: unknown) => (e as { code?: string }).code === 'INSUFFICIENT_CREDITS',
  )
})

test('scrape: 403 maps to SCRAPE_FORBIDDEN', async () => {
  mockFetch(() => fakeRes(403, { error: 'owner only' }))
  await assert.rejects(
    scrape('instagram', 'posts', { handle: 'a' }, 'tok'),
    (e: unknown) => (e as { code?: string }).code === 'SCRAPE_FORBIDDEN',
  )
})

test('scrape: missing token throws before any fetch', async () => {
  mockFetch(() => fakeRes(200, { status: 'done', data: {}, credits_charged: 0 }))
  await assert.rejects(scrape('instagram', 'posts', {}, ''), /Missing token/)
  assert.equal(calls.length, 0)
})

test('instagram.posts clamps limit to 25', async () => {
  mockFetch(() => fakeRes(200, { status: 'done', data: { items: [] }, credits_charged: 0 }))
  await instagram.posts('nasa', { limit: 999 }, 'tok')
  assert.equal(calls[0].body?.limit, 25)
})
