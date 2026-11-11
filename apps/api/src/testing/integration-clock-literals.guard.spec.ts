// Learning path Step 54: Complimentary full access (date bomb guard).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Date bombs in the integration tier: a fixed date the code under test will one day compare with
 * the real clock.
 *
 * - A birthdate literal of someone under 18: '2012-01-01' was a teen in 2026 and is an adult from
 *   2030, so a teen test turns into an adult test on a date nobody chose.
 * - An expiry, end or deadline literal in the next 50 years: it is in the future today and in the
 *   past on the day the calendar reaches it.
 *
 * The unit suites are checked by running them with the real clock a year ahead (pr-checks'
 * unit-tests-year-ahead). This tier cannot be: its database and the Prisma engine keep the real
 * clock, so moving JavaScript's alone makes them disagree. Build these dates from the clock the code
 * reads instead (`birthdateForAge` in src/testing/birthdate.ts, `Date.now()` plus a span). A literal
 * that never meets the clock (a CHECK between two columns, a certificate's own expiry) carries a
 * `clock-literal-ok:` comment with the reason, on its line or the line above.
 */
const BIRTH = /birth|teen|minor|child|\bkid/i
const EXPIRY = /expir|ends_?at|endsAt|until|valid_?(?:to|until)|validTo|deadline|retain/i
const LITERAL = /['"`](\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)['"`]/g
const ALLOWED = 'clock-literal-ok:'

export type ClockLiteral = { line: number; kind: 'birthdate' | 'expiry'; text: string }

export function findClockLiterals(source: string, today: Date): ClockLiteral[] {
  const adultBorn = Date.UTC(
    today.getUTCFullYear() - 18,
    today.getUTCMonth(),
    today.getUTCDate()
  )
  const horizon = Date.UTC(today.getUTCFullYear() + 50, 0, 1)
  const lines = source.split('\n')
  const found: ClockLiteral[] = []
  lines.forEach((text, index) => {
    if (text.includes(ALLOWED) || lines[index - 1]?.includes(ALLOWED)) return
    for (const [, iso = ''] of text.matchAll(LITERAL)) {
      const at = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
      if (Number.isNaN(at)) continue
      if (BIRTH.test(text) && at > adultBorn)
        found.push({ line: index + 1, kind: 'birthdate', text: text.trim() })
      else if (EXPIRY.test(text) && at > today.getTime() && at < horizon)
        found.push({ line: index + 1, kind: 'expiry', text: text.trim() })
    }
  })
  return found
}

const apiRoot = resolve(__dirname, '../..')

describe('integration clock literals', () => {
  const today = new Date('2026-11-11T12:00:00.000Z')

  it('finds a minor birthdate literal and leaves an adult one', () => {
    const found = findClockLiterals(
      [
        "const teen = await fixture('2012-01-01T00:00:00Z')",
        "birthdate: new Date('2013-03-04T00:00:00.000Z'),",
        "birthdate: new Date('1990-01-01T00:00:00Z'),",
        "const adultBirthdate = new Date('2008-04-22T12:00:00.000Z')",
      ].join('\n'),
      today
    )
    expect(found.map(({ line, kind }) => [line, kind])).toEqual([
      [1, 'birthdate'],
      [2, 'birthdate'],
    ])
  })

  it('finds a near-future expiry literal and leaves past dates and far sentinels', () => {
    const found = findClockLiterals(
      [
        "const expires = new Date('2030-01-02T12:00:00.000Z')",
        "expires_at: new Date('2026-11-18T00:00:00.000Z'),",
        "expiresAt: new Date('2099-01-01'),",
        "expires_at: new Date('2026-01-01T00:00:00.000Z'),",
        "publishedAt: new Date('2030-01-01T00:00:00Z'),",
      ].join('\n'),
      today
    )
    expect(found.map(({ line, kind }) => [line, kind])).toEqual([
      [1, 'expiry'],
      [2, 'expiry'],
    ])
  })

  it('accepts a literal whose reason is written beside it', () => {
    expect(
      findClockLiterals(
        [
          '// clock-literal-ok: a CHECK between two columns, no clock read',
          "ends_at: new Date('2030-01-01T00:00:00.001Z'),",
          "expect(validTo).toBe('2031-04-26T10:56:53.000Z') // clock-literal-ok: the CA's own expiry",
        ].join('\n'),
        today
      )
    ).toEqual([])
  })

  it('has none in the integration tier', () => {
    const files = execFileSync('git', ['ls-files', 'integration'], {
      cwd: apiRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => /\.(?:ts|mts|mjs)$/.test(file))
    expect(files.length).toBeGreaterThan(100)
    const found = files.flatMap((file) =>
      findClockLiterals(readFileSync(resolve(apiRoot, file), 'utf8'), new Date()).map(
        ({ line, kind, text }) => `${file}:${line} ${kind}: ${text}`
      )
    )
    expect(found).toEqual([])
  })
})
