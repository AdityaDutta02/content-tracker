import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateInTz, hourInTz } from './time'

// 2026-01-01T02:30:00Z — still Dec 31 in the Americas, already Jan 1 in Asia.
const nearMidnightUtc = new Date('2026-01-01T02:30:00Z')

test('dateInTz: same instant lands on different calendar days per zone', () => {
  assert.equal(dateInTz(nearMidnightUtc, 'UTC'), '2026-01-01')
  assert.equal(dateInTz(nearMidnightUtc, 'America/Los_Angeles'), '2025-12-31') // UTC-8
  assert.equal(dateInTz(nearMidnightUtc, 'Asia/Kolkata'), '2026-01-01') // UTC+5:30
})

test('dateInTz: invalid zone falls back to UTC date', () => {
  assert.equal(dateInTz(nearMidnightUtc, 'Not/AZone'), '2026-01-01')
})

test('hourInTz: converts to local hour', () => {
  assert.equal(hourInTz(nearMidnightUtc, 'UTC'), 2)
  assert.equal(hourInTz(nearMidnightUtc, 'Asia/Kolkata'), 8) // 02:30 + 5:30 = 08:00
})

test('hourInTz: invalid zone falls back to UTC hour', () => {
  assert.equal(hourInTz(nearMidnightUtc, 'Not/AZone'), 2)
})
