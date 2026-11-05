// Story 6.11 test owner: U-A-TRANSITIONS, U-B-ACTIVE, U-B-BODY and U-B-ROUTE-MATRIX.
// Appeal steps run the real service and repository against an in-memory Prisma double.
// The route matrix reflects over the three community controllers, so a new handler fails until
// someone decides its row. Each enforced row also walks the source of its path to the sanction
// check. The real-stack refusal of each route is I-B-ROUTES in the integration suite.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ForbiddenException,
  HttpException,
  Logger,
  RequestMethod,
  type Type,
} from '@nestjs/common'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import * as ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_BANNED_MESSAGE,
  communityBannedErrorSchema,
  moderationAppealInputSchema,
  moderationStoredAppealResultSchema,
  type ModerationAppealStatus,
  type ModerationAppealStep,
} from '@couture/api-client/contracts/http'
import { API_ROLES_KEY } from '../auth/security.decorators.js'
import { RolesGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import {
  assertCommunityMemberNotSanctioned,
  findActiveCommunitySanction,
} from '../community/community-access.service.js'
import { CommunityCommentsController } from '../community/community-comments.controller.js'
import { CommunitySyncController } from '../community/community-sync.controller.js'
import { CommunityController } from '../community/community.controller.js'
import { ModerationDecisionsRepository } from './moderation-decisions.repository.js'
import {
  ModerationSanctionsService,
  type ModerationAfterCommit,
} from './moderation-sanctions.service.js'

type Row = Record<string, unknown>

const T0 = new Date('2026-11-04T12:00:00.000Z')
const DAY_MS = 86_400_000
const MOD: RequestAuthContext = { token: 't', userId: 'mod-1', role: 'moderator' }
const ADMIN: RequestAuthContext = { token: 't', userId: 'admin-1', role: 'admin' }
const SUBJECT = 'subject-1'
const SANCTION_ID = 'sanction-1'
const REASON = 'HOSTILE-APPEAL-WORDS'

const sanctionRow = (overrides: Row = {}): Row => ({
  id: SANCTION_ID,
  user_id: SUBJECT,
  decision_id: 'd-origin',
  case_key: 'post.p1',
  kind: 'permanent',
  expires_at: null,
  lifted_at: null,
  appeal_status: 'not_requested',
  created_at: new Date(T0.getTime() - DAY_MS),
  ...overrides,
})

const originDecision = (overrides: Row = {}): Row => ({
  id: 'd-origin',
  case_key: 'post.p1',
  sequence: 1,
  source: 'post',
  post_id: 'p1',
  comment_id: null,
  report_ids: ['r1'],
  subject_alias: 'quiet-fox',
  ...overrides,
})

/** Reads the where clause enforcement builds, and fails on a shape it was never taught. */
function activeWhereMatches(row: Row, where: Row): boolean {
  const known = new Set(['user_id', 'lifted_at', 'OR'])
  for (const key of Object.keys(where))
    if (!known.has(key)) throw new Error(`The double has no filter for ${key}`)
  if (row.user_id !== where.user_id) return false
  if ('lifted_at' in where && row.lifted_at !== where.lifted_at) return false
  const arms = (where.OR ?? []) as { expires_at: null | { gt: Date } }[]
  if (arms.length === 0) return true
  return arms.some(({ expires_at: expires }) =>
    expires === null
      ? row.expires_at === null
      : row.expires_at instanceof Date && row.expires_at > expires.gt
  )
}

function buildAppeal(
  seed: {
    sanction?: Row | null
    operatorSanctions?: Row[]
    origin?: Row
    postReports?: Row[]
    commentReports?: Row[]
    decisions?: Row[]
    profile?: Row | null
  } = {}
) {
  const state = {
    sanction: seed.sanction === undefined ? sanctionRow() : seed.sanction,
    decisions: [originDecision(seed.origin), ...(seed.decisions ?? [])],
    audits: [] as Row[],
    restoredPosts: 0,
    restoredComments: 0,
  }
  const log: string[] = []
  const allSanctions = () => [
    ...(state.sanction ? [state.sanction] : []),
    ...(seed.operatorSanctions ?? []),
  ]
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray) => {
      log.push(strings.join('?'))
      return Promise.resolve(1)
    }),
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      log.push(strings.join('?'))
      return Promise.resolve([{ id: SANCTION_ID }])
    }),
    communitySanction: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === SANCTION_ID ? state.sanction : null)
      ),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...state.sanction })),
      findFirst: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(
          allSanctions().find((row) => activeWhereMatches(row, where)) ?? null
        )
      ),
      update: vi.fn(({ data }: { data: Row }) => {
        Object.assign(state.sanction!, data)
        return Promise.resolve(state.sanction)
      }),
    },
    moderationDecision: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: {
            moderator_id_mutation_id: { moderator_id: string; mutation_id: string }
          }
        }) =>
          Promise.resolve(
            state.decisions.find(
              (row) =>
                row.moderator_id === where.moderator_id_mutation_id.moderator_id &&
                row.mutation_id === where.moderator_id_mutation_id.mutation_id
            ) ?? null
          )
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(state.decisions.find((row) => row.id === where.id))
      ),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(() =>
        Promise.resolve({
          sequence: Math.max(...state.decisions.map((row) => row.sequence as number)),
        })
      ),
      create: vi.fn(({ data }: { data: Row }) => {
        state.decisions.push(data)
        return Promise.resolve(data)
      }),
    },
    moderationErasureRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    communityPostReport: {
      findMany: vi.fn(() =>
        Promise.resolve(
          seed.postReports ?? [
            {
              id: 'r1',
              reporter_id: 'reporter-1',
              resolved_at: null,
              subject_alias: 'quiet-fox',
            },
          ]
        )
      ),
      count: vi.fn().mockResolvedValue(0),
    },
    communityCommentReport: {
      findMany: vi.fn(() => Promise.resolve(seed.commentReports ?? [])),
      count: vi.fn().mockResolvedValue(0),
    },
    lookbookPost: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1', user_id: SUBJECT })),
      updateMany: vi.fn(({ where }: { where: Row }) => {
        state.restoredPosts = where.moderation_reason ? 2 : 0
        return Promise.resolve({ count: state.restoredPosts })
      }),
    },
    communityComment: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(({ where }: { where: Row }) => {
        state.restoredComments = where.screening_reason ? 1 : 0
        return Promise.resolve({ count: state.restoredComments })
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Row }) => {
        state.audits.push(data)
        return Promise.resolve(data)
      }),
    },
    userProfile: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          seed.profile === undefined
            ? { birthdate: new Date('1985-05-05T00:00:00.000Z'), preferences: null }
            : seed.profile
        )
      ),
    },
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          profile: { birthdate: new Date('1985-05-05T00:00:00.000Z') },
          teen_roles: [],
        })
      ),
    },
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  }
  const afterCommit = {
    run: vi.fn((_plan: unknown) => Promise.resolve('completed')),
  }
  const service = new ModerationSanctionsService(
    prisma as never,
    new ModerationDecisionsRepository(),
    afterCommit as unknown as ModerationAfterCommit,
    () => new Date(T0)
  )
  return { service, state, tx, log, afterCommit }
}

const step = (status: ModerationAppealStep, mutationId: string = randomUUID()) => ({
  status,
  reason: REASON,
  mutationId,
})

const codeOf = async (attempt: Promise<unknown>) => {
  const failure: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error
  )
  if (failure === undefined) return 'applied'
  if (!(failure instanceof HttpException))
    throw new Error('Expected a closed refusal', { cause: failure })
  return (failure.getResponse() as { code: string }).code
}

beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('U-A-TRANSITIONS', () => {
  const FROM: ModerationAppealStatus[] = [
    'not_requested',
    'requested',
    'upheld',
    'overturned',
  ]
  const LEGAL = new Set([
    'not_requested>requested',
    'requested>upheld',
    'requested>overturned',
  ])
  const STEPS: ModerationAppealStep[] = ['requested', 'upheld', 'overturned']
  const stateFor = (status: ModerationAppealStatus) =>
    sanctionRow({
      appeal_status: status,
      // An overturned ban is lifted in the same write.
      lifted_at: status === 'overturned' ? T0 : null,
    })

  const table = FROM.flatMap((from) =>
    STEPS.map((to) => ({ from, to, legal: LEGAL.has(`${from}>${to}`) }))
  )

  it.each(table)('admin: $from to $to is legal: $legal', async ({ from, to, legal }) => {
    const { service, state } = buildAppeal({ sanction: stateFor(from) })
    const code = await codeOf(service.recordAppeal(ADMIN, SANCTION_ID, step(to)))
    expect(code).toBe(legal ? 'applied' : 'appeal_transition_invalid')
    expect(state.sanction!.appeal_status).toBe(legal ? to : from)
    expect(state.audits).toHaveLength(legal ? 1 : 0)
  })

  it.each(table)('moderator: $from to $to', async ({ from, to, legal }) => {
    const { service, state } = buildAppeal({ sanction: stateFor(from) })
    const code = await codeOf(service.recordAppeal(MOD, SANCTION_ID, step(to)))
    // Only an admin records an outcome, whatever the state (D2).
    const expected =
      to !== 'requested'
        ? 'admin_required'
        : legal
          ? 'applied'
          : 'appeal_transition_invalid'
    expect(code).toBe(expected)
    expect(state.sanction!.appeal_status).toBe(expected === 'applied' ? to : from)
  })

  it('has no step back to not_requested: the contract refuses it for every state', () => {
    expect(
      moderationAppealInputSchema.safeParse({
        status: 'not_requested',
        reason: 'A real reason',
        mutationId: randomUUID(),
      }).success
    ).toBe(false)
  })

  it.each([
    ['moderator with a request', MOD, 'requested'],
    ['moderator with an outcome', MOD, 'upheld'],
    ['admin with an outcome', ADMIN, 'overturned'],
  ] as const)(
    'answers sanction_not_found for an unknown id ahead of every other refusal: %s',
    async (_name, auth, status) => {
      const { service } = buildAppeal({
        sanction: null,
        operatorSanctions: [sanctionRow({ id: 'other', user_id: auth.userId })],
      })
      await expect(
        codeOf(service.recordAppeal(auth, 'unknown-id', step(status)))
      ).resolves.toBe('sanction_not_found')
    }
  )

  it('orders operator_sanctioned, self_review_refused, admin_required, then the transition', async () => {
    const sanctionedAuthor = buildAppeal({
      sanction: sanctionRow({ user_id: MOD.userId }),
    })
    // The subject is the operator here, so one active row sanctions them and conflicts them.
    await expect(
      codeOf(sanctionedAuthor.service.recordAppeal(MOD, SANCTION_ID, step('upheld')))
    ).resolves.toBe('operator_sanctioned')

    const conflicted = buildAppeal({
      sanction: sanctionRow({ lifted_at: T0, user_id: MOD.userId }),
    })
    await expect(
      codeOf(conflicted.service.recordAppeal(MOD, SANCTION_ID, step('upheld')))
    ).resolves.toBe('self_review_refused')

    const moderatorOutcome = buildAppeal({
      sanction: sanctionRow({ appeal_status: 'upheld' }),
    })
    await expect(
      codeOf(moderatorOutcome.service.recordAppeal(MOD, SANCTION_ID, step('upheld')))
    ).resolves.toBe('admin_required')
  })

  it.each([
    [
      // Lifted, or the row would answer operator_sanctioned first for its own subject.
      'the subject of the sanction',
      { sanction: sanctionRow({ user_id: ADMIN.userId, lifted_at: T0 }) },
    ],
    [
      'a reporter of the originating case',
      {
        sanction: sanctionRow({ appeal_status: 'requested' }),
        postReports: [
          {
            id: 'r1',
            reporter_id: ADMIN.userId,
            resolved_at: null,
            subject_alias: null,
          },
        ],
      },
    ],
  ])('refuses %s as self review, admins included (TEA-07)', async (_name, seed) => {
    const { service } = buildAppeal(seed)
    await expect(
      codeOf(service.recordAppeal(ADMIN, SANCTION_ID, step('upheld')))
    ).resolves.toBe('self_review_refused')
  })

  it('refuses every step on an expired ban', async () => {
    for (const [status, auth] of [
      ['requested', MOD],
      ['upheld', ADMIN],
    ] as const) {
      const { service } = buildAppeal({
        sanction: sanctionRow({
          kind: 'temporary',
          expires_at: new Date(T0.getTime() - 1),
          appeal_status: status === 'requested' ? 'not_requested' : 'requested',
        }),
      })
      await expect(
        codeOf(service.recordAppeal(auth, SANCTION_ID, step(status)))
      ).resolves.toBe('appeal_transition_invalid')
    }
  })

  it('accepts a step while a temporary ban has one millisecond left', async () => {
    const { service } = buildAppeal({
      sanction: sanctionRow({
        kind: 'temporary',
        expires_at: new Date(T0.getTime() + 1),
      }),
    })
    await expect(
      codeOf(service.recordAppeal(MOD, SANCTION_ID, step('requested')))
    ).resolves.toBe('applied')
  })

  it('writes one non-terminal decision and one audit row with no subject, under the originating case lock', async () => {
    const { service, state, log } = buildAppeal()
    const mutationId = randomUUID()
    const result = await service.recordAppeal(
      MOD,
      SANCTION_ID,
      step('requested', mutationId)
    )
    expect(log[0]).toContain('moderation_case:')
    const row = state.decisions.at(-1)!
    expect(row).toMatchObject({
      case_key: 'post.p1',
      sequence: 2,
      action: 'appeal_requested',
      reason: REASON,
      is_terminal: false,
      moderator_id: MOD.userId,
      moderator_role: 'moderator',
      subject_user_id: SUBJECT,
      mutation_id: mutationId,
      report_ids: ['r1'],
      decided_at: T0,
    })
    expect(state.audits).toEqual([
      {
        user_id: MOD.userId,
        event_type: 'moderation_appeal_recorded',
        event_data: {
          decisionId: result.data.decisionId,
          caseId: 'post.p1',
          action: 'appeal_requested',
          role: 'moderator',
        },
      },
    ])
    const stored = JSON.stringify(row.response)
    expect(stored).not.toContain(REASON)
    expect(stored).not.toContain('cacheInvalidation')
    expect(moderationStoredAppealResultSchema.safeParse(row.response).success).toBe(true)
  })

  it('ends the ban on overturned, restores marked content and bumps every area', async () => {
    const { service, state, tx, afterCommit, log } = buildAppeal({
      sanction: sanctionRow({ appeal_status: 'requested' }),
    })
    const result = await service.recordAppeal(ADMIN, SANCTION_ID, step('overturned'))
    expect(state.sanction).toMatchObject({
      appeal_status: 'overturned',
      lifted_at: T0,
    })
    expect(log.some((sql) => sql.includes('community_prepare_subject_privacy'))).toBe(
      true
    )
    const marker = `community_ban:${SANCTION_ID}`
    expect(tx.lookbookPost.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        user_id: SUBJECT,
        status: 'flagged',
        moderation_reason: marker,
        published_at: { not: null },
      }) as unknown,
      data: { status: 'published', moderation_reason: null },
    })
    expect(tx.communityComment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        user_id: SUBJECT,
        status: 'blocked',
        screening_reason: marker,
      }) as unknown,
      data: { status: 'published', screening_reason: null },
    })
    expect(result.data).toMatchObject({ active: false, restoredCount: 3 })
    expect(afterCommit.run).toHaveBeenCalledWith({
      spotlight: { scope: 'all' },
      assist: true,
      sessionsOf: null,
    })
  })

  it('still ends the ban and republishes nothing when the member is no longer eligible (TEA-02)', async () => {
    const { service, state, tx } = buildAppeal({
      sanction: sanctionRow({ appeal_status: 'requested' }),
      profile: null,
    })
    const result = await service.recordAppeal(ADMIN, SANCTION_ID, step('overturned'))
    expect(state.sanction!.lifted_at).toEqual(T0)
    expect(result.data).toMatchObject({ active: false, restoredCount: 0 })
    expect(tx.lookbookPost.updateMany).not.toHaveBeenCalled()
    expect(tx.communityComment.updateMany).not.toHaveBeenCalled()
  })

  it('runs no bump for a request or an upheld outcome, and restores nothing', async () => {
    const { service, tx, afterCommit } = buildAppeal({
      sanction: sanctionRow({ appeal_status: 'requested' }),
    })
    const result = await service.recordAppeal(ADMIN, SANCTION_ID, step('upheld'))
    expect(result.data).toMatchObject({ active: true, restoredCount: 0 })
    expect(tx.lookbookPost.updateMany).not.toHaveBeenCalled()
    expect(afterCommit.run).toHaveBeenCalledWith({
      spotlight: { scope: 'none' },
      assist: false,
      sessionsOf: null,
    })
  })

  it('replays the stored response ahead of the transition and writes nothing', async () => {
    const { service, state } = buildAppeal()
    const request = step('requested')
    const first = await service.recordAppeal(MOD, SANCTION_ID, request)
    const count = state.decisions.length
    // The state moved, so a fresh step would now be an invalid transition.
    const replay = await service.recordAppeal(MOD, SANCTION_ID, request)
    expect(replay.data).toMatchObject({
      decisionId: first.data.decisionId,
      replayed: true,
    })
    expect(state.decisions).toHaveLength(count)
    expect(state.audits).toHaveLength(1)
  })

  it('answers the same id with a changed step as idempotency_mismatch', async () => {
    const { service } = buildAppeal()
    const mutationId = randomUUID()
    await service.recordAppeal(MOD, SANCTION_ID, step('requested', mutationId))
    await expect(
      codeOf(service.recordAppeal(ADMIN, SANCTION_ID, step('upheld', randomUUID())))
    ).resolves.toBe('applied')
    await expect(
      codeOf(
        service.recordAppeal(MOD, SANCTION_ID, {
          ...step('requested', mutationId),
          reason: 'A different reason',
        })
      )
    ).resolves.toBe('idempotency_mismatch')
  })
})

/** Enforcement reads `new Date()`, so these tests pin the wall clock. */
function sanctionsTable(rows: Row[]) {
  const findFirst = vi.fn(({ where }: { where: Row }) =>
    Promise.resolve(rows.find((row) => activeWhereMatches(row, where)) ?? null)
  )
  return { communitySanction: { findFirst } }
}

describe('U-B-ACTIVE', () => {
  const EXPIRES = new Date('2026-11-11T12:00:00.000Z')
  const temporary = sanctionRow({ kind: 'temporary', expires_at: EXPIRES })

  it('holds a temporary ban one millisecond before expires_at and ends it at expires_at', async () => {
    const tx = sanctionsTable([temporary])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(EXPIRES.getTime() - 1))
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).rejects.toThrow(ForbiddenException)
    vi.setSystemTime(EXPIRES)
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).resolves.toBeUndefined()
  })

  it('holds a permanent ban at any time until it is lifted', async () => {
    const rows = [sanctionRow()]
    const tx = sanctionsTable(rows)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'))
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).rejects.toThrow(ForbiddenException)
    rows[0]!.lifted_at = new Date('2099-01-01T00:00:00.000Z')
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).resolves.toBeUndefined()
  })

  it('never treats a lifted ban as active, even before its expiry', async () => {
    const tx = sanctionsTable([
      sanctionRow({ kind: 'temporary', expires_at: EXPIRES, lifted_at: T0 }),
    ])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).resolves.toBeUndefined()
  })

  it('ignores a row for another member', async () => {
    const tx = sanctionsTable([sanctionRow({ user_id: 'someone-else' })])
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).resolves.toBeUndefined()
  })

  it('binds the current time as a parameter and reads through the given client with no cache', async () => {
    const rows: Row[] = []
    const tx = sanctionsTable(rows)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    await assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    rows.push(sanctionRow())
    await expect(
      assertCommunityMemberNotSanctioned(tx as never, SUBJECT)
    ).rejects.toThrow(ForbiddenException)
    expect(tx.communitySanction.findFirst).toHaveBeenCalledTimes(2)
    const { where } = tx.communitySanction.findFirst.mock.calls[0]![0]
    expect(where.OR).toEqual([{ expires_at: null }, { expires_at: { gt: T0 } }])
  })

  it('takes an explicit instant for the decision path clock', async () => {
    const tx = sanctionsTable([temporary])
    await expect(
      findActiveCommunitySanction(tx as never, SUBJECT, new Date(EXPIRES.getTime() - 1))
    ).resolves.toBe(temporary)
    await expect(
      findActiveCommunitySanction(tx as never, SUBJECT, EXPIRES)
    ).resolves.toBeNull()
  })
})

describe('U-B-BODY', () => {
  const refusalBody = async (row: Row) => {
    const tx = sanctionsTable([row])
    const failure: unknown = await assertCommunityMemberNotSanctioned(
      tx as never,
      SUBJECT
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ForbiddenException)
    return (failure as ForbiddenException).getResponse()
  }

  it('is exactly the closed body for a permanent ban, with a null expiry', async () => {
    const body = await refusalBody(sanctionRow({ appeal_status: 'requested' }))
    expect(body).toEqual({
      statusCode: 403,
      code: 'community_banned',
      message: COMMUNITY_BANNED_MESSAGE,
      sanction: { kind: 'permanent', expiresAt: null, appealStatus: 'requested' },
    })
    expect(communityBannedErrorSchema.safeParse(body).success).toBe(true)
  })

  it('is exactly the closed body for a temporary ban, with its expiry', async () => {
    const expires = new Date(Date.now() + DAY_MS)
    const body = await refusalBody(
      sanctionRow({ kind: 'temporary', expires_at: expires })
    )
    expect(body).toEqual({
      statusCode: 403,
      code: 'community_banned',
      message: COMMUNITY_BANNED_MESSAGE,
      sanction: {
        kind: 'temporary',
        expiresAt: expires.toISOString(),
        appealStatus: 'not_requested',
      },
    })
  })

  it('holds no reason, moderator, case or sanction id', async () => {
    const body = await refusalBody(
      sanctionRow({ reason: REASON, moderator_id: MOD.userId })
    )
    const text = JSON.stringify(body)
    for (const secret of [
      SANCTION_ID,
      'd-origin',
      'post.p1',
      SUBJECT,
      REASON,
      MOD.userId,
      'community_ban:',
    ])
      expect(text).not.toContain(secret)
  })
})

describe('U-B-ROUTE-MATRIX', () => {
  const SANCTION = 'assertCommunityMemberNotSanctioned'
  /** `fn` in `file` must still call `callee`. */
  type Call = readonly [file: string, fn: string, callee: string]
  /** One of these calls must hold, because the check may sit in either place. */
  type Link = Call | { anyOf: Call[] }

  const READ_ACCESS: Link[] = [
    ['community-access.service.ts', 'assertCommunityDatabaseReadAccess', SANCTION],
  ]
  const DATABASE_ACCESS: Link[] = [
    [
      'community-access.service.ts',
      'assertCommunityDatabaseAccess',
      'assertCommunityDatabaseReadAccess',
    ],
    ...READ_ACCESS,
  ]
  const READ_GATE: Link[] = [
    ['community.service.ts', 'readAuthorized', 'this.repository.assertReadEligibility'],
    [
      'community.repository.ts',
      'assertReadEligibility',
      'assertCommunityReadEligibility',
    ],
    [
      'community-access.service.ts',
      'assertCommunityReadEligibility',
      'assertCommunityDatabaseReadAccess',
    ],
    ...READ_ACCESS,
  ]
  const COMMENT_READ_GATE: Link[] = [
    [
      'community-comments.service.ts',
      'readAuthorized',
      'this.repository.assertReadEligibility',
    ],
    [
      'community-comments.repository.ts',
      'assertReadEligibility',
      'assertCommunityReadEligibility',
    ],
    [
      'community-access.service.ts',
      'assertCommunityReadEligibility',
      'assertCommunityDatabaseReadAccess',
    ],
    ...READ_ACCESS,
  ]
  const ACCESS_SERVICE: Link[] = [
    ['community-access.service.ts', 'authorize', 'this.assertDatabase'],
    ['community-access.service.ts', 'assertDatabase', 'assertCommunityDatabaseAccess'],
    ...DATABASE_ACCESS,
  ]

  type Expected =
    | { effect: 'enforced'; path: Link[] | Link[][] }
    | { effect: 'exempt'; clean: (readonly [file: string, fn: string])[] }
    | { effect: 'admin-only' }

  interface MatrixRow {
    method: RequestMethod
    route: string
    expected: Expected
  }

  const CONTROLLER = 'community.controller.ts'
  const COMMENTS = 'community-comments.controller.ts'
  const SYNC = 'community-sync.controller.ts'

  const MATRIX: Record<string, Record<string, MatrixRow>> = {
    CommunityController: {
      getFeed: {
        method: RequestMethod.GET,
        route: 'feed',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'getFeed', 'this.communityService.getFeed'],
            ['community.service.ts', 'getFeed', 'this.readAuthorized'],
            ...READ_GATE,
          ],
        },
      },
      getSpotlight: {
        method: RequestMethod.GET,
        route: 'spotlight',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'getSpotlight', 'this.spotlightService.getSpotlight'],
            [
              'community-spotlight.service.ts',
              'getSpotlight',
              'this.community.readAuthorized',
            ],
            ...READ_GATE,
          ],
        },
      },
      getPost: {
        method: RequestMethod.GET,
        route: 'posts/:postId',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'getPost', 'this.communityService.getPost'],
            ['community.service.ts', 'getPost', 'this.readAuthorized'],
            ...READ_GATE,
          ],
        },
      },
      setReaction: {
        method: RequestMethod.PUT,
        route: 'posts/:postId/reaction',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'setReaction', 'this.communityService.setReaction'],
            ['community.service.ts', 'setReaction', 'this.repository.setReaction'],
            ['community.repository.ts', 'setReaction', SANCTION],
          ],
        },
      },
      allocatePost: {
        method: RequestMethod.POST,
        route: 'posts/allocate',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'allocatePost', 'this.communityService.allocatePost'],
            ['community.service.ts', 'allocatePost', 'this.repository.createPostDraft'],
            [
              'community.repository.ts',
              'createPostDraft',
              'assertCommunityDatabaseAccess',
            ],
            ...DATABASE_ACCESS,
          ],
        },
      },
      publishPost: {
        method: RequestMethod.POST,
        route: 'posts/publish',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'publishPost', 'this.communityService.publishPost'],
            ['community.service.ts', 'publishPost', 'this.repository.publishWithinQuota'],
            [
              'community.repository.ts',
              'publishWithinQuota',
              'assertCommunityDatabaseAccess',
            ],
            ...DATABASE_ACCESS,
          ],
        },
      },
      // Two bodies reach this route, and each arm has its own path to the check. TEA-17.
      openPost: {
        method: RequestMethod.POST,
        route: 'posts/:postId/opened',
        expected: {
          effect: 'enforced',
          path: [
            [
              [CONTROLLER, 'openPost', 'this.communityService.recordCardOpened'],
              {
                anyOf: [
                  ['community.service.ts', 'recordCardOpened', 'assertNotSanctioned'],
                  [
                    'community.service.ts',
                    'assertPublicPostReadable',
                    'assertNotSanctioned',
                  ],
                ],
              },
              ['community.repository.ts', 'assertNotSanctioned', SANCTION],
            ],
            [
              [CONTROLLER, 'openPost', 'this.spotlightService.recordOpened'],
              {
                anyOf: [
                  [
                    'community-spotlight.service.ts',
                    'recordOpened',
                    'assertNotSanctioned',
                  ],
                  [
                    'community.service.ts',
                    'assertPublicPostReadable',
                    'assertNotSanctioned',
                  ],
                ],
              },
              ['community.repository.ts', 'assertNotSanctioned', SANCTION],
            ],
          ],
        },
      },
      reportPost: {
        method: RequestMethod.POST,
        route: 'posts/:postId/report',
        expected: {
          effect: 'enforced',
          path: [
            [CONTROLLER, 'reportPost', 'this.communityService.reportPost'],
            ['community.service.ts', 'reportPost', 'this.repository.recordReport'],
            ['community.repository.ts', 'recordReport', SANCTION],
          ],
        },
      },
      // Retraction is the author's right, so a ban never closes it (D8).
      withdrawPost: {
        method: RequestMethod.POST,
        route: 'posts/:postId/withdraw',
        expected: {
          effect: 'exempt',
          clean: [
            ['community.service.ts', 'withdrawPost'],
            ['community.repository.ts', 'withdrawPostAndRequestErasure'],
          ],
        },
      },
      createChallenge: {
        method: RequestMethod.POST,
        route: 'challenges',
        expected: { effect: 'admin-only' },
      },
      updateChallenge: {
        method: RequestMethod.PATCH,
        route: 'challenges/:id',
        expected: { effect: 'admin-only' },
      },
    },
    CommunityCommentsController: {
      roots: {
        method: RequestMethod.GET,
        route: 'comments',
        expected: {
          effect: 'enforced',
          path: [
            [COMMENTS, 'roots', 'this.comments.list'],
            ['community-comments.service.ts', 'list', 'this.readAuthorized'],
            ...COMMENT_READ_GATE,
          ],
        },
      },
      replies: {
        method: RequestMethod.GET,
        route: 'comments/:commentId/replies',
        expected: {
          effect: 'enforced',
          path: [
            [COMMENTS, 'replies', 'this.comments.list'],
            ['community-comments.service.ts', 'list', 'this.readAuthorized'],
            ...COMMENT_READ_GATE,
          ],
        },
      },
      submissions: {
        method: RequestMethod.GET,
        route: 'comment-submissions',
        expected: {
          effect: 'enforced',
          path: [
            [COMMENTS, 'submissions', 'this.comments.submissions'],
            ['community-comments.service.ts', 'submissions', 'this.readAuthorized'],
            ...COMMENT_READ_GATE,
          ],
        },
      },
      create: {
        method: RequestMethod.POST,
        route: 'comments',
        expected: {
          effect: 'enforced',
          path: [
            [COMMENTS, 'create', 'this.comments.create'],
            ['community-comments.service.ts', 'create', 'this.repository.create'],
            ['community-comments.repository.ts', 'create', SANCTION],
          ],
        },
      },
      // The shared closure and thread helper stay clean, or delete would close too (TEA-18).
      delete: {
        method: RequestMethod.DELETE,
        route: 'comments/:commentId',
        expected: {
          effect: 'exempt',
          clean: [
            ['community-comments.service.ts', 'delete'],
            ['community-comments.service.ts', 'eligibility'],
            ['community-comments.repository.ts', 'delete'],
            ['community-comments.repository.ts', 'withThread'],
          ],
        },
      },
      report: {
        method: RequestMethod.POST,
        route: 'comments/:commentId/report',
        expected: {
          effect: 'enforced',
          path: [
            [COMMENTS, 'report', 'this.comments.report'],
            ['community-comments.service.ts', 'report', 'this.repository.report'],
            ['community-comments.repository.ts', 'report', SANCTION],
          ],
        },
      },
    },
    CommunitySyncController: {
      preferencesGet: {
        method: RequestMethod.GET,
        route: 'notification-preferences',
        expected: {
          effect: 'enforced',
          path: [
            [SYNC, 'preferencesGet', 'this.preferences.get'],
            ['community-preferences.service.ts', 'get', 'this.access.assert'],
            ['community-access.service.ts', 'assert', 'this.authorize'],
            ...ACCESS_SERVICE,
          ],
        },
      },
      preferencesPatch: {
        method: RequestMethod.PATCH,
        route: 'notification-preferences',
        expected: {
          effect: 'enforced',
          path: [
            [SYNC, 'preferencesPatch', 'this.preferences.patch'],
            ['community-preferences.service.ts', 'patch', 'this.access.assert'],
            ['community-access.service.ts', 'assert', 'this.authorize'],
            ...ACCESS_SERVICE,
          ],
        },
      },
      events: {
        method: RequestMethod.GET,
        route: 'events',
        expected: {
          effect: 'enforced',
          path: [
            [SYNC, 'events', 'this.sync.events'],
            ['community-sync.service.ts', 'events', 'this.access.authorize'],
            ...ACCESS_SERVICE,
          ],
        },
      },
      resolve: {
        method: RequestMethod.POST,
        route: 'targets/resolve',
        expected: {
          effect: 'enforced',
          path: [
            [SYNC, 'resolve', 'this.targets.resolve'],
            ['community-targets.service.ts', 'resolve', 'this.access.authorize'],
            ...ACCESS_SERVICE,
          ],
        },
      },
    },
  }

  const CONTROLLERS: Type<unknown>[] = [
    CommunityController,
    CommunityCommentsController,
    CommunitySyncController,
  ]

  const handlerOf = (controller: Type<unknown>, name: string) =>
    Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object

  /** Every routed handler on a controller, read from the decorators. */
  function routedHandlers(controller: Type<unknown>) {
    return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      if (name === 'constructor') return []
      const handler = handlerOf(controller, name)
      if (typeof handler !== 'function') return []
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined
      const route = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
      return method === undefined || route === undefined ? [] : [{ name, method, route }]
    })
  }

  function undecided(controller: Type<unknown>, table: typeof MATRIX): string[] {
    const rows = table[controller.name] ?? {}
    return routedHandlers(controller)
      .filter(({ name }) => !rows[name])
      .map(({ name }) => `${controller.name}.${name}`)
  }

  const moduleDir = join(__dirname, '../community')
  const parsed = new Map<string, ts.SourceFile>()
  function sourceOf(file: string): ts.SourceFile {
    let source = parsed.get(file)
    if (!source) {
      source = ts.createSourceFile(
        file,
        readFileSync(join(moduleDir, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      parsed.set(file, source)
    }
    return source
  }

  /** The text of one function or method. Comments in it do not count as calls. */
  function bodyOf(file: string, fn: string): string {
    let found: string | undefined
    const visit = (node: ts.Node) => {
      if (found !== undefined) return
      const named =
        (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        node.name?.getText() === fn &&
        node.body
      if (named) {
        const printer = ts.createPrinter({ removeComments: true })
        found = printer.printNode(ts.EmitHint.Unspecified, node, sourceOf(file))
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceOf(file))
    if (found === undefined) throw new Error(`${fn} is not in ${file}`)
    return found
  }

  const rows = Object.entries(MATRIX).flatMap(([controller, handlers]) =>
    Object.entries(handlers).map(([handler, row]) => ({
      id: `${controller}.${handler}`,
      controller: CONTROLLERS.find((entry) => entry.name === controller)!,
      handler,
      row,
    }))
  )
  const isArm = (entry: Link | Link[]): entry is Link[] =>
    Array.isArray(entry) && typeof entry[0] !== 'string'
  const pathsOf = (path: Link[] | Link[][]): Link[][] =>
    path.every(isArm) ? path : [path]

  it.each(CONTROLLERS.map((controller) => [controller.name, controller] as const))(
    '%s has a decided row for every handler and no row for a handler that left',
    (name, controller) => {
      expect(undecided(controller, MATRIX)).toEqual([])
      expect(
        routedHandlers(controller)
          .map((entry) => entry.name)
          .sort()
      ).toEqual(Object.keys(MATRIX[name]!).sort())
    }
  )

  it('reports a new handler with no row', () => {
    class StrayController {
      stray() {
        return 'a route nobody decided'
      }
    }
    const stray = handlerOf(StrayController, 'stray')
    Reflect.defineMetadata(METHOD_METADATA, RequestMethod.GET, stray)
    Reflect.defineMetadata(PATH_METADATA, 'stray', stray)
    expect(undecided(StrayController, MATRIX)).toEqual(['StrayController.stray'])
  })

  it.each(rows)(
    '$id keeps its declared method and path',
    ({ controller, handler, row }) => {
      const handlerFn = handlerOf(controller, handler)
      expect(Reflect.getMetadata(METHOD_METADATA, handlerFn)).toBe(row.method)
      expect(Reflect.getMetadata(PATH_METADATA, handlerFn)).toBe(row.route)
    }
  )

  const enforced = rows.filter(({ row }) => row.expected.effect === 'enforced')
  it.each(enforced)('$id reaches the sanction check', ({ id, row }) => {
    if (row.expected.effect !== 'enforced') return
    for (const path of pathsOf(row.expected.path))
      for (const link of path) {
        const calls = 'anyOf' in link ? link.anyOf : [link]
        const held = calls.some(([file, fn, callee]) => bodyOf(file, fn).includes(callee))
        expect(held, `${id} must make one of ${JSON.stringify(calls)}`).toBe(true)
      }
  })

  const FORBIDDEN_IN_EXEMPT = [
    SANCTION,
    'assertNotSanctioned',
    'findActiveCommunitySanction',
    'assertCommunityDatabaseAccess',
    'assertCommunityDatabaseReadAccess',
    'assertReadEligibility',
    'this.readAuthorized',
  ]
  const exempt = rows.filter(({ row }) => row.expected.effect === 'exempt')

  it('names withdraw and comment delete as the only exempt member routes', () => {
    expect(exempt.map(({ id }) => id)).toEqual([
      'CommunityController.withdrawPost',
      'CommunityCommentsController.delete',
    ])
  })

  it.each(exempt)('$id stays open to a banned member', ({ id, row }) => {
    if (row.expected.effect !== 'exempt') return
    for (const [file, fn] of row.expected.clean)
      for (const check of FORBIDDEN_IN_EXEMPT)
        expect(
          bodyOf(file, fn),
          `${id}: ${file} ${fn} must not call ${check}`
        ).not.toContain(check)
  })

  const adminOnly = rows.filter(({ row }) => row.expected.effect === 'admin-only')
  it.each(adminOnly)(
    '$id is outside the matrix because only an admin reaches it',
    ({ controller, handler }) => {
      const handlerFn = handlerOf(controller, handler)
      expect(Reflect.getMetadata(API_ROLES_KEY, handlerFn)).toEqual(['admin'])
      expect(Reflect.getMetadata(GUARDS_METADATA, handlerFn)).toContain(RolesGuard)
    }
  )

  it('does not put the check behind the enforcement flags: D9 has no flag', () => {
    expect(
      bodyOf('community-access.service.ts', 'assertCommunityMemberNotSanctioned')
    ).not.toMatch(/getFeatureFlag|communityReadEvaluation/)
    expect(
      bodyOf('community-access.service.ts', 'assertCommunityDatabaseReadAccess').indexOf(
        SANCTION
      )
    ).toBeGreaterThan(-1)
  })
})
