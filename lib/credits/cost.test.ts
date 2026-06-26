import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costForSourceType, costLabel, dailyCostEstimate, AI_SUMMARY_COST } from './cost'

test('costForSourceType: paid social vs free paths', () => {
  assert.equal(costForSourceType('ig'), 3)
  assert.equal(costForSourceType('x'), 2)
  assert.equal(costForSourceType('yt'), 0)
  assert.equal(costForSourceType('rss'), 0)
  assert.equal(costForSourceType('unknown'), 0)
})

test('costLabel: free sources say Free, paid say cr/refresh', () => {
  assert.equal(costLabel('yt'), 'Free')
  assert.equal(costLabel('rss'), 'Free')
  assert.equal(costLabel('ig'), '3 cr / refresh')
  assert.equal(costLabel('x'), '2 cr / refresh')
})

test('dailyCostEstimate: sums paid sources + one AI summary', () => {
  // free-only channel: just the AI call
  assert.equal(dailyCostEstimate(['rss', 'yt', 'reddit']), AI_SUMMARY_COST)
  // 1 IG + 1 X + free article: 3 + 2 + 1(AI)
  assert.equal(dailyCostEstimate(['ig', 'x', 'rss']), 6)
  // max social: 4 IG: 12 + 1(AI)
  assert.equal(dailyCostEstimate(['ig', 'ig', 'ig', 'ig']), 13)
})
