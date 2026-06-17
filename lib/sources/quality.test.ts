import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeArticle, scoreSample } from './quality'
import type { FetchedItem } from '../types'

const item = (title: string, url: string, extra: Partial<FetchedItem> = {}): FetchedItem => ({
  external_id: url,
  title,
  url,
  ...extra,
})

test('looksLikeArticle: rejects nav labels', () => {
  assert.equal(looksLikeArticle(item('Resource library', 'https://x.com/resources')), false)
  assert.equal(looksLikeArticle(item('Courses', 'https://x.com/courses')), false)
  assert.equal(looksLikeArticle(item('Patterns', 'https://x.com/patterns')), false)
  assert.equal(looksLikeArticle(item('Pricing', 'https://x.com/pricing')), false)
})

test('looksLikeArticle: rejects short non-article slugs and root links', () => {
  assert.equal(looksLikeArticle(item('UX Pilot', 'https://x.com/uxpilot')), false)
  assert.equal(looksLikeArticle(item('Figma AI / Make', 'https://x.com/ai')), false)
  assert.equal(looksLikeArticle(item('Building with AI', 'https://x.com')), false) // root
})

test('looksLikeArticle: rejects on-page section anchors (shredded listicle)', () => {
  assert.equal(
    looksLikeArticle(item('Building with AI', 'https://x.com/post#building-with-ai')),
    false,
  )
})

test('looksLikeArticle: rejects self-link back to the scraped page', () => {
  const src = 'https://blog.example.com/ai'
  assert.equal(looksLikeArticle(item('Some Heading Here', 'https://blog.example.com/ai'), src), false)
})

test('looksLikeArticle: rejects echo summary (title === summary)', () => {
  assert.equal(
    looksLikeArticle(item('Building with AI agents', 'https://x.com/p/building-with-ai-agents', { summary: 'Building with AI agents' })),
    false,
  )
})

test('looksLikeArticle: accepts deep hyphenated/dated article slugs', () => {
  assert.equal(
    looksLikeArticle(item('What We Learned Building an AI Agent for 3D Creation', 'https://blog.example.com/posts/2026/ai-agent-3d-creation')),
    true,
  )
  assert.equal(looksLikeArticle(item('GPT-5 ships today', 'https://news.example.com/articles/gpt-5-ships-today')), true)
})

test('looksLikeArticle: accepts long descriptive headline even on a plainer slug', () => {
  assert.equal(
    looksLikeArticle(item('Five hard lessons from scaling a vector database', 'https://eng.example.com/blog/vectors')),
    true,
  )
})

test('scoreSample: nav/listicle page scores down (not auto-select)', () => {
  const junk = [
    item('Resource library', 'https://x.com/resources'),
    item('Courses', 'https://x.com/courses'),
    item('Patterns', 'https://x.com/patterns'),
    item('Pricing', 'https://x.com/pricing'),
    item('UX Pilot', 'https://x.com/uxpilot'),
  ]
  const s = scoreSample(junk, 'https://x.com')
  assert.equal(s.health, 'down')
  assert.ok(s.fraction < 0.3, `fraction ${s.fraction}`)
})

test('scoreSample: real article feed scores ok (auto-select)', () => {
  const good = [
    item('What We Learned Building an AI Agent for 3D Creation', 'https://b.com/posts/ai-agent-3d-creation', { published_at: '2026-06-10' }),
    item('Five hard lessons from scaling a vector database', 'https://b.com/posts/scaling-vector-db', { published_at: '2026-06-09' }),
    item('Why our LLM cache cut latency by 40 percent', 'https://b.com/posts/llm-cache-latency', { published_at: '2026-06-08' }),
    item('Designing resilient retry logic for flaky APIs', 'https://b.com/posts/resilient-retries', { published_at: '2026-06-07' }),
  ]
  const s = scoreSample(good, 'https://b.com')
  assert.equal(s.health, 'ok')
})

test('scoreSample: same-page shredded into sections scores down', () => {
  const shredded = [
    item('Intro to agents', 'https://b.com/big-roundup#intro'),
    item('Building with AI', 'https://b.com/big-roundup#building'),
    item('Patterns that scale', 'https://b.com/big-roundup#patterns'),
    item('What comes next here', 'https://b.com/big-roundup#next'),
  ]
  const s = scoreSample(shredded, 'https://b.com')
  assert.ok(s.fraction <= 0.2, `fraction ${s.fraction}`)
  assert.notEqual(s.health, 'ok')
})

test('scoreSample: empty sample is down', () => {
  assert.equal(scoreSample([]).health, 'down')
})
