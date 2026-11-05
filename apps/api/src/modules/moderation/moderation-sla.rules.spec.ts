// Story 6.12 test owner: the pure rules of the SLA sweep. U-S-BOUNDARY, U-S-RELEVANCE, U-S-BACKOFF,
// U-R-STALE, the dedupe key, and the source scans U-S-NO-THRESHOLD, U-S-NO-DB-CLOCK and I-S-NO-REOPEN.
// The oracle tables are written by hand from the spec, so a change to the rule fails here.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isModerationSlaMonitorStale,
  moderationSlaAlertKind,
  moderationSlaAlertRelevance,
  moderationSlaBackoffMs,
  moderationSlaDedupeKey,
} from './moderation-sla.rules.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const SIX_HOURS = 6 * 60 * 60 * 1000
const MINUTE = 60_000
const inMs = (ms: number) => new Date(NOW.getTime() + ms)

describe('U-S-BOUNDARY: the kind comes from deriveSlaState', () => {
  it.each([
    [SIX_HOURS + 1, null],
    [SIX_HOURS, 'at_risk'],
    [1, 'at_risk'],
    [0, 'breached'],
    [-1, 'breached'],
    [-30 * 24 * SIX_HOURS, 'breached'],
  ])('remaining %d ms gives %s', (remaining, kind) => {
    expect(moderationSlaAlertKind({ dueAt: inMs(remaining), now: NOW })).toBe(kind)
  })

  it('throws on an unparseable time, so a bad row cannot read as on track', () => {
    expect(() =>
      moderationSlaAlertKind({ dueAt: new Date('not a date'), now: NOW })
    ).toThrow(RangeError)
  })
})

describe('moderationSlaDedupeKey (D5)', () => {
  it('anchors on a report, per source and kind', () => {
    expect(
      moderationSlaDedupeKey({ kind: 'at_risk', source: 'post', anchorReportId: 'r1' })
    ).toBe('sla:post:r1:at_risk')
    expect(
      moderationSlaDedupeKey({
        kind: 'breached',
        source: 'comment',
        anchorReportId: 'r1',
      })
    ).toBe('sla:comment:r1:breached')
  })

  it('keys an escalation on its decision', () => {
    expect(
      moderationSlaDedupeKey({
        kind: 'escalated',
        source: 'post',
        anchorReportId: 'r1',
        decisionId: 'd1',
      })
    ).toBe('escalated:d1')
  })
})

describe('U-S-RELEVANCE (D6, TEA-19)', () => {
  const dueSoon = inMs(MINUTE)
  it.each([
    ['at_risk', dueSoon, false, 'send'],
    ['at_risk', dueSoon, true, 'supersede'],
    ['at_risk', dueSoon, null, 'supersede'],
    ['at_risk', NOW, false, 'supersede'],
    ['at_risk', inMs(-1), false, 'supersede'],
    ['at_risk', inMs(1), false, 'send'],
    ['breached', inMs(-1), false, 'send'],
    ['breached', inMs(-1), true, 'supersede'],
    ['breached', inMs(-1), null, 'supersede'],
    ['escalated', dueSoon, false, 'send'],
    ['escalated', inMs(-1), false, 'send'],
    ['escalated', inMs(-1), true, 'supersede'],
    ['escalated', dueSoon, null, 'supersede'],
  ] as const)(
    '%s due %s with anchorResolved %s: %s',
    (kind, slaDueAt, anchorResolved, outcome) => {
      expect(
        moderationSlaAlertRelevance({ kind, slaDueAt, anchorResolved, now: NOW })
      ).toBe(outcome)
    }
  )
})

describe('U-S-BACKOFF (D9)', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 30],
    [7, 30],
    [20, 30],
    [10_000, 30],
  ])('failed attempt %d waits %d minutes', (attempts, minutes) => {
    expect(moderationSlaBackoffMs(attempts)).toBe(minutes * MINUTE)
  })
})

describe('U-R-STALE (D11)', () => {
  it.each([
    [null, true],
    [inMs(-(4 * MINUTE + 59_999)), false],
    [inMs(-5 * MINUTE), false],
    [inMs(-5 * MINUTE - 1), true],
    [NOW, false],
  ])('last sweep %s is stale %s', (lastSweepAt, stale) => {
    expect(isModerationSlaMonitorStale(lastSweepAt, NOW)).toBe(stale)
  })
})

describe('source scans', () => {
  const moderationDir = __dirname
  const sources = readdirSync(moderationDir)
    .filter((name) => /^moderation-sla\..*\.ts$/.test(name) && !name.endsWith('.spec.ts'))
    .map((name) => ({
      name,
      text: readFileSync(join(moderationDir, name), 'utf8'),
    }))

  it('U-S-NO-THRESHOLD: the sweep sources exist and copy no SLA threshold', () => {
    expect(sources.map((source) => source.name)).toEqual(
      expect.arrayContaining([
        'moderation-sla.channel.ts',
        'moderation-sla.repository.ts',
        'moderation-sla.rules.ts',
        'moderation-sla.sweep.ts',
      ])
    )
    for (const { name, text } of sources)
      expect(text, name).not.toMatch(
        /21_?600(_?000)?\b|\b6 \* 60 \* 60|interval '\d+ hours?'/
      )
  })

  it('U-S-NO-DB-CLOCK: new SQL reads no database clock and binds no Date (TEA-15)', () => {
    const repository = sources.find(
      (source) => source.name === 'moderation-sla.repository.ts'
    )
    expect(repository).toBeDefined()
    const code = repository!.text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
    expect(code).not.toMatch(/\bnow\(\)|CURRENT_TIMESTAMP|timestamptz/i)
    // Every instant in a raw template is cast from text. A bare interpolation beside a column is the defect.
    const rawTemplates =
      code.match(/(\$queryRaw|\$executeRaw|Prisma\.sql)`[^`]*`/gs) ?? []
    expect(rawTemplates.length).toBeGreaterThan(0)
    for (const template of rawTemplates)
      expect(template).not.toMatch(/\$\{[^}]+\}(?!::timestamp)/)
  })

  it('I-S-NO-REOPEN: no code path clears resolved_at (D2)', () => {
    const apiSrc = join(moderationDir, '..', '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    const offenders = walk(apiSrc)
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'))
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        return (
          /data:\s*\{[^}]*resolved_at:\s*null/s.test(text) ||
          /SET\s+"?resolved_at"?\s*=\s*NULL/i.test(text)
        )
      })
    expect(offenders).toEqual([])
  })
})
