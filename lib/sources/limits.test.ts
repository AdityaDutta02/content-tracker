import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCanAddSource,
  selectActiveSources,
  nextCooldown,
  SourceLimitError,
  ROTATION_COOLDOWN_RUNS,
} from './limits'
import type { SourceRow, SourceType } from '../types'

function src(over: Partial<SourceRow> & { type: SourceType }): SourceRow {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    channel_id: 'c1',
    type: over.type,
    url: null,
    handle: over.handle ?? 'h',
    label: null,
    enabled: over.enabled ?? true,
    scrape_config: over.scrape_config ?? {},
    added_by: 'user_custom',
    last_fetch_at: null,
    last_fetch_error: null,
  }
}

test('assertCanAddSource: rejects unsupported fb/linkedin', () => {
  assert.throws(() => assertCanAddSource('fb', []), SourceLimitError)
  assert.throws(() => assertCanAddSource('linkedin', []), SourceLimitError)
})

test('assertCanAddSource: allows social under the cap', () => {
  const existing = [src({ type: 'ig' }), src({ type: 'x' })]
  assert.doesNotThrow(() => assertCanAddSource('yt', existing))
})

test('assertCanAddSource: rejects the 5th social source', () => {
  const existing = [src({ type: 'ig' }), src({ type: 'x' }), src({ type: 'yt' }), src({ type: 'ig' })]
  assert.throws(() => assertCanAddSource('x', existing), SourceLimitError)
})

test('assertCanAddSource: disabled social sources do not count toward the cap', () => {
  const existing = [
    src({ type: 'ig' }),
    src({ type: 'x' }),
    src({ type: 'yt' }),
    src({ type: 'ig', enabled: false }),
  ]
  assert.doesNotThrow(() => assertCanAddSource('x', existing))
})

test('assertCanAddSource: never caps free article sources', () => {
  const existing = Array.from({ length: 20 }, () => src({ type: 'rss' }))
  assert.doesNotThrow(() => assertCanAddSource('rss', existing))
})

test('nextCooldown: productive source resets, dud cools down', () => {
  assert.equal(nextCooldown(3), 0)
  assert.equal(nextCooldown(0), ROTATION_COOLDOWN_RUNS)
})

test('selectActiveSources: caps total at 10 and social at 4', () => {
  const sources = [
    ...Array.from({ length: 8 }, () => src({ type: 'rss' })),
    src({ type: 'ig' }),
    src({ type: 'x' }),
    src({ type: 'yt' }),
    src({ type: 'ig' }),
    src({ type: 'x' }), // 5th social — must be excluded by the social cap
  ]
  const active = selectActiveSources(sources)
  assert.equal(active.length, 10)
  const social = active.filter((s) => ['x', 'ig', 'yt'].includes(s.type)).length
  assert.equal(social, 4)
})

test('selectActiveSources: excludes disabled and unsupported types', () => {
  const sources = [
    src({ type: 'rss', id: 'a' }),
    src({ type: 'rss', id: 'b', enabled: false }),
    src({ type: 'fb', id: 'c' }),
    src({ type: 'linkedin', id: 'd' }),
  ]
  const active = selectActiveSources(sources)
  assert.deepEqual(active.map((s) => s.id), ['a'])
})

test('selectActiveSources: higher yield wins a contested slot', () => {
  // 11 article sources, budget 10 — the lowest-yield one must be dropped.
  const sources = Array.from({ length: 11 }, (_, i) =>
    src({ type: 'rss', id: `s${i}`, scrape_config: { _yield: i } }),
  )
  const active = selectActiveSources(sources)
  assert.equal(active.length, 10)
  assert.equal(active.find((s) => s.id === 's0'), undefined) // yield 0 dropped
})

test('selectActiveSources: new (no-yield) source beats a productive one for priority', () => {
  const sources = [
    src({ type: 'rss', id: 'known', scrape_config: { _yield: 5 } }),
    src({ type: 'rss', id: 'fresh', scrape_config: {} }),
  ]
  const active = selectActiveSources(sources)
  assert.equal(active[0].id, 'fresh')
})

test('selectActiveSources: cooled-down SOCIAL source is strictly benched (saves credits)', () => {
  const sources = [
    src({ type: 'rss', id: 'article' }),
    src({ type: 'ig', id: 'live-social', scrape_config: { _yield: 3 } }),
    src({ type: 'x', id: 'resting-social', scrape_config: { _cooldown: 2 } }),
  ]
  const active = selectActiveSources(sources)
  // resting social excluded even though slots are free
  assert.equal(active.find((s) => s.id === 'resting-social'), undefined)
  assert.deepEqual(active.map((s) => s.id).sort(), ['article', 'live-social'])
})

test('selectActiveSources: cooled-down social returns once cooldown expires', () => {
  const sources = [src({ type: 'ig', id: 'social', scrape_config: { _cooldown: 0, _yield: 0 } })]
  const active = selectActiveSources(sources)
  assert.deepEqual(active.map((s) => s.id), ['social'])
})

test('selectActiveSources: cooled-down ARTICLE source is NOT benched under budget (free)', () => {
  const sources = [
    src({ type: 'rss', id: 'live', scrape_config: { _yield: 5 } }),
    src({ type: 'rss', id: 'cooled', scrape_config: { _cooldown: 2, _yield: 0 } }),
  ]
  const active = selectActiveSources(sources)
  assert.equal(active.length, 2) // article cooldown ignored when a slot is free
})
