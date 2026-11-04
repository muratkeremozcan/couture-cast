// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderator queue contract, risk rules and SLA states.
// The oracle tables below are written out by hand from spec D5 and D6, so a drift in the
// shipped constants fails here instead of moving both sides at once.
import { describe, expect, it } from 'vitest'
import {
  SLA_AT_RISK_WINDOW_MS,
  SLA_DURATION_MS,
  communityReportReasonSchema,
  deriveCaseRisk,
  deriveCaseRiskRank,
  deriveSlaState,
  moderationCaseDetailResponseSchema,
  moderationCaseDetailSchema,
  moderationCaseIdSchema,
  moderationCaseSummarySchema,
  moderationAliasStateSchema,
  moderationSanctionSchema,
  moderationCasesQuerySchema,
  moderationCasesResponseSchema,
  moderationQueueErrorSchema,
  type CommunityReportReason,
} from '../src/contracts/http'

const REASONS = communityReportReasonSchema.options
const BASE: Record<CommunityReportReason, 0 | 1 | 2> = {
  hate_speech: 2,
  violence: 2,
  harassment: 1,
  inappropriate_content: 1,
  spam: 0,
  other: 0,
}
const RISK = ['low', 'medium', 'high'] as const
const oracle = (
  reasons: readonly CommunityReportReason[],
  hasFinding: boolean,
  reporters: number
) => {
  const base = Math.max(0, ...reasons.map((reason) => BASE[reason]))
  return Math.min(base + (hasFinding ? 1 : 0) + (reporters >= 3 ? 1 : 0), 2)
}
const subsets = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: 2 ** items.length - 1 }, (_, mask) =>
    items.filter((_item, index) => ((mask + 1) >> index) & 1)
  )

describe('U-Q-RISK-RULES: derived case risk (D5)', () => {
  it('covers every reason x finding x reporter bucket against the hand-written oracle', () => {
    for (const reason of REASONS)
      for (const hasFinding of [false, true])
        for (const reporters of [1, 2, 3, 5]) {
          const expected = oracle([reason], hasFinding, reporters)
          expect(
            deriveCaseRiskRank({
              reasons: [reason],
              hasFinding,
              distinctOpenReporters: reporters,
            }),
            `${reason} finding=${hasFinding} reporters=${reporters}`
          ).toBe(expected)
          expect(
            deriveCaseRisk({
              reasons: [reason],
              hasFinding,
              distinctOpenReporters: reporters,
            })
          ).toBe(RISK[expected])
        }
  })

  it('uses the strongest reason of every non-empty reason subset', () => {
    const all = subsets(REASONS)
    expect(all).toHaveLength(63)
    for (const reasons of all)
      for (const hasFinding of [false, true])
        for (const reporters of [2, 3])
          expect(
            deriveCaseRiskRank({ reasons, hasFinding, distinctOpenReporters: reporters })
          ).toBe(oracle(reasons, hasFinding, reporters))
  })

  it('pins the spec golden examples', () => {
    const risk = (reasons: CommunityReportReason[], hasFinding: boolean, n: number) =>
      deriveCaseRisk({ reasons, hasFinding, distinctOpenReporters: n })
    expect(risk(['hate_speech'], false, 1)).toBe('high')
    expect(risk(['violence'], false, 1)).toBe('high')
    expect(risk(['harassment'], false, 1)).toBe('medium')
    expect(risk(['inappropriate_content'], false, 2)).toBe('medium')
    expect(risk(['spam'], false, 1)).toBe('low')
    expect(risk(['other'], false, 2)).toBe('low')
    expect(risk(['spam'], true, 1)).toBe('medium')
    expect(risk(['spam'], false, 3)).toBe('medium')
    expect(risk(['spam'], true, 3)).toBe('high')
    expect(risk(['harassment'], false, 3)).toBe('high')
    expect(risk(['hate_speech'], true, 9)).toBe('high')
  })

  it('bumps the reporter count at exactly three, never at two', () => {
    expect(
      deriveCaseRiskRank({
        reasons: ['spam'],
        hasFinding: false,
        distinctOpenReporters: 2,
      })
    ).toBe(0)
    expect(
      deriveCaseRiskRank({
        reasons: ['spam'],
        hasFinding: false,
        distinctOpenReporters: 3,
      })
    ).toBe(1)
  })

  it('reads an empty reason list as low and applies the bumps from there', () => {
    expect(
      deriveCaseRisk({ reasons: [], hasFinding: false, distinctOpenReporters: 0 })
    ).toBe('low')
    expect(
      deriveCaseRisk({ reasons: [], hasFinding: true, distinctOpenReporters: 3 })
    ).toBe('high')
  })
})

describe('U-Q-SLA-STATES: derived SLA state (D6)', () => {
  const now = new Date('2026-11-03T12:00:00.000Z')
  const due = (offsetMs: number) => new Date(now.getTime() + offsetMs)
  const state = (offsetMs: number, status: 'open' | 'resolved' = 'open') =>
    deriveSlaState({ status, dueAt: due(offsetMs), now })

  it('pins the constants: a six-hour window is a quarter of the 24-hour SLA', () => {
    expect(SLA_DURATION_MS).toBe(24 * 60 * 60 * 1000)
    expect(SLA_AT_RISK_WINDOW_MS).toBe(6 * 60 * 60 * 1000)
    expect(SLA_AT_RISK_WINDOW_MS * 4).toBe(SLA_DURATION_MS)
  })

  it.each([
    ['on_track', 6 * 60 * 60 * 1000 + 1],
    ['at_risk', 6 * 60 * 60 * 1000],
    ['at_risk', 6 * 60 * 60 * 1000 - 1],
    ['at_risk', 1],
    ['breached', 0],
    ['breached', -1],
    ['breached', -48 * 60 * 60 * 1000],
    ['on_track', 24 * 60 * 60 * 1000],
  ] as const)('is %s when the case is due in %i ms', (expected, offset) => {
    expect(state(offset)).toBe(expected)
  })

  it('reads resolved whatever the due time says', () => {
    for (const offset of [-1000, 0, 1000, 7 * 60 * 60 * 1000])
      expect(state(offset, 'resolved')).toBe('resolved')
  })

  it('accepts ISO strings and Dates alike and ignores any client clock', () => {
    expect(
      deriveSlaState({
        status: 'open',
        dueAt: '2026-11-03T14:00:00.000Z',
        now: '2026-11-03T12:00:00.000Z',
      })
    ).toBe('at_risk')
    // The caller passes the server clock. A client ten minutes ahead cannot change the answer
    // because the function takes no other clock.
    expect(
      deriveSlaState({
        status: 'open',
        dueAt: '2026-11-03T18:00:00.000Z',
        now: new Date(now.getTime() + 10 * 60 * 1000),
      })
    ).toBe('at_risk')
  })

  it('refuses an unparseable due time instead of calling the case on track', () => {
    expect(() => deriveSlaState({ status: 'open', dueAt: 'not-a-date', now })).toThrow()
  })
})

const iso = '2026-11-03T12:00:00.000Z'
const summary = {
  caseId: 'post.p1',
  source: 'post',
  status: 'open',
  risk: 'high',
  slaState: 'at_risk',
  slaDueAt: iso,
  acceptedAt: iso,
  reportCount: 3,
  reasons: ['spam', 'harassment'],
  locale: 'es-419',
  hasFinding: true,
  excerpt: 'Caption',
  escalated: false,
} as const
const identity = { state: 'alias', alias: 'quiet-fox-1234' } as const
const detail = {
  caseId: 'post.p1',
  source: 'post',
  status: 'open',
  risk: 'high',
  slaState: 'at_risk',
  slaDueAt: iso,
  acceptedAt: iso,
  serverNow: iso,
  reportCount: 1,
  locale: 'en-US',
  subject: identity,
  snapshot: {
    available: true,
    caption: 'c',
    altText: 'a',
    body: null,
    climateBand: 'temperate_dry',
    capturedAt: iso,
  },
  target: { state: 'live', status: 'published', publishedAt: iso, parentBody: null },
  findings: {
    codes: ['text_policy_match'],
    categories: ['language'],
    engineVersion: '1.2.0',
    operatorNote: null,
  },
  reporters: [
    {
      identity: { state: 'erased', alias: null },
      origin: 'member',
      reason: 'spam',
      details: 'note',
      reportedAt: iso,
      resolved: false,
    },
  ],
  priorActions: [
    {
      actorKind: 'screening',
      action: 'flagged',
      reason: 'text_policy_match',
      occurredAt: iso,
    },
  ],
  media: {
    state: 'available',
    url: 'https://example.test/s?t=1',
    expiresAt: iso,
    altText: 'a',
  },
  viewerConflict: false,
  revision: '0123456789abcdef',
  allowedActions: ['resolve'],
  banKinds: [],
  escalated: false,
  firstDecisionAt: null,
  subjectStanding: {
    active: false,
    sanction: null,
    priorBanCount: 0,
    allowedAppealSteps: [],
  },
} as const

/** Every key the spec forbids on the wire (D9, Never list). */
const FORBIDDEN_KEYS = [
  'userId',
  'user_id',
  'email',
  'reporterId',
  'reporter_id',
  'reportId',
  'report_id',
  'objectPath',
  'image_object_path',
  'bucket',
  'ip',
  'ip_address',
  'token',
  'hmac',
] as const

const withKey = (value: unknown, path: (string | number)[], key: string) => {
  const copy = structuredClone(value) as Record<string, unknown>
  let cursor: Record<string, unknown> = copy
  for (const part of path) cursor = cursor[part] as Record<string, unknown>
  cursor[key] = 'leak'
  return copy
}

describe('U-Q-CONTRACT-STRICT: strict schemas and forbidden keys', () => {
  it('accepts the maximal fixtures', () => {
    expect(moderationCaseSummarySchema.safeParse(summary).success).toBe(true)
    expect(moderationCaseDetailSchema.safeParse(detail).success).toBe(true)
    expect(
      moderationCaseDetailSchema.safeParse({
        ...detail,
        media: { state: 'unavailable', reason: 'signing_failed' },
      }).success
    ).toBe(true)
  })

  describe('a reporter says who filed the report', () => {
    const withReporter = (change: object) =>
      moderationCaseDetailSchema.safeParse({
        ...detail,
        reporters: [{ ...detail.reporters[0], ...change }],
      }).success

    it('takes member and screening, and an alias state of unknown with either', () => {
      expect(withReporter({ origin: 'member' })).toBe(true)
      expect(
        withReporter({ origin: 'screening', identity: { state: 'unknown', alias: null } })
      ).toBe(true)
    })

    it('refuses an origin it does not name, or none at all', () => {
      expect(withReporter({ origin: 'system' })).toBe(false)
      expect(withReporter({ origin: undefined })).toBe(false)
    })

    it('keeps the published alias states, since a new response value breaks older clients', () => {
      expect(moderationAliasStateSchema.options).toEqual(['alias', 'erased', 'unknown'])
    })
  })

  describe('a sanction ties its kind to its expiry', () => {
    const sanction = { sanctionId: 's1', appealStatus: 'not_requested' }
    const EXPIRY = '2026-11-11T12:00:00.000Z'

    it.each([
      ['temporary', EXPIRY, true],
      ['permanent', null, true],
      ['temporary', null, false],
      ['permanent', EXPIRY, false],
    ])('kind %s with expiry %s parses as %s', (kind, expiresAt, valid) => {
      expect(
        moderationSanctionSchema.safeParse({ ...sanction, kind, expiresAt }).success
      ).toBe(valid)
    })
  })

  it('holds no forbidden key anywhere in the maximal detail fixture', () => {
    const keys = new Set<string>()
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (value && typeof value === 'object')
        for (const [key, child] of Object.entries(value)) {
          keys.add(key)
          walk(child)
        }
    }
    walk(detail)
    walk(summary)
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden)).toBe(false)
  })

  const objectPaths: [string, (string | number)[]][] = [
    ['detail root', []],
    ['subject', ['subject']],
    ['snapshot', ['snapshot']],
    ['target', ['target']],
    ['findings', ['findings']],
    ['reporter', ['reporters', 0]],
    ['reporter identity', ['reporters', 0, 'identity']],
    ['prior action', ['priorActions', 0]],
    ['media', ['media']],
  ]
  it.each(objectPaths)('rejects every forbidden key on the detail %s', (_name, path) => {
    for (const key of [...FORBIDDEN_KEYS, 'extra'])
      expect(
        moderationCaseDetailSchema.safeParse(withKey(detail, path, key)).success,
        `${_name}.${key}`
      ).toBe(false)
  })

  it('rejects forbidden keys on the summary, the page and the envelopes', () => {
    for (const key of [...FORBIDDEN_KEYS, 'extra']) {
      expect(
        moderationCaseSummarySchema.safeParse({ ...summary, [key]: 'x' }).success
      ).toBe(false)
      const page = { items: [summary], nextCursor: null, serverNow: iso }
      expect(
        moderationCasesResponseSchema.safeParse({ data: { ...page, [key]: 'x' } }).success
      ).toBe(false)
      expect(
        moderationCasesResponseSchema.safeParse({ data: page, [key]: 'x' }).success
      ).toBe(false)
      expect(
        moderationCaseDetailResponseSchema.safeParse({ data: detail, [key]: 'x' }).success
      ).toBe(false)
    }
    expect(
      moderationCasesResponseSchema.safeParse({
        data: { items: [summary], nextCursor: null, serverNow: iso },
      }).success
    ).toBe(true)
  })

  it('keeps the unions and enums closed', () => {
    const bad = (patch: Record<string, unknown>) =>
      moderationCaseDetailSchema.safeParse({ ...detail, ...patch }).success
    expect(bad({ media: { state: 'available', expiresAt: iso, altText: null } })).toBe(
      false
    )
    expect(
      bad({
        media: { state: 'unavailable', reason: 'signing_failed', url: 'https://x.test/' },
      })
    ).toBe(false)
    expect(bad({ media: { state: 'unavailable', reason: 'because' } })).toBe(false)
    expect(bad({ media: { state: 'pending' } })).toBe(false)
    expect(bad({ subject: { state: 'person', alias: 'x' } })).toBe(false)
    expect(bad({ risk: 'critical' })).toBe(false)
    expect(bad({ slaState: 'late' })).toBe(false)
    expect(bad({ status: 'closed' })).toBe(false)
    expect(bad({ reporters: [] })).toBe(false)
    expect(
      bad({ reporters: [{ ...detail.reporters[0], details: 'x'.repeat(501) }] })
    ).toBe(false)
    expect(
      bad({ priorActions: [{ ...detail.priorActions[0], actorKind: 'robot' }] })
    ).toBe(false)
  })

  it('keeps the error body closed and free of case data', () => {
    const body = { statusCode: 503, code: 'audit_unavailable', message: 'Unavailable' }
    expect(moderationQueueErrorSchema.safeParse(body).success).toBe(true)
    expect(moderationQueueErrorSchema.safeParse({ ...body, code: 'oops' }).success).toBe(
      false
    )
    expect(
      moderationQueueErrorSchema.safeParse({ ...body, caseId: 'post.p1' }).success
    ).toBe(false)
  })
})

describe('U-Q-FILTER-SCHEMA: queue query string', () => {
  const parse = (query: Record<string, unknown>) =>
    moderationCasesQuerySchema.safeParse(query)

  it('defaults status to open and limit to 25', () => {
    expect(parse({})).toMatchObject({
      success: true,
      data: { status: 'open', limit: 25 },
    })
  })

  it('accepts one value for every filter', () => {
    expect(
      parse({
        source: 'comment',
        locale: 'es-419',
        risk: 'high',
        status: 'resolved',
        sla: 'at_risk',
        limit: '10',
        cursor: 'abc.def',
      }).success
    ).toBe(true)
    expect(parse({ locale: 'unknown' }).success).toBe(true)
  })

  it.each([
    ['source', 'Post'],
    ['source', 'screening'],
    ['source', ['post', 'comment']],
    ['risk', 'critical'],
    ['risk', ''],
    ['risk', ['low', 'high']],
    ['status', 'all'],
    ['sla', 'late'],
    ['sla', ['at_risk', 'breached']],
    ['locale', 'es 419'],
    ['locale', "es-419'; DROP TABLE x;--"],
    ['locale', 'a'.repeat(36)],
    ['locale', ''],
    ['cursor', ''],
    ['cursor', 'c'.repeat(1025)],
    ['unexpected', '1'],
  ])('rejects %s=%j', (key, value) => {
    expect(parse({ [key]: value }).success).toBe(false)
  })

  it.each(['1', '25', '50', 1, 50])('accepts limit %j', (limit) => {
    expect(parse({ limit }).success).toBe(true)
  })

  it.each([
    '0',
    '-1',
    '51',
    '500',
    '25.5',
    'abc',
    '',
    ' ',
    '1e1',
    '0x10',
    ' 7 ',
    'Infinity',
    null,
  ])('rejects limit %j', (limit) => {
    expect(parse({ limit }).success, `limit=${String(limit)}`).toBe(false)
  })
})

describe('U-Q-CASEID: case id grammar', () => {
  it.each(['post.abc', 'comment.c-1_B', 'orphan-post.x9', 'orphan-comment.cl9abc123'])(
    'accepts %s',
    (id) => {
      expect(moderationCaseIdSchema.safeParse(id).success).toBe(true)
    }
  )

  it.each([
    '',
    ' ',
    'post.',
    'post',
    '.abc',
    'foo.bar',
    'POST.abc',
    'post.a/b',
    'post.a%2Fb',
    'post.a b',
    'post.a.b',
    'post.é',
    'post.abc\n',
    'post.abc\u0000',
    `post.${'a'.repeat(200)}`,
    "post.a';--",
    'post.<script>',
  ])('rejects %j', (id) => {
    expect(moderationCaseIdSchema.safeParse(id).success).toBe(false)
  })
})
