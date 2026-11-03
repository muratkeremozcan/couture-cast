// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-Q-CURSOR. The signed, versioned, filter-bound keyset cursor (D7).
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModerationCasesQuery } from '@couture/api-client/contracts/http'
import {
  decodeModerationQueueCursor,
  encodeModerationQueueCursor,
  type ModerationQueueFilters,
  type ModerationQueuePosition,
} from './moderation-queue-cursor.js'

const SECRET = 'fixture-moderation-cursor-signing-key-0123456789'
afterEach(() => vi.unstubAllEnvs())

const filters: ModerationQueueFilters = { status: 'open' }
const position: ModerationQueuePosition = {
  rank: 2,
  dueKey: '2026-11-03T12:00:00.123456Z',
  caseKey: 'post.p1',
}
const mint = (scope: ModerationQueueFilters = filters, at = position) => {
  vi.stubEnv('ANALYTICS_ID_SECRET', SECRET)
  return encodeModerationQueueCursor(at, scope)
}
const resign = (payload: object) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', SECRET)
    .update(`moderation-queue-cursor:${body}`)
    .digest('base64url')
  return `${body}.${signature}`
}
const payloadOf = (cursor: string) =>
  JSON.parse(Buffer.from(cursor.split('.')[0]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
const expectInvalid = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({
      response: { statusCode: 400, code: 'invalid_cursor' },
    })
    return
  }
  throw new Error('expected invalid_cursor')
}

describe('U-Q-CURSOR', () => {
  it('round-trips the exact sort tuple, microseconds included', () => {
    expect(decodeModerationQueueCursor(mint(), filters)).toEqual(position)
  })

  it('carries only the version, the filter key and the sort tuple', () => {
    const payload = payloadOf(mint())
    expect(Object.keys(payload).sort()).toEqual([
      'caseKey',
      'dueKey',
      'filters',
      'rank',
      'version',
    ])
    expect(payload.version).toBe(1)
    expect(JSON.stringify(payload)).not.toMatch(/@|token|secret|user/i)
  })

  it('rejects a tampered payload and a tampered signature', () => {
    const cursor = mint()
    const [payload, signature] = cursor.split('.') as [string, string]
    const forged = payloadOf(cursor)
    forged.rank = 0
    const swapped = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`
    for (const bad of [
      swapped,
      `${payload}.${signature.slice(0, -2)}AA`,
      `${payload}.${signature.slice(1)}`,
      `${payload.slice(0, -2)}AA.${signature}`,
    ])
      expectInvalid(() => decodeModerationQueueCursor(bad, filters))
  })

  it('rejects a cursor signed under a different secret', () => {
    const cursor = mint()
    vi.stubEnv('ANALYTICS_ID_SECRET', 'a-completely-different-signing-secret-value-0000')
    expectInvalid(() => decodeModerationQueueCursor(cursor, filters))
  })

  it('rejects the wrong version, extra keys and out-of-range tuples even when correctly signed', () => {
    mint()
    const base = payloadOf(mint())
    for (const patch of [
      { version: 2 },
      { version: 0 },
      { extra: 'x' },
      { rank: 3 },
      { rank: -1 },
      { rank: 1.5 },
      { dueKey: '2026-11-03T12:00:00.123Z' },
      { dueKey: 'yesterday' },
      { caseKey: '' },
      { caseKey: 'x'.repeat(161) },
      { filters: 7 },
    ])
      expectInvalid(() =>
        decodeModerationQueueCursor(resign({ ...base, ...patch }), filters)
      )
  })

  it('rejects malformed shapes, surplus segments and oversized values', () => {
    const cursor = mint()
    for (const bad of [
      '',
      '.',
      'a.',
      '.b',
      `${cursor}.extra`,
      `${cursor}x`,
      `${cursor.slice(0, -1)}!`,
      'not base64 at all.sig',
      `${'A'.repeat(10_000)}.${'B'.repeat(10_000)}`,
    ])
      expectInvalid(() => decodeModerationQueueCursor(bad, filters))
  })

  describe('binds the cursor to the exact filter set', () => {
    const scopes: [string, ModerationQueueFilters, ModerationQueueFilters][] = [
      [
        'source',
        { status: 'open', source: 'post' },
        { status: 'open', source: 'comment' },
      ],
      ['source added', { status: 'open' }, { status: 'open', source: 'post' }],
      [
        'locale',
        { status: 'open', locale: 'es-419' },
        { status: 'open', locale: 'en-US' },
      ],
      ['risk', { status: 'open', risk: 'high' }, { status: 'open', risk: 'low' }],
      ['status', { status: 'open' }, { status: 'resolved' }],
      ['sla', { status: 'open', sla: 'at_risk' }, { status: 'open', sla: 'breached' }],
      ['sla removed', { status: 'open', sla: 'at_risk' }, { status: 'open' }],
    ]
    it.each(scopes)(
      'rejects a cursor minted under another %s',
      (_name, minted, replayed) => {
        const cursor = mint(minted)
        expect(decodeModerationQueueCursor(cursor, minted)).toEqual(position)
        expectInvalid(() => decodeModerationQueueCursor(cursor, replayed))
      }
    )

    it('treats an absent filter and a null filter alike but keeps the values apart', () => {
      const cursor = mint({ status: 'open', source: undefined })
      expect(decodeModerationQueueCursor(cursor, { status: 'open' })).toEqual(position)
    })

    it('does not bind the page size (RG1)', () => {
      const withLimit = { status: 'open', limit: 50 } as ModerationQueueFilters &
        Pick<ModerationCasesQuery, 'limit'>
      const cursor = mint(filters)
      expect(decodeModerationQueueCursor(cursor, withLimit)).toEqual(position)
    })
  })

  it('never yields an unsigned cursor when the secret is missing', () => {
    vi.stubEnv('ANALYTICS_ID_SECRET', '')
    vi.stubEnv('TEST_ENV', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    let minted: string | undefined
    try {
      minted = encodeModerationQueueCursor(position, filters)
    } catch {
      /* fail closed */
    }
    expect(minted).toBeUndefined()
    expectInvalid(() => decodeModerationQueueCursor('a.b', filters))
  })
})
