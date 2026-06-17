import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierOrder } from './social-fetch'
import { isChannelId } from './youtube'

test('isChannelId: accepts UC ids, rejects handles', () => {
  assert.equal(isChannelId('UCXuqSBlHAE6Xw-yeJA0Tunw'), true)
  assert.equal(isChannelId('@UCXuqSBlHAE6Xw-yeJA0Tunw'), true) // tolerates leading @
  assert.equal(isChannelId('mkbhd'), false)
  assert.equal(isChannelId('@mkbhd'), false)
  assert.equal(isChannelId('UCshort'), false)
})

test('tierOrder: platform defaults', () => {
  delete process.env.SOCIAL_FETCH_TIERS
  delete process.env.SOCIAL_FETCH_TIERS_YT
  delete process.env.SOCIAL_FETCH_TIERS_X
  assert.deepEqual(tierOrder('yt', {}), ['native', 'rsshub', 'apify'])
  assert.deepEqual(tierOrder('x', {}), ['rsshub', 'apify'])
  assert.deepEqual(tierOrder('ig', {}), ['rsshub', 'apify'])
})

test('tierOrder: drops native for non-yt platforms', () => {
  const order = tierOrder('x', { fetch_tiers: ['native', 'rsshub', 'apify'] })
  assert.equal(order.includes('native'), false)
  assert.deepEqual(order, ['rsshub', 'apify'])
})

test('tierOrder: floats a cached successful tier to the front', () => {
  assert.deepEqual(tierOrder('yt', { fetch_tier: 'apify' }), ['apify', 'native', 'rsshub'])
  assert.deepEqual(tierOrder('x', { fetch_tier: 'apify' }), ['apify', 'rsshub'])
})

test('tierOrder: ignores a cached tier that is not in the valid set', () => {
  // native cached for X is invalid → not floated, native dropped
  assert.deepEqual(tierOrder('x', { fetch_tier: 'native' }), ['rsshub', 'apify'])
})

test('tierOrder: env override wins over default', () => {
  process.env.SOCIAL_FETCH_TIERS_YT = 'apify, native'
  try {
    assert.deepEqual(tierOrder('yt', {}), ['apify', 'native'])
  } finally {
    delete process.env.SOCIAL_FETCH_TIERS_YT
  }
})
