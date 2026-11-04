// Story 6.11 test owner: U-D-REVISION, U-D-SVC-PRECEDENCE, -HASH, -CLOCK, -LOGGING, -STORED-RESPONSE,
// -POSTCOMMIT, -ERRORMAP, -INSERT-ONLY and U-D-READSET.
// The real decision service, repository, operator service and after-commit runner run against an
// in-memory Prisma double. Its transaction restores the rows on a throw, as a rollback would.
// Real locks, real constraints and real rollback stay proved by the integration suite.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpException, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  moderationStoredDecisionResultSchema,
  type ModerationBanTerms,
  type ModerationDecisionInput,
} from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommunityModerationActionsService } from '../community/community-moderation.actions.js'
import {
  computeDecisionPayloadHash,
  computeModerationCaseRevision,
  type DecisionPayload,
} from './moderation-decision-rules.js'
import { ModerationDecisionsRepository } from './moderation-decisions.repository.js'
import { ModerationDecisionsService } from './moderation-decisions.service.js'
import { MODERATION_QUEUE_READ_TABLES } from './moderation-queue-tables.js'
import {
  MODERATION_AFTER_COMMIT_BOUND_MS,
  ModerationAfterCommit,
  ModerationSanctionsService,
} from './moderation-sanctions.service.js'

type Row = Record<string, unknown>

const T0 = new Date('2026-11-04T12:00:00.000Z')
const T1 = new Date('2026-11-04T12:05:00.000Z')
const DAY_MS = 86_400_000
const MOD: RequestAuthContext = { token: 't', userId: 'mod-1', role: 'moderator' }
const ADMIN: RequestAuthContext = { token: 't', userId: 'admin-1', role: 'admin' }
const AUTHOR = 'author-subject-1'
const ALIAS = 'quiet-fox-alias'
const REASON = 'HOSTILE-OPERATOR-WORDS <script>'
const SIGNED = 'https://storage.test/object/sign/community/p1/img.jpg?token=SECRET'

const postRow = (overrides: Row = {}): Row => ({
  id: 'p1',
  user_id: AUTHOR,
  status: 'published',
  published_at: T0,
  caption: 'Seen caption',
  alt_text: 'Seen alt',
  locale: 'en-US',
  climate_band: 'temperate_dry',
  image_object_path: 'community/p1/img.jpg',
  moderation_reason: null,
  moderation_engine_version: null,
  anonymized_at: null,
  erasure_requested_at: null,
  comment_publication_sequence: 4,
  area_country: 'US',
  area_region: 'TX',
  area_city: 'Austin',
  ...overrides,
})

const postReport = (id: string, overrides: Row = {}): Row => ({
  id,
  post_id: 'p1',
  reporter_id: `reporter-${id}`,
  resolved_at: null,
  subject_alias: ALIAS,
  image_object_path: 'community/p1/img.jpg',
  content_snapshot: { caption: 'Seen caption' },
  created_at: new Date(T0.getTime() - 3_600_000),
  ...overrides,
})

const commentRow = (overrides: Row = {}): Row => ({
  id: 'c1',
  post_id: 'p1',
  parent_id: null,
  user_id: AUTHOR,
  status: 'held_for_review',
  platform: 'web',
  published_at: null,
  publication_sequence: null,
  screening_reason: 'text_policy_match',
  ...overrides,
})

const commentReport = (id: string, overrides: Row = {}): Row => ({
  id,
  comment_id: 'c1',
  reporter_id: null,
  resolved_at: null,
  accepted_at: new Date(T0.getTime() - 3_600_000),
  ...overrides,
})

interface Seed {
  post?: Row | null
  comment?: Row | null
  postReports?: Row[]
  commentReports?: Row[]
  decisions?: Row[]
  sanctions?: Row[]
  flags?: Record<string, boolean>
  clock?: Date[]
  profile?: Row | null
}

/** Reads the where clauses this story uses, and fails on one it was never taught. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((arm) => matches(row, arm))
    const value = row[key]
    if (condition === null || typeof condition !== 'object' || condition instanceof Date)
      return (value ?? null) === condition
    const filter = condition as {
      in?: unknown[]
      not?: unknown
      gt?: Date
      hasSome?: unknown[]
    }
    if (filter.in) return filter.in.includes(value)
    if ('not' in filter) return (value ?? null) !== filter.not
    if (filter.gt) return value instanceof Date && value > filter.gt
    if (filter.hasSome)
      return (value as unknown[]).some((item) => filter.hasSome!.includes(item))
    throw new Error(`The double has no filter for ${key}`)
  })
}

function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    const increment = (value as { increment?: number } | null)?.increment
    row[key] = increment === undefined ? value : (row[key] as number) + increment
  }
}

function knownError(code: string, meta: Record<string, unknown> = {}) {
  return new Prisma.PrismaClientKnownRequestError('database refused', {
    code,
    clientVersion: 'test',
    meta,
  })
}

function build(seed: Seed = {}) {
  const log: string[] = []
  const state = {
    post: seed.post === undefined ? postRow() : seed.post,
    comment: seed.comment ?? null,
    postReports: seed.postReports ?? [postReport('r1')],
    commentReports: seed.commentReports ?? [],
    decisions: seed.decisions ?? [],
    sanctions: seed.sanctions ?? [],
    events: [] as Row[],
    commentAudits: [] as Row[],
    audits: [] as Row[],
    analytics: [] as Row[],
    reactionWithdrawals: 0,
  }

  /** Throw from a named write to fail it. Each fault fires once unless it stays set. */
  const faults: Record<string, () => unknown> = {}
  const write = (name: string, apply: () => unknown) => {
    const fault = faults[name]
    if (fault) return Promise.reject(fault() as Error)
    return Promise.resolve(apply())
  }

  const rawLabel = (sql: string) => {
    if (sql.includes('moderation_case:')) return 'case lock'
    if (sql.includes('community_prepare_subject_privacy')) return 'subject guard'
    if (sql.includes('community_privacy_guards')) return 'post guard'
    if (sql.includes('community_member:')) return 'member lock'
    if (sql.includes('FOR UPDATE')) return 'post row lock'
    return 'raw sql'
  }
  const onPostRowLock: { run?: () => void } = {}
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray) => {
      log.push(rawLabel(strings.join('?')))
      return Promise.resolve(1)
    }),
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const label = rawLabel(strings.join('?'))
      log.push(label)
      if (label === 'post row lock') onPostRowLock.run?.()
      return Promise.resolve([{ id: 'locked' }])
    }),
    moderationDecision: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: {
            moderator_id_mutation_id: { moderator_id: string; mutation_id: string }
          }
        }) => {
          log.push('mutation read')
          const key = where.moderator_id_mutation_id
          return Promise.resolve(
            state.decisions.find(
              (row) =>
                row.moderator_id === key.moderator_id &&
                row.mutation_id === key.mutation_id
            ) ?? null
          )
        }
      ),
      findMany: vi.fn(({ where }: { where: Row }) => {
        log.push('history read')
        return Promise.resolve(state.decisions.filter((row) => matches(row, where)))
      }),
      create: vi.fn(({ data }: { data: Row }) =>
        write('decision', () => {
          log.push('decision insert')
          state.decisions.push(data)
          return data
        })
      ),
    },
    communitySanction: {
      findFirst: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(state.sanctions.find((row) => matches(row, where)) ?? null)
      ),
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(state.sanctions.filter((row) => matches(row, where)))
      ),
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        const rows = state.sanctions.filter((row) => matches(row, where))
        rows.forEach((row) => applyData(row, data))
        return Promise.resolve({ count: rows.length })
      }),
      create: vi.fn(({ data }: { data: Row }) => {
        const row = {
          lifted_at: null,
          appeal_status: 'not_requested',
          ...data,
        }
        state.sanctions.push(row)
        return Promise.resolve(row)
      }),
    },
    communityPostReport: {
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(state.postReports.filter((row) => matches(row, where)))
      ),
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        const rows = state.postReports.filter((row) => matches(row, where))
        rows.forEach((row) => applyData(row, data))
        return Promise.resolve({ count: rows.length })
      }),
    },
    communityCommentReport: {
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(state.commentReports.filter((row) => matches(row, where)))
      ),
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        const rows = state.commentReports.filter((row) => matches(row, where))
        rows.forEach((row) => applyData(row, data))
        return Promise.resolve({ count: rows.length })
      }),
    },
    lookbookPost: {
      findUnique: vi.fn(() => Promise.resolve(state.post)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(state.post)),
      update: vi.fn(({ data }: { data: Row }) =>
        write('postUpdate', () => {
          applyData(state.post!, data)
          return state.post
        })
      ),
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        if (!state.post || !matches(state.post, where))
          return Promise.resolve({ count: 0 })
        applyData(state.post, data)
        return Promise.resolve({ count: 1 })
      }),
    },
    communityComment: {
      findUnique: vi.fn(() => Promise.resolve(state.comment)),
      findFirst: vi.fn(() => Promise.resolve(state.comment)),
      update: vi.fn(({ data }: { data: Row }) => {
        applyData(state.comment!, data)
        return Promise.resolve(state.comment)
      }),
      updateMany: vi.fn(({ where, data }: { where: Row; data: Row }) => {
        if (!state.comment || !matches(state.comment, where))
          return Promise.resolve({ count: 0 })
        applyData(state.comment, data)
        return Promise.resolve({ count: 1 })
      }),
    },
    communityAlias: {
      findUnique: vi.fn(() => Promise.resolve({ alias: ALIAS })),
    },
    communityReaction: {
      updateMany: vi.fn(() => {
        state.reactionWithdrawals += 1
        return Promise.resolve({ count: 1 })
      }),
    },
    moderationEvent: {
      create: vi.fn(({ data }: { data: Row }) =>
        write('event', () => {
          state.events.push(data)
          return data
        })
      ),
      createMany: vi.fn(({ data }: { data: Row[] }) =>
        write('event', () => {
          state.events.push(...data)
          return { count: data.length }
        })
      ),
    },
    communityCommentAudit: {
      create: vi.fn(({ data }: { data: Row }) => {
        state.commentAudits.push(data)
        return Promise.resolve(data)
      }),
      createMany: vi.fn(({ data }: { data: Row[] }) => {
        state.commentAudits.push(...data)
        return Promise.resolve({ count: data.length })
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Row }) =>
        write('audit', () => {
          state.audits.push(data)
          return data
        })
      ),
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
    communityCommentAnalyticsSubject: {
      upsert: vi.fn(() => Promise.resolve({ actor: 'opaque-actor' })),
    },
    communityCommentAnalyticsOutbox: {
      create: vi.fn(({ data }: { data: Row }) => {
        state.analytics.push(data)
        return Promise.resolve(data)
      }),
    },
  }

  const transactionFaults: (() => unknown)[] = []
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = structuredClone(state)
      log.push('begin')
      try {
        const result = await work(tx)
        const fault = transactionFaults.shift()
        if (fault) throw fault() as Error
        log.push('commit')
        return result
      } catch (error) {
        log.push('rollback')
        Object.assign(state, snapshot)
        throw error
      }
    }),
  }

  const instants = [...(seed.clock ?? [T0])]
  const clock = vi.fn(() => {
    log.push('clock')
    return new Date(instants.length > 1 ? instants.shift()! : instants[0]!)
  })
  const flagValues: Record<string, boolean> = { ...seed.flags }
  const flags = {
    getFeatureFlag: vi.fn((key: string) => Promise.resolve(flagValues[key] ?? true)),
  }
  const step = (name: string) =>
    vi.fn((..._args: unknown[]) => {
      log.push(name)
      return Promise.resolve()
    })
  const spotlight = {
    invalidatePostAreas: step('bump post areas'),
    invalidateAllAreas: step('bump all areas'),
  }
  const streams = { assist: step('assist') }
  const sessions = { invalidateUserSessions: step('sessions') }

  const repository = new ModerationDecisionsRepository()
  const afterCommit = new ModerationAfterCommit(
    prisma as never,
    spotlight as never,
    streams as never,
    sessions as never
  )
  const sanctions = new ModerationSanctionsService(
    prisma as never,
    repository,
    afterCommit,
    clock
  )
  const operator = new CommunityModerationActionsService(prisma as never, flags as never)
  const service = new ModerationDecisionsService(
    prisma as never,
    repository,
    operator,
    sanctions,
    afterCommit,
    flags as never,
    clock
  )
  return {
    service,
    state,
    log,
    tx,
    clock,
    flags,
    faults,
    transactionFaults,
    onPostRowLock,
    spotlight,
    streams,
    sessions,
  }
}

const revision = (sequence = 0, openReportIds = ['r1'], targetStatus = 'published') =>
  computeModerationCaseRevision({ sequence, openReportIds, targetStatus })

function input(
  action: ModerationDecisionInput['action'],
  overrides: Partial<{
    reason: string
    mutationId: string
    expectedRevision: string
    ban: ModerationBanTerms
  }> = {}
): ModerationDecisionInput {
  return {
    action,
    reason: REASON,
    mutationId: randomUUID(),
    expectedRevision: revision(),
    ...(action === 'ban' ? { ban: { kind: 'temporary', durationDays: 7 } } : {}),
    ...overrides,
  } as ModerationDecisionInput
}

/** The row an earlier request left behind. */
function storedDecision(params: {
  caseId?: string
  decisionInput: ModerationDecisionInput
  moderatorId?: string
  payloadHash?: string
  sanction?: Row | null
}): Row {
  const caseId = params.caseId ?? 'post.p1'
  const { decisionInput } = params
  return {
    id: 'd-earlier',
    case_key: caseId,
    sequence: 1,
    source: 'post',
    post_id: 'p1',
    comment_id: null,
    report_ids: ['r1'],
    action: decisionInput.action,
    reason: decisionInput.reason,
    moderator_id: params.moderatorId ?? MOD.userId,
    moderator_role: 'moderator',
    subject_user_id: AUTHOR,
    subject_alias: ALIAS,
    mutation_id: decisionInput.mutationId,
    payload_hash:
      params.payloadHash ??
      computeDecisionPayloadHash({
        route: 'decision',
        caseId,
        action: decisionInput.action,
        reason: decisionInput.reason,
        ...(decisionInput.action === 'ban' ? { ban: decisionInput.ban } : {}),
      }),
    is_terminal: decisionInput.action !== 'escalate',
    decided_at: T0,
    response: {
      decisionId: 'd-earlier',
      caseId,
      action: decisionInput.action,
      decidedAt: T0.toISOString(),
      firstDecisionAt: T0.toISOString(),
      revision: revision(1, [], 'flagged'),
      caseStatus: 'resolved',
      escalated: false,
      targetStatus: 'flagged',
      sanction: params.sanction ?? null,
    },
  }
}

const refusal = async (attempt: Promise<unknown>) => {
  const failure: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error
  )
  if (!(failure instanceof HttpException))
    throw new Error(`Expected a refusal, got ${String(failure)}`)
  return failure.getResponse() as Record<string, unknown> & { code: string }
}

const activeSanction = (member: string, overrides: Row = {}): Row => ({
  id: `sanction-${member}`,
  user_id: member,
  decision_id: 'd-origin',
  case_key: 'post.other',
  kind: 'permanent',
  expires_at: null,
  lifted_at: null,
  appeal_status: 'not_requested',
  created_at: new Date(T0.getTime() - DAY_MS),
  ...overrides,
})

let logged: { level: string; args: unknown[] }[]
beforeEach(() => {
  logged = []
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const)
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logged.push({ level, args })
    })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('U-D-REVISION', () => {
  // sha256("0|r1,r2|published"), computed with `shasum -a 256` and not by the code under test.
  const GOLDEN = '9fedf28970effb17'
  const base = {
    sequence: 0,
    openReportIds: ['r1', 'r2'],
    targetStatus: 'published',
  }

  it('matches the golden example of the Design Notes, as 16 lowercase hex characters', () => {
    expect(computeModerationCaseRevision(base)).toBe(GOLDEN)
    expect(computeModerationCaseRevision(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('ignores report order', () => {
    expect(computeModerationCaseRevision({ ...base, openReportIds: ['r2', 'r1'] })).toBe(
      GOLDEN
    )
  })

  it.each([
    ['the sequence', { sequence: 1 }],
    ['the first report id', { openReportIds: ['r9', 'r2'] }],
    ['the second report id', { openReportIds: ['r1', 'r9'] }],
    ['a withdrawn report', { openReportIds: ['r1'] }],
    ['a new report', { openReportIds: ['r1', 'r2', 'r3'] }],
    ['the target status', { targetStatus: 'flagged' }],
    ['an erased target', { targetStatus: null }],
  ])('moves with %s', (_name, change) => {
    expect(computeModerationCaseRevision({ ...base, ...change })).not.toBe(GOLDEN)
  })
})

describe('U-D-SVC-PRECEDENCE: the TEA-08 refusal order', () => {
  const stale = 'ffffffffffffffff'

  it('replays ahead of an unknown case, a sanctioned operator, a conflict of interest and a stale revision', async () => {
    const earlier = input('takedown', { expectedRevision: stale })
    const { service, state, log } = build({
      post: postRow({ user_id: MOD.userId }),
      decisions: [storedDecision({ decisionInput: earlier, caseId: 'post.gone' })],
      sanctions: [activeSanction(MOD.userId)],
      postReports: [],
    })
    const result = await service.decide(MOD, 'post.gone', earlier)
    expect(result.data).toMatchObject({ decisionId: 'd-earlier', replayed: true })
    expect(state.decisions).toHaveLength(1)
    expect(log).toContain('commit')
  })

  it.each<{
    name: string
    seed: () => Seed
    auth: RequestAuthContext
    caseId?: string
    request: () => ModerationDecisionInput
    code: string
    detail?: string
  }>([
    {
      name: 'idempotency_mismatch ahead of case_not_found',
      seed: () => {
        const earlier = input('resolve')
        return {
          postReports: [],
          decisions: [
            {
              ...storedDecision({ decisionInput: earlier, payloadHash: 'other-hash' }),
              mutation_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        }
      },
      auth: MOD,
      request: () =>
        input('resolve', { mutationId: '11111111-1111-4111-8111-111111111111' }),
      code: 'idempotency_mismatch',
    },
    {
      name: 'idempotency_mismatch ahead of operator_sanctioned',
      seed: () => ({
        sanctions: [activeSanction(MOD.userId)],
        decisions: [
          {
            ...storedDecision({
              decisionInput: input('resolve'),
              payloadHash: 'other-hash',
            }),
            mutation_id: '22222222-2222-4222-8222-222222222222',
          },
        ],
      }),
      auth: MOD,
      request: () =>
        input('resolve', { mutationId: '22222222-2222-4222-8222-222222222222' }),
      code: 'idempotency_mismatch',
    },
    {
      name: 'case_not_found ahead of operator_sanctioned',
      seed: () => ({ postReports: [], sanctions: [activeSanction(MOD.userId)] }),
      auth: MOD,
      request: () => input('resolve'),
      code: 'case_not_found',
    },
    {
      name: 'case_not_found for a malformed id, ahead of operator_sanctioned',
      seed: () => ({ sanctions: [activeSanction(MOD.userId)] }),
      auth: MOD,
      caseId: 'not-a-case',
      request: () => input('resolve'),
      code: 'case_not_found',
    },
    {
      name: 'operator_sanctioned ahead of self_review_refused',
      seed: () => ({
        post: postRow({ user_id: MOD.userId }),
        sanctions: [activeSanction(MOD.userId)],
      }),
      auth: MOD,
      request: () => input('resolve'),
      code: 'operator_sanctioned',
    },
    {
      name: 'self_review_refused ahead of admin_required for an author',
      seed: () => ({ post: postRow({ user_id: MOD.userId }) }),
      auth: MOD,
      request: () => input('ban', { ban: { kind: 'permanent' } }),
      code: 'self_review_refused',
    },
    {
      name: 'self_review_refused for an admin who filed a report',
      seed: () => ({
        postReports: [postReport('r1', { reporter_id: ADMIN.userId })],
      }),
      auth: ADMIN,
      request: () => input('takedown'),
      code: 'self_review_refused',
    },
    {
      name: 'admin_required ahead of case_conflict',
      seed: () => ({}),
      auth: MOD,
      request: () =>
        input('ban', { ban: { kind: 'permanent' }, expectedRevision: stale }),
      code: 'admin_required',
    },
    {
      name: 'admin_required for a moderator permanent ban on an unavailable case',
      seed: () => ({
        post: null,
        postReports: [postReport('r1', { post_id: null })],
      }),
      auth: MOD,
      caseId: 'orphan-post.r1',
      request: () =>
        input('ban', {
          ban: { kind: 'permanent' },
          expectedRevision: computeModerationCaseRevision({
            sequence: 0,
            openReportIds: ['r1'],
            targetStatus: null,
          }),
        }),
      code: 'admin_required',
    },
    {
      name: 'admin_required for a moderator terminal action on an escalated case, ahead of case_conflict',
      seed: () => ({
        decisions: [
          {
            ...storedDecision({ decisionInput: input('escalate') }),
            action: 'escalate',
            is_terminal: false,
          },
        ],
      }),
      auth: MOD,
      request: () => input('resolve', { expectedRevision: stale }),
      code: 'admin_required',
    },
    {
      name: 'case_conflict ahead of action_not_applicable',
      seed: () => ({ post: postRow({ status: 'flagged' }) }),
      auth: MOD,
      request: () => input('takedown', { expectedRevision: stale }),
      code: 'case_conflict',
    },
    {
      name: 'action_not_applicable only with a current revision',
      seed: () => ({ post: postRow({ status: 'flagged' }) }),
      auth: MOD,
      request: () =>
        input('takedown', { expectedRevision: revision(0, ['r1'], 'flagged') }),
      code: 'action_not_applicable',
      detail: 'target_not_published',
    },
  ])('answers $name and writes nothing', async (row) => {
    const seed = row.seed()
    const before = seed.decisions?.length ?? 0
    const { service, state, log } = build(seed)
    const body = await refusal(
      service.decide(row.auth, row.caseId ?? 'post.p1', row.request())
    )
    expect(body.code).toBe(row.code)
    // A row with no detail expects `undefined`, so a stray detail fails too.
    expect(body.detail).toBe(row.detail)
    expect(state.decisions).toHaveLength(before)
    expect(state.audits).toEqual([])
    expect(state.events).toEqual([])
    expect(log).toContain('rollback')
    expect(log).not.toContain('commit')
  })

  it('returns currentRevision on case_conflict', async () => {
    const { service } = build()
    const body = await refusal(
      service.decide(MOD, 'post.p1', input('resolve', { expectedRevision: stale }))
    )
    expect(body).toMatchObject({ code: 'case_conflict', currentRevision: revision() })
  })

  it('takes the locks in the TEA-01 order and reads the revision only after the post row lock', async () => {
    const { service, log } = build()
    await service.decide(MOD, 'post.p1', input('takedown'))
    const position = (label: string) => log.indexOf(label)
    const order = [
      'case lock',
      'mutation read',
      'post guard',
      'member lock',
      'post row lock',
      'history read',
    ]
    expect(order.map(position)).toEqual(
      order.map(position).sort((left, right) => left - right)
    )
    expect(order.map(position)).not.toContain(-1)
  })

  it('takes the subject guard for a ban in place of the post guard', async () => {
    const { service, log } = build()
    await service.decide(MOD, 'post.p1', input('ban'))
    expect(log).toContain('subject guard')
    expect(log).not.toContain('post guard')
    expect(log.indexOf('case lock')).toBeLessThan(log.indexOf('subject guard'))
    expect(log.indexOf('subject guard')).toBeLessThan(log.indexOf('post row lock'))
  })

  it('refuses a report that landed while the post row lock waited, so nobody stamps it unseen', async () => {
    const { service, state, onPostRowLock } = build()
    onPostRowLock.run = () => state.postReports.push(postReport('r-late'))
    const body = await refusal(service.decide(MOD, 'post.p1', input('resolve')))
    expect(body).toMatchObject({
      code: 'case_conflict',
      currentRevision: revision(0, ['r1', 'r-late']),
    })
    expect(state.decisions).toEqual([])
  })
})

describe('U-D-SVC-HASH: what the same payload means (TEA-12)', () => {
  const decision: DecisionPayload = {
    route: 'decision',
    caseId: 'post.p1',
    action: 'ban',
    reason: 'A real reason',
    ban: { kind: 'temporary', durationDays: 7 },
  }
  const hash = computeDecisionPayloadHash(decision)

  it('ignores surrounding whitespace in the reason and the order of keys', () => {
    expect(computeDecisionPayloadHash({ ...decision, reason: '  A real reason\n' })).toBe(
      hash
    )
    expect(
      computeDecisionPayloadHash({
        ban: { durationDays: 7, kind: 'temporary' },
        reason: 'A real reason',
        action: 'ban',
        caseId: 'post.p1',
        route: 'decision',
      })
    ).toBe(hash)
  })

  it.each<[string, DecisionPayload]>([
    ['the action', { ...decision, action: 'takedown', ban: undefined }],
    ['the reason', { ...decision, reason: 'Another reason' }],
    ['the ban duration', { ...decision, ban: { kind: 'temporary', durationDays: 30 } }],
    ['the ban kind', { ...decision, ban: { kind: 'permanent' } }],
    ['the case id', { ...decision, caseId: 'post.p2' }],
  ])('changes with %s', (_name, changed) => {
    expect(computeDecisionPayloadHash(changed)).not.toBe(hash)
  })

  it('separates the two routes for the same words', () => {
    expect(
      computeDecisionPayloadHash({
        route: 'appeal',
        sanctionId: 'post.p1',
        status: 'ban',
        reason: 'A real reason',
      })
    ).not.toBe(hash)
  })

  it('stores a hash that leaves expectedRevision out, so a reload still replays', async () => {
    const mutationId = randomUUID()
    const first = build()
    await first.service.decide(
      MOD,
      'post.p1',
      input('resolve', { mutationId, reason: `  ${REASON}  ` })
    )
    const row = first.state.decisions[0]!
    expect(row.payload_hash).toBe(
      computeDecisionPayloadHash({
        route: 'decision',
        caseId: 'post.p1',
        action: 'resolve',
        reason: REASON,
      })
    )

    // The retry carries the revision the client read after the reload, so it no longer matches.
    const retry = await first.service.decide(
      MOD,
      'post.p1',
      input('resolve', { mutationId, expectedRevision: 'eeeeeeeeeeeeeeee' })
    )
    expect(retry.data.replayed).toBe(true)
    expect(first.state.decisions).toHaveLength(1)
  })
})

describe('U-D-SVC-CLOCK', () => {
  it('reads the clock once, after the case and post row locks', async () => {
    const { service, clock, log } = build()
    await service.decide(MOD, 'post.p1', input('takedown'))
    expect(clock).toHaveBeenCalledTimes(1)
    expect(log.indexOf('clock')).toBeGreaterThan(log.indexOf('case lock'))
    expect(log.indexOf('clock')).toBeGreaterThan(log.indexOf('post row lock'))
  })

  it('stamps every report and event of a resolve with the one instant', async () => {
    const { service, state } = build({
      postReports: [postReport('r1'), postReport('r2'), postReport('r3')],
    })
    const result = await service.decide(
      MOD,
      'post.p1',
      input('resolve', { expectedRevision: revision(0, ['r1', 'r2', 'r3']) })
    )
    expect(result.data.decidedAt).toBe(T0.toISOString())
    expect(state.decisions[0]!.decided_at).toEqual(T0)
    expect(state.postReports.map((row) => row.resolved_at)).toEqual([T0, T0, T0])
    expect(state.events.map((row) => row.created_at)).toEqual([T0, T0, T0])
  })

  it('keeps a stamped resolved_at where it is', async () => {
    const earlier = new Date(T0.getTime() - DAY_MS)
    const { service, state } = build({
      postReports: [postReport('r1', { resolved_at: earlier }), postReport('r2')],
    })
    await service.decide(
      MOD,
      'post.p1',
      input('resolve', { expectedRevision: revision(0, ['r2']) })
    )
    expect(state.postReports.map((row) => row.resolved_at)).toEqual([earlier, T0])
    expect(state.events).toHaveLength(1)
  })

  it.each([
    [1, 1],
    [7, 7],
    [30, 30],
    [90, 90],
  ] as const)(
    'makes a %i-day ban expire exactly that many days from the instant',
    async (durationDays, days) => {
      const { service, state } = build()
      const result = await service.decide(
        MOD,
        'post.p1',
        input('ban', { ban: { kind: 'temporary', durationDays } })
      )
      const expected = new Date(T0.getTime() + days * DAY_MS)
      expect(state.sanctions[0]).toMatchObject({
        kind: 'temporary',
        expires_at: expected,
        created_at: T0,
      })
      expect(result.data.sanction?.expiresAt).toBe(expected.toISOString())
      expect(state.events.map((row) => row.created_at)).toEqual(
        state.events.map(() => T0)
      )
      expect(state.events.length).toBeGreaterThan(0)
    }
  )

  it('stamps comment audit rows with the instant', async () => {
    const { service, state } = build({
      post: postRow(),
      comment: commentRow({ status: 'published', publication_sequence: 2 }),
      postReports: [],
      commentReports: [commentReport('r1')],
    })
    await service.decide(MOD, 'comment.c1', input('takedown'))
    expect(state.commentAudits.map((row) => row.occurred_at)).toEqual([T0, T0])
    expect(state.commentReports[0]!.resolved_at).toEqual(T0)
    expect(state.decisions[0]!.decided_at).toEqual(T0)
  })

  it('reads the clock again when a serialization failure retries the transaction', async () => {
    const { service, state, clock, transactionFaults } = build({ clock: [T0, T1] })
    transactionFaults.push(() => knownError('P2034'))
    const result = await service.decide(MOD, 'post.p1', input('resolve'))
    expect(clock).toHaveBeenCalledTimes(2)
    expect(result.data.decidedAt).toBe(T1.toISOString())
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]!.decided_at).toEqual(T1)
    expect(state.postReports[0]!.resolved_at).toEqual(T1)
  })
})

describe('U-D-SVC-LOGGING', () => {
  const forbidden = [
    REASON,
    'HOSTILE',
    'community_ban:',
    AUTHOR,
    ALIAS,
    MOD.userId,
    ADMIN.userId,
    SIGNED,
    'https://',
    'community/p1/img.jpg',
  ]
  const expectClean = (text: string) => {
    for (const secret of forbidden) expect(text).not.toContain(secret)
  }

  it.each<[string, () => Seed, ModerationDecisionInput['action'], string?]>([
    ['resolve', () => ({}), 'resolve'],
    ['takedown', () => ({}), 'takedown'],
    ['escalate', () => ({}), 'escalate'],
    ['ban', () => ({}), 'ban'],
    ['release of a post', () => ({ post: postRow({ status: 'flagged' }) }), 'release'],
    [
      'release of a comment',
      () => ({
        comment: commentRow({ user_id: 'author-subject-1' }),
        post: postRow(),
        postReports: [],
        commentReports: [commentReport('r1')],
      }),
      'release',
      'comment.c1',
    ],
  ])('keeps %s out of logs and analytics', async (name, seed, action, caseId) => {
    const built = build(seed())
    const expectedRevision = name.startsWith('release')
      ? revision(0, ['r1'], caseId ? 'held_for_review' : 'flagged')
      : revision()
    await built.service.decide(
      MOD,
      caseId ?? 'post.p1',
      input(action, { expectedRevision })
    )
    expect(logged.length).toBeGreaterThan(0)
    expectClean(JSON.stringify(logged))
    expectClean(JSON.stringify(built.state.analytics))
    expect(JSON.stringify(logged)).toContain('moderation_decision_applied')
  })

  it('logs a closed record of a decision with a hashed moderator', async () => {
    await build().service.decide(MOD, 'post.p1', input('resolve'))
    const entry = logged.find(({ args }) =>
      JSON.stringify(args).includes('moderation_decision_applied')
    )
    const record = entry!.args[0] as Record<string, unknown>
    expect(Object.keys(record).sort()).toEqual([
      'action',
      'decisionId',
      'event',
      'moderator',
      'role',
    ])
    expect(record.moderator).toMatch(/^[0-9a-f]{12}$/)
  })

  it.each<[string, () => Seed, () => ModerationDecisionInput]>([
    [
      'a conflict',
      () => ({}),
      () => input('resolve', { expectedRevision: 'f'.repeat(16) }),
    ],
    [
      'a not applicable action',
      () => ({ post: postRow({ status: 'flagged' }) }),
      () => input('takedown', { expectedRevision: revision(0, ['r1'], 'flagged') }),
    ],
    [
      'a sanctioned operator',
      () => ({ sanctions: [activeSanction(MOD.userId)] }),
      () => input('resolve'),
    ],
  ])('leaves no reason in the body or logs of %s', async (_name, seed, request) => {
    const body = await refusal(build(seed()).service.decide(MOD, 'post.p1', request()))
    expectClean(JSON.stringify(body))
    expectClean(JSON.stringify(logged))
  })

  it('writes the audit row from an allowlist, with no subject, alias or reason', async () => {
    const { service, state } = build()
    const result = await service.decide(MOD, 'post.p1', input('ban'))
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toEqual({
      user_id: MOD.userId,
      event_type: 'moderation_decision_applied',
      event_data: {
        decisionId: result.data.decisionId,
        caseId: 'post.p1',
        action: 'ban',
        role: 'moderator',
        banKind: 'temporary',
      },
    })
  })

  it('logs a Redis failure as one closed-code line, with none of the error text', async () => {
    const { service, spotlight } = build()
    spotlight.invalidatePostAreas.mockRejectedValue(
      new Error(`redis://10.0.0.9:6379 refused for ${AUTHOR}`)
    )
    await service.decide(MOD, 'post.p1', input('takedown'))
    const warnings = logged.filter(({ level }) => level === 'warn')
    expect(warnings).toEqual([
      {
        level: 'warn',
        args: [{ event: 'moderation_cache_invalidation_deferred' }],
      },
    ])
    expectClean(JSON.stringify(logged))
    expect(JSON.stringify(logged)).not.toContain('10.0.0.9')
  })
})

describe('U-D-SVC-STORED-RESPONSE', () => {
  const walkKeys = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(walkKeys)
    if (value && typeof value === 'object')
      return Object.entries(value).flatMap(([key, nested]) => [key, ...walkKeys(nested)])
    return []
  }

  it.each(['resolve', 'takedown', 'escalate', 'ban'] as const)(
    'stores a %s response with no reason, signed URL, cacheInvalidation or replayed flag',
    async (action) => {
      const { service, state } = build()
      await service.decide(MOD, 'post.p1', input(action))
      const stored = state.decisions[0]!.response
      const text = JSON.stringify(stored)
      expect(text).not.toContain(REASON)
      expect(text).not.toContain('https://')
      expect(text).not.toContain(AUTHOR)
      expect(walkKeys(stored)).not.toContain('reason')
      expect(walkKeys(stored)).not.toContain('cacheInvalidation')
      expect(walkKeys(stored)).not.toContain('replayed')
      expect(moderationStoredDecisionResultSchema.safeParse(stored).success).toBe(true)
    }
  )

  it('answers a replay with the stored JSON, replayed true and a cacheInvalidation of its own', async () => {
    const { service, state, spotlight } = build()
    const request = input('takedown')
    const first = await service.decide(MOD, 'post.p1', request)
    expect(first.data).toMatchObject({
      replayed: false,
      cacheInvalidation: 'completed',
    })

    spotlight.invalidatePostAreas.mockRejectedValueOnce(new Error('redis down'))
    const replay = await service.decide(MOD, 'post.p1', request)
    expect(replay.data).toEqual({
      ...(state.decisions[0]!.response as object),
      replayed: true,
      cacheInvalidation: 'deferred',
    })
    expect(state.decisions).toHaveLength(1)
    expect(state.audits).toHaveLength(1)
  })

  it('answers the same id with a changed reason as idempotency_mismatch and writes nothing', async () => {
    const { service, state } = build()
    const request = input('resolve')
    await service.decide(MOD, 'post.p1', request)
    const body = await refusal(
      service.decide(MOD, 'post.p1', { ...request, reason: 'A different reason' })
    )
    expect(body.code).toBe('idempotency_mismatch')
    expect(state.decisions).toHaveLength(1)
  })

  it('scopes a mutation id per moderator', async () => {
    const { service, state } = build()
    const request = input('escalate')
    await service.decide(MOD, 'post.p1', request)
    const other: RequestAuthContext = { ...ADMIN }
    const second = await service.decide(other, 'post.p1', {
      ...request,
      action: 'resolve',
      expectedRevision: revision(1),
    })
    expect(second.data.replayed).toBe(false)
    expect(state.decisions).toHaveLength(2)
  })
})

describe('U-D-SVC-POSTCOMMIT', () => {
  const afterCommitSteps = ['bump post areas', 'bump all areas', 'assist', 'sessions']

  const stepsOf = (log: string[]) =>
    log.filter((entry) => afterCommitSteps.includes(entry))

  it('runs every step after the commit and none inside the transaction', async () => {
    const { service, log, sessions } = build()
    await service.decide(MOD, 'post.p1', input('ban'))
    const commit = log.indexOf('commit')
    expect(commit).toBeGreaterThan(-1)
    expect(stepsOf(log).sort()).toEqual(['assist', 'bump post areas', 'sessions'].sort())
    for (const step of stepsOf(log)) expect(log.indexOf(step)).toBeGreaterThan(commit)
    expect(sessions.invalidateUserSessions).toHaveBeenCalledWith(AUTHOR)
  })

  it('runs the steps again on a replay, which repairs a crash after commit, and writes nothing', async () => {
    const { service, state, log } = build()
    const request = input('ban')
    await service.decide(MOD, 'post.p1', request)
    log.length = 0
    const replay = await service.decide(MOD, 'post.p1', request)
    expect(replay.data).toMatchObject({
      replayed: true,
      cacheInvalidation: 'completed',
    })
    expect(stepsOf(log).sort()).toEqual(['assist', 'bump post areas', 'sessions'].sort())
    expect(log).not.toContain('decision insert')
    expect(state.decisions).toHaveLength(1)
  })

  it.each(['resolve', 'escalate'] as const)(
    'skips the bump for %s and reports completed (TEA-21)',
    async (action) => {
      const { service, log } = build()
      const result = await service.decide(MOD, 'post.p1', input(action))
      expect(result.data.cacheInvalidation).toBe('completed')
      expect(stepsOf(log)).toEqual([])
    }
  )

  it('bumps the post areas on a release and a takedown, with the stored area', async () => {
    const released = build({ post: postRow({ status: 'flagged' }) })
    await released.service.decide(
      MOD,
      'post.p1',
      input('release', { expectedRevision: revision(0, ['r1'], 'flagged') })
    )
    expect(stepsOf(released.log).sort()).toEqual(['assist', 'bump post areas'])

    const takenDown = build()
    await takenDown.service.decide(MOD, 'post.p1', input('takedown'))
    expect(takenDown.spotlight.invalidatePostAreas).toHaveBeenCalledTimes(1)
    expect(takenDown.sessions.invalidateUserSessions).not.toHaveBeenCalled()
  })

  it('bumps the spotlight epoch on a permanent ban', async () => {
    const { service, spotlight, log } = build()
    await service.decide(ADMIN, 'post.p1', input('ban', { ban: { kind: 'permanent' } }))
    expect(spotlight.invalidateAllAreas).toHaveBeenCalledTimes(1)
    expect(spotlight.invalidatePostAreas).not.toHaveBeenCalled()
    expect(log.indexOf('bump all areas')).toBeGreaterThan(log.indexOf('commit'))
  })

  it.each<[string, 'spotlight' | 'assist' | 'sessions']>([
    ['the spotlight bump', 'spotlight'],
    ['the stream assist', 'assist'],
    ['the session step', 'sessions'],
  ])(
    'reports deferred when %s throws, and the decision stands',
    async (_name, failing) => {
      const built = build()
      const failure = new Error('step failed')
      if (failing === 'spotlight')
        built.spotlight.invalidatePostAreas.mockRejectedValue(failure)
      if (failing === 'assist') built.streams.assist.mockRejectedValue(failure)
      if (failing === 'sessions')
        built.sessions.invalidateUserSessions.mockRejectedValue(failure)
      const result = await built.service.decide(MOD, 'post.p1', input('ban'))
      expect(result.data).toMatchObject({
        replayed: false,
        cacheInvalidation: 'deferred',
      })
      expect(built.state.decisions).toHaveLength(1)
      expect(built.state.sanctions).toHaveLength(1)
    }
  )

  it('bounds a hanging step and answers deferred once the bound passes', async () => {
    const built = build()
    const hang = new Promise<void>(() => undefined)
    built.spotlight.invalidatePostAreas.mockReturnValue(hang)
    built.streams.assist.mockReturnValue(hang)
    built.sessions.invalidateUserSessions.mockReturnValue(hang)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let settled = false
    const pending = built.service.decide(MOD, 'post.p1', input('ban')).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(MODERATION_AFTER_COMMIT_BOUND_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.data.cacheInvalidation).toBe('deferred')
    expect(built.state.decisions).toHaveLength(1)
  })

  it('bumps every area when the post left before the after-commit read', async () => {
    const built = build()
    built.tx.lookbookPost.findUnique.mockImplementation(() =>
      Promise.resolve(built.log.includes('commit') ? null : built.state.post)
    )
    const result = await built.service.decide(MOD, 'post.p1', input('takedown'))
    expect(built.spotlight.invalidateAllAreas).toHaveBeenCalledTimes(1)
    expect(result.data.cacheInvalidation).toBe('completed')
  })
})

describe('U-D-SVC-ERRORMAP', () => {
  it('maps a sequence collision to case_conflict with the current revision', async () => {
    const { service, faults, state } = build()
    faults.decision = () => knownError('P2002', { target: ['case_key', 'sequence'] })
    const body = await refusal(service.decide(MOD, 'post.p1', input('takedown')))
    expect(body).toEqual({
      statusCode: 409,
      code: 'case_conflict',
      message: expect.any(String) as string,
      currentRevision: revision(),
    })
    // The whole decision rolled back with the failed insert.
    expect(state.post!.status).toBe('published')
    expect(state.postReports[0]!.resolved_at).toBeNull()
  })

  it('re-reads a mutation key collision in a new read and replays the winning row', async () => {
    const request = input('resolve', { expectedRevision: revision(1) })
    const { service, tx, faults } = build({
      decisions: [storedDecision({ decisionInput: request })],
    })
    // The transaction read before the winner committed, then lost on the unique key.
    tx.moderationDecision.findUnique.mockImplementationOnce(() => Promise.resolve(null))
    faults.decision = () =>
      knownError('P2002', { target: ['moderator_id', 'mutation_id'] })
    const result = await service.decide(MOD, 'post.p1', request)
    expect(result.data).toMatchObject({ decisionId: 'd-earlier', replayed: true })
    expect(tx.moderationDecision.findUnique).toHaveBeenCalledTimes(2)
  })

  it('answers a mutation key collision with a different payload as idempotency_mismatch', async () => {
    const request = input('resolve', { expectedRevision: revision(1) })
    const { service, tx, faults } = build({
      decisions: [
        storedDecision({ decisionInput: request, payloadHash: 'winner-other-payload' }),
      ],
    })
    tx.moderationDecision.findUnique.mockImplementationOnce(() => Promise.resolve(null))
    faults.decision = () =>
      knownError('P2002', { target: ['moderator_id', 'mutation_id'] })
    const body = await refusal(service.decide(MOD, 'post.p1', request))
    expect(body.code).toBe('idempotency_mismatch')
  })

  it.each<[string, string, () => unknown]>([
    [
      'a moderator with no User row on the decision insert',
      'decision',
      () => knownError('P2003', { field_name: 'ModerationDecision_moderator_id_fkey' }),
    ],
    [
      'a moderator with no User row on the audit insert',
      'audit',
      () => knownError('P2003', { field_name: 'AuditLog_user_id_fkey' }),
    ],
    ['an audit insert that errors', 'audit', () => new Error('audit table locked')],
    [
      'a moderator with no User row on the event insert',
      'event',
      () => knownError('P2003', { field_name: 'ModerationEvent_reviewed_by_id_fkey' }),
    ],
  ])(
    'maps %s to 503 audit_unavailable with a full rollback',
    async (_name, fault, make) => {
      const { service, faults, state, log } = build()
      faults[fault] = make
      const body = await refusal(service.decide(MOD, 'post.p1', input('takedown')))
      expect(body).toEqual({
        statusCode: 503,
        code: 'audit_unavailable',
        message: expect.any(String) as string,
      })
      expect(JSON.stringify(body)).not.toMatch(/fkey|locked|HOSTILE/)
      expect(log).toContain('rollback')
      expect(state.post!.status).toBe('published')
      expect(state.postReports[0]!.resolved_at).toBeNull()
      expect(state.decisions).toEqual([])
      expect(state.audits).toEqual([])
    }
  )

  it('leaves an unknown database error unmapped, which the framework answers as a generic 500', async () => {
    const { service, faults } = build()
    const failure = new Error('connection terminated unexpectedly')
    faults.postUpdate = () => failure
    const thrown: unknown = await service
      .decide(MOD, 'post.p1', input('takedown'))
      .catch((error: unknown) => error)
    expect(thrown).toBe(failure)
    expect(thrown).not.toBeInstanceOf(HttpException)
    expect(String(thrown)).not.toContain(REASON)
  })
})

describe('TEA-11: the detail read of a decision state', () => {
  it('offers nothing and still answers when the decisions flag read fails', async () => {
    const { service, flags } = build()
    flags.getFeatureFlag.mockImplementation(() =>
      Promise.reject(new Error('posthog down'))
    )
    const state = await service.describeCase(MOD, 'post.p1')
    expect(state).toMatchObject({
      revision: revision(),
      allowedActions: [],
      banKinds: [],
    })
  })

  it('offers the actions the decision path would allow when the flags are on', async () => {
    const { service } = build()
    const state = await service.describeCase(MOD, 'post.p1')
    expect(state.allowedActions).toEqual(['resolve', 'takedown', 'escalate', 'ban'])
    expect(state.banKinds).toEqual(['temporary'])
  })
})

const apiSourceRoot = join(__dirname, '../..')

function productionSources(): { path: string; text: string }[] {
  return readdirSync(apiSourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'))
    .map((path) => ({
      path,
      text: readFileSync(join(apiSourceRoot, path), 'utf8'),
    }))
}

describe('U-D-SVC-INSERT-ONLY', () => {
  const sources = productionSources()

  it('finds the insert, so the scan below reads the right files', () => {
    const inserts = sources.filter(({ text }) =>
      /\.moderationDecision\s*\.\s*create\b/.test(text)
    )
    expect(inserts.map(({ path }) => path)).toEqual([
      join('modules', 'moderation', 'moderation-decisions.repository.ts'),
    ])
  })

  it('has no update or delete of a decision row, through Prisma or raw SQL', () => {
    const offenders = sources
      .filter(({ text }) => {
        const delegate =
          /\.moderationDecision\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(
            text
          )
        const raw =
          /UPDATE\s+"ModerationDecision"|DELETE\s+FROM\s+"ModerationDecision"|TRUNCATE\s+"ModerationDecision"/i.test(
            text
          )
        return delegate || raw
      })
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })
})

describe('U-D-READSET', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8')
  const files = [
    'moderation-decisions.repository.ts',
    'moderation-decisions.service.ts',
    'moderation-sanctions.service.ts',
  ]

  it('lists both new tables for the RLS suite', () => {
    expect(MODERATION_QUEUE_READ_TABLES).toContain('ModerationDecision')
    expect(MODERATION_QUEUE_READ_TABLES).toContain('CommunitySanction')
  })

  it('names only listed tables in raw SQL', () => {
    const named = files.flatMap((file) =>
      [...read(file).matchAll(/(?:FROM|JOIN|UPDATE|INTO)\s+"([A-Za-z]+)"/g)].map(
        (match) => match[1]!
      )
    )
    expect(named).toContain('CommunitySanction')
    for (const table of named)
      expect(MODERATION_QUEUE_READ_TABLES, `raw SQL names ${table}`).toContain(table)
  })

  it('reads only listed tables through Prisma delegates', () => {
    const delegates = files.flatMap((file) =>
      [
        ...read(file).matchAll(
          /\b(?:tx|prisma)\.([a-zA-Z]+)\.(?:find[A-Za-z]*|count|aggregate|groupBy)\b/g
        ),
      ].map((match) => match[1]!)
    )
    expect(delegates).toContain('moderationDecision')
    for (const delegate of new Set(delegates)) {
      const table = delegate.charAt(0).toUpperCase() + delegate.slice(1)
      expect(MODERATION_QUEUE_READ_TABLES, `delegate ${delegate}`).toContain(table)
    }
  })
})
