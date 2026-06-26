import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSocial, mapSocialPost } from './social-fetch'
import type { SocialPost } from '../scrape-sdk'

process.env.TERMINAL_AI_GATEWAY_URL = 'https://gw.test'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface Call {
  url: string
  body: Record<string, unknown> | null
}
let calls: Call[] = []

function fakeRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

// Every social fetch resolves to one inline-done gateway response carrying items.
function mockGateway(items: Partial<SocialPost>[], creditsCharged = 0): void {
  calls = []
  globalThis.fetch = (async (url: string | URL | Request, opts: RequestInit = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body as string) : null })
    return fakeRes({ status: 'done', data: { items }, credits_charged: creditsCharged })
  }) as typeof fetch
}

test('mapSocialPost: maps a normalized post to FetchedItem', () => {
  const item = mapSocialPost('ig', {
    platform: 'instagram',
    id: 'abc',
    text: 'Hello world\nsecond line',
    createdAt: '2026-06-20T00:00:00.000Z',
    likes: 5,
    comments: 2,
    shares: 1,
    views: 9,
    mediaUrls: ['http://img'],
    url: 'http://post',
  })
  assert.equal(item.external_id, 'ig:abc')
  assert.equal(item.title, 'Hello world')
  assert.equal(item.url, 'http://post')
  assert.equal(item.image_url, 'http://img')
  assert.equal(item.published_at, '2026-06-20T00:00:00.000Z')
  assert.deepEqual(item.engagement, { likes: 5, comments: 2, reposts: 1, views: 9 })
})

test('mapSocialPost: empty text falls back to a placeholder title', () => {
  const item = mapSocialPost('yt', { platform: 'youtube', id: 'v', url: 'http://v' })
  assert.equal(item.title, 'yt post')
  assert.equal(item.summary, '')
})

test('fetchSocial: ig hits instagram/posts, strips @, maps items + reports credits', async () => {
  mockGateway([{ platform: 'instagram', id: '1', text: 'hi', url: 'u' }], 3)
  const { items, credits } = await fetchSocial('ig', '@nasa', 'tok')
  assert.equal(calls[0].url, 'https://gw.test/scrape/instagram')
  assert.equal(calls[0].body?.operation, 'posts')
  assert.equal(calls[0].body?.handle, 'nasa')
  assert.equal(items[0].external_id, 'ig:1')
  assert.equal(credits, 3)
})

test('fetchSocial: yt is not a gateway path (native RSS handles it)', async () => {
  mockGateway([])
  await assert.rejects(fetchSocial('yt' as 'ig', 'mkbhd', 'tok'), /unsupported social type/)
  assert.equal(calls.length, 0)
})

test('fetchSocial: x hits twitter/tweets', async () => {
  mockGateway([])
  await fetchSocial('x', '@sama', 'tok')
  assert.equal(calls[0].url, 'https://gw.test/scrape/twitter')
  assert.equal(calls[0].body?.operation, 'tweets')
  assert.equal(calls[0].body?.handle, 'sama')
})

test('fetchSocial: rejects unsupported social types', async () => {
  mockGateway([])
  await assert.rejects(fetchSocial('fb' as 'ig', 'nasa', 'tok'), /unsupported social type/)
})
