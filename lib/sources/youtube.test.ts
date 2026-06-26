import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isChannelId, resolveYoutubeChannelId, fetchYoutubeNative } from './youtube'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function htmlRes(html: string, ok = true): Response {
  return { ok, status: ok ? 200 : 404, text: async () => html } as unknown as Response
}

test('isChannelId: recognizes UC… ids only', () => {
  assert.equal(isChannelId('UCXuqSBlHAE6Xw-yeJA0Tunw'), true)
  assert.equal(isChannelId('@UCXuqSBlHAE6Xw-yeJA0Tunw'), true)
  assert.equal(isChannelId('mkbhd'), false)
  assert.equal(isChannelId('UCshort'), false)
})

test('resolveYoutubeChannelId: passes a UC id straight through (no network)', async () => {
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return htmlRes('')
  }) as typeof fetch
  const id = await resolveYoutubeChannelId('UCXuqSBlHAE6Xw-yeJA0Tunw')
  assert.equal(id, 'UCXuqSBlHAE6Xw-yeJA0Tunw')
  assert.equal(called, false)
})

test('resolveYoutubeChannelId: extracts channelId from channel page HTML', async () => {
  globalThis.fetch = (async () =>
    htmlRes('<html>...,"channelId":"UCXuqSBlHAE6Xw-yeJA0Tunw",...</html>')) as typeof fetch
  const id = await resolveYoutubeChannelId('@mkbhd')
  assert.equal(id, 'UCXuqSBlHAE6Xw-yeJA0Tunw')
})

test('resolveYoutubeChannelId: returns null when no candidate resolves', async () => {
  globalThis.fetch = (async () => htmlRes('not found', false)) as typeof fetch
  const id = await resolveYoutubeChannelId('does-not-exist')
  assert.equal(id, null)
})

test('fetchYoutubeNative: throws when the handle cannot be resolved', async () => {
  globalThis.fetch = (async () => htmlRes('nope', false)) as typeof fetch
  await assert.rejects(fetchYoutubeNative('ghost-channel'), /could not resolve channel id/)
})
