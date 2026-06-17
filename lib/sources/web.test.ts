import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeTitle } from './web'

test('sanitizeTitle: strips stray markdown image/bracket tokens', () => {
  assert.equal(sanitizeTitle('![Image ]'), 'Image')
  assert.equal(sanitizeTitle('![Image 1'), 'Image 1')
  assert.equal(sanitizeTitle('![alt](https://x.com/a.png) Real headline'), 'Real headline')
})

test('sanitizeTitle: unwraps nested link text', () => {
  assert.equal(sanitizeTitle('How [agents](https://x.com/a) really work'), 'How agents really work')
})

test('sanitizeTitle: leaves clean titles intact', () => {
  assert.equal(sanitizeTitle('What We Learned Building an AI Agent'), 'What We Learned Building an AI Agent')
})
