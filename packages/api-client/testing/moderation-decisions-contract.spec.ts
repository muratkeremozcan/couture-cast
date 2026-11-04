// Story 6.11 test owner: the decision and appeal contract and the availability rule.
// The oracle tables below are written out by hand from spec D1, D2, D4 and the TEA entries, so a
// drift in the shipped rule fails here instead of moving both sides at once.
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_BAN_MARKER_PREFIX,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  MODERATION_BAN_DURATION_DAYS,
  MODERATION_OPERATOR_TAKEDOWN_REASON,
  communityBannedErrorSchema,
  deriveAllowedActions,
  deriveAllowedAppealSteps,
  isOperatorHoldReason,
  moderationActionAvailability,
  moderationAppealInputSchema,
  moderationAppealResponseSchema,
  moderationAppealStatusSchema,
  moderationAppealStepSchema,
  moderationCaseDecisionStateSchema,
  moderationDecisionActionSchema,
  moderationDecisionDetailSchema,
  moderationDecisionErrorCodeSchema,
  moderationDecisionErrorSchema,
  moderationDecisionInputSchema,
  moderationDecisionReasonSchema,
  moderationDecisionResponseSchema,
  moderationSanctionKindSchema,
  moderationStoredDecisionResultSchema,
  moderationViewerRefusal,
  type ModerationAvailabilityInput,
} from '../src/contracts/http'

const MUTATION = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'
const REVISION = '0123456789abcdef'
const base = {
  reason: 'Breaks the community rules.',
  mutationId: MUTATION,
  expectedRevision: REVISION,
}
const SIMPLE_ACTIONS = ['resolve', 'release', 'takedown', 'escalate'] as const
const temporary = { kind: 'temporary', durationDays: 7 }

describe('U-D-CONTRACT-STRICT: the decision body (D1)', () => {
  it('accepts every arm with the required fields', () => {
    for (const action of SIMPLE_ACTIONS)
      expect(moderationDecisionInputSchema.safeParse({ action, ...base }).success).toBe(
        true
      )
    for (const ban of [temporary, { kind: 'permanent' }])
      expect(
        moderationDecisionInputSchema.safeParse({ action: 'ban', ban, ...base }).success
      ).toBe(true)
  })

  it.each(['moderatorId', 'moderator_id', 'userId', 'role', 'decidedAt', 'unknown'])(
    'refuses %s on every arm, because the moderator is the session',
    (key) => {
      for (const action of SIMPLE_ACTIONS)
        expect(
          moderationDecisionInputSchema.safeParse({ action, ...base, [key]: 'forged' })
            .success
        ).toBe(false)
      expect(
        moderationDecisionInputSchema.safeParse({
          action: 'ban',
          ban: temporary,
          ...base,
          [key]: 'forged',
        }).success
      ).toBe(false)
    }
  )

  it('accepts only the four ban durations', () => {
    expect(MODERATION_BAN_DURATION_DAYS).toEqual([1, 7, 30, 90])
    for (const durationDays of [1, 7, 30, 90])
      expect(
        moderationDecisionInputSchema.safeParse({
          action: 'ban',
          ban: { kind: 'temporary', durationDays },
          ...base,
        }).success,
        String(durationDays)
      ).toBe(true)
    for (const durationDays of [0, 2, -1, 365, 7.5, '7', null, undefined])
      expect(
        moderationDecisionInputSchema.safeParse({
          action: 'ban',
          ban: { kind: 'temporary', durationDays },
          ...base,
        }).success,
        String(durationDays)
      ).toBe(false)
  })

  it('refuses a permanent ban with a duration, a ban with no terms and an unknown kind', () => {
    for (const ban of [
      { kind: 'permanent', durationDays: 7 },
      { kind: 'forever' },
      { durationDays: 7 },
      undefined,
    ])
      expect(
        moderationDecisionInputSchema.safeParse({ action: 'ban', ban, ...base }).success,
        JSON.stringify(ban)
      ).toBe(false)
  })

  it('refuses ban terms on the other actions', () => {
    for (const action of SIMPLE_ACTIONS)
      expect(
        moderationDecisionInputSchema.safeParse({ action, ban: temporary, ...base })
          .success
      ).toBe(false)
  })

  it('refuses an unknown action and the appeal actions on the decision route', () => {
    for (const action of ['delete', 'appeal_overturned', '', null])
      expect(
        moderationDecisionInputSchema.safeParse({ action, ...base }).success,
        String(action)
      ).toBe(false)
  })

  it('refuses a missing or malformed mutation id and revision', () => {
    for (const patch of [
      { mutationId: undefined },
      { mutationId: 'not-a-uuid' },
      { expectedRevision: undefined },
      { expectedRevision: '0123456789ABCDEF' },
      { expectedRevision: '0123456789abcde' },
      { expectedRevision: '0123456789abcdef0' },
      { reason: undefined },
    ])
      expect(
        moderationDecisionInputSchema.safeParse({
          action: 'resolve',
          ...base,
          ...patch,
        }).success,
        JSON.stringify(patch)
      ).toBe(false)
  })

  it('holds the appeal body to the same rules, with only the three steps', () => {
    const appeal = { status: 'requested', reason: base.reason, mutationId: MUTATION }
    expect(moderationAppealStepSchema.options).toEqual([
      'requested',
      'upheld',
      'overturned',
    ])
    for (const status of moderationAppealStepSchema.options)
      expect(moderationAppealInputSchema.safeParse({ ...appeal, status }).success).toBe(
        true
      )
    expect(
      moderationAppealInputSchema.safeParse({ ...appeal, status: 'not_requested' })
        .success
    ).toBe(false)
    expect(
      moderationAppealInputSchema.safeParse({ ...appeal, moderatorId: 'forged' }).success
    ).toBe(false)
    expect(
      moderationAppealInputSchema.safeParse({ ...appeal, reason: 'no' }).success
    ).toBe(false)
  })
})

describe('U-D-REASON: the required reason (D1, TEA-03)', () => {
  it('trims and then measures, 3 to 1000 characters', () => {
    expect(moderationDecisionReasonSchema.parse('  abc  ')).toBe('abc')
    expect(moderationDecisionReasonSchema.safeParse('ab').success).toBe(false)
    expect(moderationDecisionReasonSchema.safeParse('  ab  ').success).toBe(false)
    expect(moderationDecisionReasonSchema.safeParse('a'.repeat(1000)).success).toBe(true)
    expect(
      moderationDecisionReasonSchema.safeParse(` ${'a'.repeat(1000)} `).success
    ).toBe(true)
    expect(moderationDecisionReasonSchema.safeParse('a'.repeat(1001)).success).toBe(false)
  })

  it.each(['', ' ', '\n\t  ', '   '])('refuses blank input %j', (reason) => {
    expect(moderationDecisionReasonSchema.safeParse(reason).success).toBe(false)
  })

  it.each([
    'unsafe_class',
    'flagged_by_screening',
    'unsafe_class, low_confidence',
    ' moderation_stalled ',
    'screening_unavailable,inference_timeout',
  ])('refuses %j, which would read as a machine verdict', (reason) => {
    expect(moderationDecisionReasonSchema.safeParse(reason).success).toBe(false)
  })

  it.each([
    `${COMMUNITY_BAN_MARKER_PREFIX}abc`,
    `  ${COMMUNITY_BAN_MARKER_PREFIX}abc`,
    COMMUNITY_BAN_MARKER_PREFIX,
  ])('refuses %j, which would read as a ban marker', (reason) => {
    expect(moderationDecisionReasonSchema.safeParse(reason).success).toBe(false)
  })

  it.each(['operator_takedown', '  operator_takedown  '])(
    'refuses %j, which would read as the takedown marker',
    (reason) => {
      expect(moderationDecisionReasonSchema.safeParse(reason).success).toBe(false)
    }
  )

  it.each([
    'Spam',
    'unsafe class of content',
    'Reported for unsafe_class wording, reviewed by hand.',
    `Mentions ${COMMUNITY_BAN_MARKER_PREFIX} in passing`,
    '<script>alert(1)</script>',
    '[link](javascript:alert(1))',
    'Sıcak 🌶️ içerik',
    'x'.repeat(1000),
  ])('accepts plain text %j unchanged', (reason) => {
    expect(moderationDecisionReasonSchema.parse(reason)).toBe(reason)
  })

  it('reports a reserved reason with no echo of the input', () => {
    const result = moderationDecisionReasonSchema.safeParse('unsafe_class')
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).not.toContain('unsafe_class')
  })
})

describe('isOperatorHoldReason: stored reasons that are not findings (TEA-04)', () => {
  it('recognizes the takedown value and the ban marker only', () => {
    expect(MODERATION_OPERATOR_TAKEDOWN_REASON).toBe('operator_takedown')
    expect(COMMUNITY_BAN_MARKER_PREFIX).toBe('community_ban:')
    expect(isOperatorHoldReason('operator_takedown')).toBe(true)
    expect(isOperatorHoldReason('community_ban:abc')).toBe(true)
    for (const reason of [
      null,
      undefined,
      '',
      'unsafe_class',
      'operator_takedown ',
      'xcommunity_ban:abc',
    ])
      expect(isOperatorHoldReason(reason), String(reason)).toBe(false)
  })
})

const publishedPost = {
  state: 'live',
  kind: 'post',
  status: 'published',
  erasureRequested: false,
} as const
const flaggedPost = { ...publishedPost, status: 'flagged' } as const

const input = (
  patch: Partial<ModerationAvailabilityInput> = {}
): ModerationAvailabilityInput => ({
  role: 'moderator',
  viewerConflict: false,
  operatorSanctioned: false,
  escalated: false,
  openReportCount: 1,
  target: publishedPost,
  subjectBan: null,
  authorEligible: true,
  writesOpen: true,
  ...patch,
})

type Rule = [
  label: string,
  patch: Partial<ModerationAvailabilityInput>,
  actions: readonly string[],
  banKinds: readonly string[],
]
const MODERATOR_ACTIONS: readonly Rule[] = [
  [
    'published post, open report',
    {},
    ['resolve', 'takedown', 'escalate', 'ban'],
    ['temporary'],
  ],
  [
    'flagged post, open report',
    { target: flaggedPost },
    ['resolve', 'release', 'escalate', 'ban'],
    ['temporary'],
  ],
  [
    'published post, no open report: can still be taken down or banned on new evidence',
    { openReportCount: 0 },
    ['takedown', 'ban'],
    ['temporary'],
  ],
  [
    'withdrawn post: retraction does not escape a ban (TEA-10)',
    { target: { ...publishedPost, status: 'withdrawn' } },
    ['resolve', 'escalate', 'ban'],
    ['temporary'],
  ],
  [
    'orphan or erased target',
    { target: { state: 'erased' } },
    ['resolve', 'escalate'],
    [],
  ],
  [
    'orphan or erased target with nothing open',
    { target: { state: 'erased' }, openReportCount: 0 },
    [],
    [],
  ],
  [
    'flagged post, author banned: no release and no second temporary',
    { target: flaggedPost, subjectBan: 'temporary' },
    ['resolve', 'escalate'],
    [],
  ],
  [
    'flagged post, author ineligible',
    { target: flaggedPost, authorEligible: false },
    ['resolve', 'escalate', 'ban'],
    ['temporary'],
  ],
  [
    'flagged post, writes closed',
    { target: flaggedPost, writesOpen: false },
    ['resolve', 'escalate', 'ban'],
    ['temporary'],
  ],
  ['escalated case: a moderator has nothing', { escalated: true }, [], []],
  ['viewer conflict: empty', { viewerConflict: true }, [], []],
  ['sanctioned operator: empty (TEA-11)', { operatorSanctioned: true }, [], []],
]
const ADMIN_ACTIONS: readonly Rule[] = [
  [
    'published post, open report',
    {},
    ['resolve', 'takedown', 'escalate', 'ban'],
    ['temporary', 'permanent'],
  ],
  [
    'escalated case: every terminal action, no second escalate',
    { escalated: true },
    ['resolve', 'takedown', 'ban'],
    ['temporary', 'permanent'],
  ],
  [
    'active temporary ban: upgrade to permanent only',
    { subjectBan: 'temporary' },
    ['resolve', 'takedown', 'escalate', 'ban'],
    ['permanent'],
  ],
  [
    'active permanent ban: no ban at all',
    { subjectBan: 'permanent' },
    ['resolve', 'takedown', 'escalate'],
    [],
  ],
  ['viewer conflict covers admins too', { viewerConflict: true }, [], []],
  ['sanctioned admin', { operatorSanctioned: true }, [], []],
]

describe('U-D-ALLOWED-RULES: deriveAllowedActions (D2, D4, TEA-10, TEA-11)', () => {
  it.each(MODERATOR_ACTIONS)('moderator: %s', (_label, patch, actions, banKinds) => {
    expect(deriveAllowedActions(input(patch))).toEqual({
      allowedActions: actions,
      banKinds,
    })
  })

  it.each(ADMIN_ACTIONS)('admin: %s', (_label, patch, actions, banKinds) => {
    expect(deriveAllowedActions(input({ role: 'admin', ...patch }))).toEqual({
      allowedActions: actions,
      banKinds,
    })
  })

  it('treats the same comment statuses as releasable and no others', () => {
    const comment = (status: string) =>
      input({
        target: { state: 'live', kind: 'comment', status, erasureRequested: false },
      })
    for (const status of ['held_for_review', 'blocked', 'screening_failed'])
      expect(deriveAllowedActions(comment(status)).allowedActions, status).toContain(
        'release'
      )
    for (const status of [
      'published',
      'pending_screening',
      'author_deleted',
      'consent_suspended',
    ])
      expect(deriveAllowedActions(comment(status)).allowedActions, status).not.toContain(
        'release'
      )
    expect(deriveAllowedActions(comment('published')).allowedActions).toContain(
      'takedown'
    )
  })

  it('agrees with the enforcing rule for every action and input in the table', () => {
    for (const [, patch] of [...MODERATOR_ACTIONS, ...ADMIN_ACTIONS])
      for (const role of ['moderator', 'admin'] as const) {
        const state = input({ role, ...patch })
        const { allowedActions, banKinds } = deriveAllowedActions(state)
        for (const action of ['resolve', 'release', 'takedown', 'escalate'] as const)
          expect(moderationActionAvailability(state, action).available).toBe(
            allowedActions.includes(action)
          )
        for (const kind of moderationSanctionKindSchema.options)
          expect(moderationActionAvailability(state, 'ban', kind).available).toBe(
            banKinds.includes(kind)
          )
      }
  })
})

describe('U-D-ALLOWED-RULES: the closed refusal for each state (D4, TEA-08, TEA-09)', () => {
  const detail = (
    patch: Partial<ModerationAvailabilityInput>,
    action: Parameters<typeof moderationActionAvailability>[1],
    kind?: 'temporary' | 'permanent'
  ) => moderationActionAvailability(input({ role: 'admin', ...patch }), action, kind)

  it.each([
    ['resolve with nothing open', { openReportCount: 0 }, 'resolve', 'no_open_reports'],
    ['escalate with nothing open', { openReportCount: 0 }, 'escalate', 'no_open_reports'],
    ['escalate twice', { escalated: true }, 'escalate', 'already_escalated'],
    ['release a published post', {}, 'release', 'target_not_held'],
    [
      'take down a flagged post',
      { target: flaggedPost },
      'takedown',
      'target_not_published',
    ],
    ['take down an orphan', { target: { state: 'erased' } }, 'takedown', 'target_erased'],
    ['release an orphan', { target: { state: 'erased' } }, 'release', 'target_erased'],
    [
      'release with erasure requested',
      { target: { ...flaggedPost, erasureRequested: true } },
      'release',
      'target_erased',
    ],
    [
      'release under an active ban',
      { target: flaggedPost, subjectBan: 'temporary' },
      'release',
      'subject_banned',
    ],
    [
      'release for an ineligible author',
      { target: flaggedPost, authorEligible: false },
      'release',
      'author_ineligible',
    ],
    [
      'release with writes closed',
      { target: flaggedPost, writesOpen: false },
      'release',
      'community_writes_closed',
    ],
  ] as const)('%s', (_label, patch, action, expected) => {
    expect(detail(patch, action)).toEqual({
      available: false,
      code: 'action_not_applicable',
      detail: expected,
    })
  })

  it('refuses a second ban by kind', () => {
    const notApplicable = (value: 'already_banned' | 'target_erased') => ({
      available: false,
      code: 'action_not_applicable',
      detail: value,
    })
    expect(detail({ subjectBan: 'temporary' }, 'ban', 'temporary')).toEqual(
      notApplicable('already_banned')
    )
    expect(detail({ subjectBan: 'temporary' }, 'ban', 'permanent')).toEqual({
      available: true,
    })
    expect(detail({ subjectBan: 'permanent' }, 'ban', 'permanent')).toEqual(
      notApplicable('already_banned')
    )
    expect(detail({ target: { state: 'erased' } }, 'ban', 'temporary')).toEqual(
      notApplicable('target_erased')
    )
  })

  it('still allows a ban on a post whose erasure was requested (TEA-10)', () => {
    expect(
      detail({ target: { ...publishedPost, erasureRequested: true } }, 'ban', 'temporary')
    ).toEqual({ available: true })
  })

  it('orders the viewer refusals: own standing, conflict, role (TEA-08)', () => {
    const all = input({ operatorSanctioned: true, viewerConflict: true, escalated: true })
    expect(moderationViewerRefusal(all, 'resolve')).toBe('operator_sanctioned')
    expect(
      moderationViewerRefusal({ ...all, operatorSanctioned: false }, 'resolve')
    ).toBe('self_review_refused')
    expect(
      moderationViewerRefusal(
        { ...all, operatorSanctioned: false, viewerConflict: false },
        'resolve'
      )
    ).toBe('admin_required')
    expect(
      moderationViewerRefusal(input({ role: 'admin' }), 'ban', 'permanent')
    ).toBeNull()
    expect(moderationViewerRefusal(input(), 'ban', 'temporary')).toBeNull()
  })

  it('places a viewer refusal ahead of every state refusal', () => {
    const unavailable = input({
      subjectBan: 'permanent',
      target: { state: 'erased' },
      openReportCount: 0,
    })
    expect(moderationActionAvailability(unavailable, 'ban', 'permanent')).toEqual({
      available: false,
      code: 'admin_required',
    })
    expect(
      moderationActionAvailability({ ...unavailable, viewerConflict: true }, 'resolve')
    ).toEqual({ available: false, code: 'self_review_refused' })
  })

  it('lets a moderator escalate an open case and refuses terminal actions once escalated', () => {
    expect(moderationViewerRefusal(input({ escalated: true }), 'escalate')).toBeNull()
    for (const action of ['resolve', 'release', 'takedown', 'ban'] as const)
      expect(
        moderationViewerRefusal(input({ escalated: true }), action, 'temporary')
      ).toBe('admin_required')
  })
})

describe('U-D-ALLOWED-RULES: deriveAllowedAppealSteps (D2, D10, TEA-07)', () => {
  const steps = (patch: Partial<Parameters<typeof deriveAllowedAppealSteps>[0]> = {}) =>
    deriveAllowedAppealSteps({
      role: 'moderator',
      viewerConflict: false,
      operatorSanctioned: false,
      sanctionActive: true,
      appealStatus: 'not_requested',
      ...patch,
    })

  it('offers each role only its legal next step', () => {
    expect(steps()).toEqual(['requested'])
    expect(steps({ role: 'admin' })).toEqual(['requested'])
    expect(steps({ appealStatus: 'requested' })).toEqual([])
    expect(steps({ role: 'admin', appealStatus: 'requested' })).toEqual([
      'upheld',
      'overturned',
    ])
  })

  it.each(['upheld', 'overturned'] as const)(
    'offers nothing after %s',
    (appealStatus) => {
      expect(steps({ role: 'admin', appealStatus })).toEqual([])
    }
  )

  it.each([
    ['a conflicted viewer', { viewerConflict: true }],
    ['a sanctioned operator', { operatorSanctioned: true }],
    ['an expired or lifted ban', { sanctionActive: false }],
  ])('offers nothing to %s', (_label, patch) => {
    expect(steps({ role: 'admin', appealStatus: 'requested', ...patch })).toEqual([])
    expect(steps(patch)).toEqual([])
  })
})

const FORBIDDEN_KEYS = [
  'moderatorId',
  'moderator_id',
  'subjectUserId',
  'subject_user_id',
  'subjectAlias',
  'userId',
  'user_id',
  'email',
  'reason',
  'marker',
  'caseKey',
  'case_key',
  'objectPath',
  'bucket',
  'signedUrl',
  'payloadHash',
  'mutationId',
]
const keysOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)])
  return []
}
const stored = {
  decisionId: 'decision-1',
  caseId: 'post.post-1',
  action: 'ban',
  decidedAt: '2026-11-04T12:00:00.000Z',
  firstDecisionAt: '2026-11-04T12:00:00.000Z',
  revision: REVISION,
  caseStatus: 'resolved',
  escalated: false,
  targetStatus: 'flagged',
  sanction: {
    sanctionId: 'sanction-1',
    kind: 'temporary',
    expiresAt: '2026-11-11T12:00:00.000Z',
    appealStatus: 'not_requested',
  },
}
const decision = { ...stored, replayed: false, cacheInvalidation: 'completed' }
const bannedBody = {
  statusCode: 403,
  code: 'community_banned',
  message: COMMUNITY_BANNED_MESSAGE,
  sanction: {
    kind: 'temporary',
    expiresAt: '2026-11-11T12:00:00.000Z',
    appealStatus: 'not_requested',
  },
}
const appealResult = {
  decisionId: 'decision-2',
  decidedAt: '2026-11-04T12:00:00.000Z',
  sanction: stored.sanction,
  active: true,
  restoredCount: 0,
  replayed: true,
  cacheInvalidation: 'deferred',
}

describe('U-D-RESPONSE-STRICT: nothing private leaves the API (D1, D6, D9)', () => {
  it('parses the maximal fixtures and finds no forbidden key at any depth', () => {
    for (const [schema, value] of [
      [moderationStoredDecisionResultSchema, stored],
      [moderationDecisionResponseSchema, { data: decision }],
      [moderationAppealResponseSchema, { data: appealResult }],
      [communityBannedErrorSchema, bannedBody],
    ] as const) {
      const parsed = schema.parse(value)
      const keys = keysOf(parsed)
      for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden)
    }
  })

  it('keeps the stored response free of per-request fields (TEA-13)', () => {
    expect(
      moderationStoredDecisionResultSchema.safeParse({ ...stored, replayed: false })
        .success
    ).toBe(false)
    expect(
      moderationStoredDecisionResultSchema.safeParse({
        ...stored,
        cacheInvalidation: 'completed',
      }).success
    ).toBe(false)
  })

  it.each(['reason', 'moderatorId', 'subjectUserId', 'signedUrl', 'case_key'])(
    'refuses %s on the decision result, the sanction and the member body',
    (key) => {
      expect(
        moderationDecisionResponseSchema.safeParse({
          data: { ...decision, [key]: 'x' },
        }).success
      ).toBe(false)
      expect(
        moderationDecisionResponseSchema.safeParse({
          data: { ...decision, sanction: { ...stored.sanction, [key]: 'x' } },
        }).success
      ).toBe(false)
      expect(
        communityBannedErrorSchema.safeParse({ ...bannedBody, [key]: 'x' }).success
      ).toBe(false)
      expect(
        communityBannedErrorSchema.safeParse({
          ...bannedBody,
          sanction: { ...bannedBody.sanction, [key]: 'x' },
        }).success
      ).toBe(false)
    }
  )

  it.each([
    ['temporary', null],
    ['permanent', '2026-11-11T12:00:00.000Z'],
  ])('refuses a %s ban with expiry %s in the member refusal', (kind, expiresAt) => {
    expect(
      communityBannedErrorSchema.safeParse({
        ...bannedBody,
        sanction: { ...bannedBody.sanction, kind, expiresAt },
      }).success
    ).toBe(false)
  })

  it('names no sanction id in the member body', () => {
    expect(
      communityBannedErrorSchema.safeParse({
        ...bannedBody,
        sanction: { ...bannedBody.sanction, sanctionId: 'sanction-1' },
      }).success
    ).toBe(false)
  })

  it('accepts a permanent ban with no expiry in the member body', () => {
    expect(
      communityBannedErrorSchema.safeParse({
        ...bannedBody,
        sanction: { kind: 'permanent', expiresAt: null, appealStatus: 'requested' },
      }).success
    ).toBe(true)
  })

  it('keeps the case decision state closed', () => {
    const state = {
      revision: REVISION,
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
    }
    expect(moderationCaseDecisionStateSchema.safeParse(state).success).toBe(true)
    for (const key of ['subjectUserId', 'moderatorId', 'marker'])
      expect(
        moderationCaseDecisionStateSchema.safeParse({ ...state, [key]: 'x' }).success
      ).toBe(false)
    expect(
      moderationCaseDecisionStateSchema.safeParse({
        ...state,
        subjectStanding: { ...state.subjectStanding, subjectUserId: 'x' },
      }).success
    ).toBe(false)
  })
})

describe('U-D-ERRORS-CLOSED: the closed vocabulary (D1, D4, D10)', () => {
  it('pins every error code, detail, action, kind and appeal status', () => {
    expect([...moderationDecisionErrorCodeSchema.options].sort()).toEqual(
      [
        'action_not_applicable',
        'admin_required',
        'appeal_transition_invalid',
        'audit_unavailable',
        'case_conflict',
        'case_not_found',
        'idempotency_mismatch',
        'invalid_decision',
        'moderation_console_disabled',
        'moderation_decisions_disabled',
        'operator_sanctioned',
        'sanction_not_found',
        'self_review_refused',
      ].sort()
    )
    expect([...moderationDecisionDetailSchema.options].sort()).toEqual(
      [
        'already_banned',
        'already_escalated',
        'author_ineligible',
        'community_writes_closed',
        'no_open_reports',
        'subject_banned',
        'target_erased',
        'target_not_held',
        'target_not_published',
      ].sort()
    )
    expect(moderationDecisionActionSchema.options).toEqual([
      'resolve',
      'release',
      'takedown',
      'escalate',
      'ban',
    ])
    expect(moderationSanctionKindSchema.options).toEqual(['temporary', 'permanent'])
    expect(moderationAppealStatusSchema.options).toEqual([
      'not_requested',
      'requested',
      'upheld',
      'overturned',
    ])
  })

  it('refuses an unknown code, an unknown detail and any echoed input on an error', () => {
    const error = {
      statusCode: 409,
      code: 'action_not_applicable',
      message: 'Not applicable.',
      detail: 'target_not_held',
    }
    expect(moderationDecisionErrorSchema.safeParse(error).success).toBe(true)
    expect(
      moderationDecisionErrorSchema.safeParse({ ...error, code: 'nope' }).success
    ).toBe(false)
    expect(
      moderationDecisionErrorSchema.safeParse({ ...error, detail: 'nope' }).success
    ).toBe(false)
    expect(
      moderationDecisionErrorSchema.safeParse({ ...error, reason: 'echoed' }).success
    ).toBe(false)
    expect(
      moderationDecisionErrorSchema.safeParse({
        statusCode: 409,
        code: 'case_conflict',
        message: 'Moved.',
        currentRevision: 'NOTHEX',
      }).success
    ).toBe(false)
  })

  it('keeps the banned message apart from the copy both clients match first (TEA-22)', () => {
    expect(COMMUNITY_BANNED_MESSAGE).not.toContain(COMMUNITY_FEED_DISABLED_MESSAGE)
    expect(COMMUNITY_BANNED_MESSAGE).not.toContain(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
    expect(COMMUNITY_FEED_DISABLED_MESSAGE).not.toContain(COMMUNITY_BANNED_MESSAGE)
  })
})
