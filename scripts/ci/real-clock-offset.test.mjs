// Learning path Step 54: Complimentary full access (date bomb guard).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const preload = fileURLToPath(new URL('./real-clock-offset.mjs', import.meta.url))

function probe(days, script) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', preload, '--input-type=module', '-e', script],
      {
        env: { ...process.env, REAL_CLOCK_OFFSET_DAYS: String(days) },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
  )
}

const READ = `
  const real = performance.timeOrigin + performance.now()
  const marker = Date[Symbol.for('couture-cast.real-clock-offset-days')] ?? null
  console.log(JSON.stringify({
    nowAhead: Date.now() - real,
    newAhead: new Date().getTime() - real,
    stringYear: new Date(Date()).getUTCFullYear() - new Date(real).getUTCFullYear(),
    fixed: new Date('2026-11-04T00:00:00.000Z').toISOString(),
    fromParts: new Date(2026, 10, 4).getFullYear(),
    utc: Date.UTC(2026, 10, 4),
    parse: Date.parse('2026-11-04T00:00:00.000Z'),
    isDate: new Date() instanceof Date && Object.prototype.toString.call(new Date()),
    marker,
  }))
`

test('moves every real-clock read ahead and leaves given dates alone', () => {
  const read = probe(365, READ)
  const day = 86_400_000
  assert.ok(
    Math.abs(read.nowAhead - 365 * day) < 5_000,
    `Date.now ahead by ${read.nowAhead}`
  )
  assert.ok(
    Math.abs(read.newAhead - 365 * day) < 5_000,
    `new Date ahead by ${read.newAhead}`
  )
  assert.ok(
    read.stringYear === 1 || read.stringYear === 0,
    'Date() reads the shifted clock'
  )
  assert.equal(read.fixed, '2026-11-04T00:00:00.000Z')
  assert.equal(read.fromParts, 2026)
  assert.equal(read.utc, 1_793_750_400_000)
  assert.equal(read.parse, 1_793_750_400_000)
  assert.equal(read.isDate, '[object Date]')
  assert.equal(read.marker, 365)
})

test('does nothing without an offset', () => {
  const read = probe(0, READ)
  assert.ok(Math.abs(read.nowAhead) < 5_000)
  assert.equal(read.marker, null)
})

test('refuses an offset that is not whole days', () => {
  assert.throws(() => probe('1.5', READ), /whole number of days/)
})
