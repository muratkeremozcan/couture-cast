// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-WEB-Q-CLIENT. Transport, server-clock offset and closed failure states.
// Story 6.11 test owner: U-WEB-D-CLIENT and U-WEB-D-NO-DIRECT. Decision and appeal transport, closed failures and the id keeper.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { HttpResponse, http, type JsonBodyType } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  moderationDecisionDetailSchema,
  moderationDecisionErrorCodeSchema,
  type ModerationAppealInput,
  type ModerationDecisionErrorCode,
  type ModerationDecisionInput,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_BANNED_MESSAGE,
  COMMUNITY_COMMENT_SELF_REPORT_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityBannedError,
} from '@couture/api-client/contracts/http'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  MODERATION_FAILURE_REASONS,
  RETRYABLE_DECISION_FAILURES,
  applyModerationDecisionFromWeb,
  createMutationIdKeeper,
  getModerationCaseFromWeb,
  isTerminalFailure,
  listModerationCasesFromWeb,
  moderationDecisionFailure,
  moderationFailureReason,
  recordModerationAppealFromWeb,
  type ModerationDecisionFailure,
  type ModerationRequestError,
  remainingMs,
} from './moderation'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  APPEAL_PATH,
  DECISION_PATH,
  DETAIL_PATH,
  MODERATOR_TOKEN,
  QUEUE_PATH,
  REVISION,
  SERVER_NOW,
  appealBody,
  decisionBody,
  detail,
  detailHandler,
  errorBody,
  json,
  mutationHandler,
  page,
  queueHandler,
  signIn,
  summary,
  type RecordedQuery,
} from '../test-utils/moderation-console'
import {
  communityCommentsRepliesFromWeb,
  communityCommentsRootsFromWeb,
  communityCommentsSubmissionsFromWeb,
  communityFailureReason,
  communitySanctionOf,
  getCommunityFeedFromWeb,
  getCommunityPostFromWeb,
  getCommunitySpotlightFromWeb,
  isCommunityPostVisibleFromWeb,
  openCommunityPostFromWeb,
  openCommunitySpotlightPostFromWeb,
  reportCommunityPostFromWeb,
  setCommunityReactionFromWeb,
} from './community'

beforeEach(() => signIn())
afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

const failureOf = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    return error as ModerationRequestError
  }
  throw new Error('expected the request to fail')
}
const list = () => listModerationCasesFromWeb({ filters: { status: 'open' } })

describe('U-WEB-Q-CLIENT: the bearer', () => {
  it('sends the session bearer on both routes', async () => {
    const headers: (string | null)[] = []
    useMswHandlers(
      http.get(QUEUE_PATH, ({ request }) => {
        headers.push(request.headers.get('authorization'))
        return json(page([summary()]))
      }),
      http.get(DETAIL_PATH, ({ request }) => {
        headers.push(request.headers.get('authorization'))
        return json({ data: detail() })
      })
    )
    await list()
    await getModerationCaseFromWeb('post.p1')
    expect(headers).toEqual([`Bearer ${MODERATOR_TOKEN}`, `Bearer ${MODERATOR_TOKEN}`])
  })

  it('fails as signed_out without any request when no session token exists', async () => {
    const seen: RecordedQuery[] = []
    const reads: string[] = []
    useMswHandlers(
      queueHandler(() => json(page([])), seen),
      detailHandler(() => json({ data: detail() }), reads)
    )
    signIn(null)
    expect((await failureOf(list)).reason).toBe('signed_out')
    expect((await failureOf(() => getModerationCaseFromWeb('post.p1'))).reason).toBe(
      'signed_out'
    )
    expect(seen).toHaveLength(0)
    expect(reads).toHaveLength(0)
    expect(window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
  })
})

describe('U-WEB-Q-CLIENT: the query string', () => {
  it('sends status always, other filters only when chosen, and the cursor verbatim', async () => {
    const seen: RecordedQuery[] = []
    useMswHandlers(queueHandler(() => json(page([])), seen))
    await listModerationCasesFromWeb({ filters: { status: 'open' } })
    await listModerationCasesFromWeb({
      filters: {
        status: 'resolved',
        source: 'comment',
        locale: 'es-419',
        risk: 'high',
        sla: 'at_risk',
      },
      cursor: 'abc.def-_ghi',
      limit: 10,
    })
    expect(seen[0]).toEqual({ status: 'open' })
    expect(seen[1]).toEqual({
      status: 'resolved',
      source: 'comment',
      locale: 'es-419',
      risk: 'high',
      sla: 'at_risk',
      cursor: 'abc.def-_ghi',
      limit: '10',
    })
  })

  it('issues exactly one request per call', async () => {
    const seen: RecordedQuery[] = []
    const reads: string[] = []
    useMswHandlers(
      queueHandler(() => json(page([summary()])), seen),
      detailHandler(() => json({ data: detail() }), reads)
    )
    await list()
    await getModerationCaseFromWeb('post.p1')
    expect(seen).toHaveLength(1)
    expect(reads).toEqual(['post.p1'])
  })

  it('encodes a case id with a dot into one path segment', async () => {
    const reads: string[] = []
    useMswHandlers(detailHandler(() => json({ data: detail() }), reads))
    await getModerationCaseFromWeb('orphan-post.abc_DEF-1')
    expect(reads).toEqual(['orphan-post.abc_DEF-1'])
  })
})

describe('U-WEB-Q-CLIENT: the server clock', () => {
  it('measures the offset from serverNow when the response arrives', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.parse(SERVER_NOW) + 10 * 60_000))
    useMswHandlers(
      queueHandler(() => json(page([summary()]))),
      detailHandler(() => json({ data: detail() }))
    )
    // The browser clock runs ten minutes ahead of the server.
    expect((await list()).clockOffsetMs).toBe(-10 * 60_000)
    expect((await getModerationCaseFromWeb('post.p1')).clockOffsetMs).toBe(-10 * 60_000)
    vi.setSystemTime(new Date(Date.parse(SERVER_NOW) - 90_000))
    expect((await list()).clockOffsetMs).toBe(90_000)
  })

  it('shows the true remaining time with a skewed browser clock', () => {
    const due = new Date(Date.parse(SERVER_NOW) + 3 * 3_600_000).toISOString()
    const browserNow = Date.parse(SERVER_NOW) + 10 * 60_000
    const offset = Date.parse(SERVER_NOW) - browserNow
    expect(remainingMs(due, offset, browserNow)).toBe(3 * 3_600_000)
    expect(remainingMs(due, 0, browserNow)).toBe(3 * 3_600_000 - 10 * 60_000)
  })

  it('reads a negative remaining time once the case is past due', () => {
    expect(remainingMs('2026-11-03T11:00:00.000Z', 0, Date.parse(SERVER_NOW))).toBe(
      -3_600_000
    )
  })
})

describe('U-WEB-Q-CLIENT: closed failure states', () => {
  const cases: [string, number, JsonBodyType, string][] = [
    ['401', 401, { statusCode: 401, message: 'Unauthorized' }, 'signed_out'],
    ['403', 403, { statusCode: 403, message: 'Insufficient role' }, 'forbidden'],
    ['404', 404, errorBody(404, 'case_not_found'), 'not_found'],
    ['400 invalid_cursor', 400, errorBody(400, 'invalid_cursor'), 'invalid_cursor'],
    ['400 invalid_filter', 400, errorBody(400, 'invalid_filter'), 'invalid_filter'],
    ['400 with no code', 400, { statusCode: 400 }, 'invalid_filter'],
    ['503 disabled', 503, errorBody(503, 'moderation_console_disabled'), 'disabled'],
    [
      '503 audit_unavailable',
      503,
      errorBody(503, 'audit_unavailable'),
      'audit_unavailable',
    ],
    ['503 with no code', 503, { statusCode: 503 }, 'unavailable'],
    ['503 with an unknown code', 503, errorBody(503, 'something_else'), 'unavailable'],
    ['500', 500, { statusCode: 500 }, 'unavailable'],
  ]

  it.each(cases)(
    'maps %s to %s for the queue and the detail',
    async (_name, status, body, reason) => {
      useMswHandlers(
        queueHandler(() => json(body, status)),
        detailHandler(() => json(body, status))
      )
      const fromQueue = await failureOf(list)
      const fromDetail = await failureOf(() => getModerationCaseFromWeb('post.p1'))
      expect(fromQueue.reason).toBe(reason)
      expect(fromDetail.reason).toBe(reason)
      expect(fromQueue.status).toBe(status)
      expect(moderationFailureReason(fromQueue)).toBe(reason)
    }
  )

  it('maps a transport failure and a body that breaks the contract to unavailable', async () => {
    useMswHandlers(queueHandler(() => HttpResponse.error()))
    expect((await failureOf(list)).reason).toBe('unavailable')
    useMswHandlers(queueHandler(() => json({ data: { items: [{ caseId: 'post.p1' }] } })))
    expect((await failureOf(list)).reason).toBe('unavailable')
    expect(moderationFailureReason(new Error('anything'))).toBe('unavailable')
  })

  it('maps 429 to rate_limited and 400 with each closed code to its own reason', async () => {
    useMswHandlers(
      queueHandler(() => json({ statusCode: 429, message: 'slow down' }, 429))
    )
    expect((await failureOf(list)).reason).toBe('rate_limited')
    useMswHandlers(
      queueHandler(() =>
        json({ statusCode: 400, code: 'invalid_cursor', message: 'x' }, 400)
      )
    )
    expect((await failureOf(list)).reason).toBe('invalid_cursor')
    useMswHandlers(
      queueHandler(() =>
        json({ statusCode: 400, code: 'invalid_filter', message: 'x' }, 400)
      )
    )
    expect((await failureOf(list)).reason).toBe('invalid_filter')
  })

  it('drops a key a newer server added and keeps every declared field (version skew)', async () => {
    useMswHandlers(
      queueHandler(() =>
        json({ data: { ...page([]).data, addedLater: 'x', items: [] }, alsoNew: 1 })
      )
    )
    const result = await list()
    expect(result.items).toEqual([])
    expect(JSON.stringify(result)).not.toContain('addedLater')
  })

  it('lists every failure reason once, and a reason is terminal only when access or the case is gone', () => {
    expect(new Set(MODERATION_FAILURE_REASONS).size).toBe(
      MODERATION_FAILURE_REASONS.length
    )
    expect(MODERATION_FAILURE_REASONS).toContain('rate_limited')
    expect(MODERATION_FAILURE_REASONS.filter(isTerminalFailure)).toEqual([
      'signed_out',
      'forbidden',
      'disabled',
      'not_found',
    ])
  })

  it('never copies a response body into the error message', async () => {
    useMswHandlers(
      queueHandler(() => json({ statusCode: 403, message: 'secret-detail' }, 403))
    )
    const failure = await failureOf(list)
    expect(failure.message).not.toContain('secret-detail')
  })
})

describe('U-WEB-D-CLIENT: the decision and appeal routes', () => {
  const MUTATION_ID = '00000000-0000-4000-8000-000000000001'
  const decision: ModerationDecisionInput = {
    action: 'resolve',
    reason: 'A fair reason',
    mutationId: MUTATION_ID,
    expectedRevision: REVISION,
  }
  const appeal: ModerationAppealInput = {
    status: 'requested',
    reason: 'A fair reason',
    mutationId: MUTATION_ID,
  }
  const applyDecision = () => applyModerationDecisionFromWeb('post.p1', decision)
  const recordAppeal = () => recordModerationAppealFromWeb('sanction-1', appeal)
  const closedFailure = async (run: () => Promise<unknown>) =>
    moderationDecisionFailure(await failureOf(run))

  /** The status each closed code travels with on the real routes. */
  const CODE_STATUS: Record<ModerationDecisionErrorCode, number> = {
    invalid_decision: 400,
    case_not_found: 404,
    sanction_not_found: 404,
    moderation_console_disabled: 503,
    moderation_decisions_disabled: 503,
    self_review_refused: 403,
    admin_required: 403,
    operator_sanctioned: 403,
    case_conflict: 409,
    action_not_applicable: 409,
    idempotency_mismatch: 409,
    appeal_transition_invalid: 409,
    audit_unavailable: 503,
  }

  it('posts the input and the bearer to each route, once per call', async () => {
    const seen: { url: string; bearer: string | null; body: unknown }[] = []
    const record = async (request: Request) => {
      seen.push({
        url: new URL(request.url).pathname,
        bearer: request.headers.get('authorization'),
        body: await request.json(),
      })
    }
    useMswHandlers(
      http.post(DECISION_PATH, async ({ request }) => {
        await record(request)
        return json(decisionBody())
      }),
      http.post(APPEAL_PATH, async ({ request }) => {
        await record(request)
        return json(appealBody())
      })
    )
    await applyDecision()
    await recordAppeal()
    expect(seen).toEqual([
      {
        url: '/api/v1/moderation/cases/post.p1/decisions',
        bearer: `Bearer ${MODERATOR_TOKEN}`,
        body: decision,
      },
      {
        url: '/api/v1/moderation/sanctions/sanction-1/appeal',
        bearer: `Bearer ${MODERATOR_TOKEN}`,
        body: appeal,
      },
    ])
  })

  it.each(['completed', 'deferred'] as const)(
    'passes cacheInvalidation %s on to the panel, from both routes',
    async (cacheInvalidation) => {
      useMswHandlers(
        mutationHandler(DECISION_PATH, () => json(decisionBody({ cacheInvalidation }))),
        mutationHandler(APPEAL_PATH, () => json(appealBody({ cacheInvalidation })))
      )
      expect((await applyDecision()).cacheInvalidation).toBe(cacheInvalidation)
      expect((await recordAppeal()).cacheInvalidation).toBe(cacheInvalidation)
    }
  )

  it('passes a replay on as replayed', async () => {
    useMswHandlers(
      mutationHandler(DECISION_PATH, () => json(decisionBody({ replayed: true })))
    )
    expect((await applyDecision()).replayed).toBe(true)
  })

  it('drops a key a newer server added to an applied response', async () => {
    const body = decisionBody()
    useMswHandlers(
      mutationHandler(DECISION_PATH, () =>
        json({ data: { ...body.data, addedLater: 'x' }, alsoNew: 1 })
      )
    )
    const result = await applyDecision()
    expect(result.decisionId).toBe(body.data.decisionId)
    expect(JSON.stringify(result)).not.toContain('addedLater')
  })

  it('fails as signed_out without any request when no session token exists', async () => {
    const bodies: unknown[] = []
    useMswHandlers(
      mutationHandler(DECISION_PATH, () => json(decisionBody()), bodies),
      mutationHandler(APPEAL_PATH, () => json(appealBody()), bodies)
    )
    signIn(null)
    expect((await closedFailure(applyDecision)).failure).toBe('signed_out')
    expect((await closedFailure(recordAppeal)).failure).toBe('signed_out')
    expect(bodies).toEqual([])
  })

  it.each(moderationDecisionErrorCodeSchema.options)(
    'maps the closed code %s to one state on both routes',
    async (code) => {
      const status = CODE_STATUS[code]
      const body = { statusCode: status, code, message: 'Closed message.' }
      useMswHandlers(
        mutationHandler(DECISION_PATH, () => json(body, status)),
        mutationHandler(APPEAL_PATH, () => json(body, status))
      )
      expect(await closedFailure(applyDecision)).toEqual({ failure: code, detail: null })
      expect(await closedFailure(recordAppeal)).toEqual({ failure: code, detail: null })
    }
  )

  it.each(moderationDecisionDetailSchema.options)(
    'carries the closed detail %s',
    async (detailCode) => {
      useMswHandlers(
        mutationHandler(DECISION_PATH, () =>
          json(
            {
              statusCode: 409,
              code: 'action_not_applicable',
              message: 'Closed message.',
              detail: detailCode,
            },
            409
          )
        )
      )
      expect(await closedFailure(applyDecision)).toEqual({
        failure: 'action_not_applicable',
        detail: detailCode,
      })
    }
  )

  it('drops a detail the contract does not list, and keeps the code', async () => {
    useMswHandlers(
      mutationHandler(DECISION_PATH, () =>
        json(
          {
            statusCode: 409,
            code: 'action_not_applicable',
            message: 'Closed message.',
            detail: 'something_new',
          },
          409
        )
      )
    )
    expect(await closedFailure(applyDecision)).toEqual({
      failure: 'action_not_applicable',
      detail: null,
    })
  })

  const unclosed: [string, () => Response, ModerationDecisionFailure][] = [
    ['401', () => json({ statusCode: 401 }, 401), 'signed_out'],
    ['403 with no code', () => json({ statusCode: 403 }, 403), 'forbidden'],
    ['429', () => json({ statusCode: 429 }, 429), 'rate_limited'],
    ['500', () => json({ statusCode: 500 }, 500), 'unavailable'],
    ['503 with no code', () => json({ statusCode: 503 }, 503), 'unavailable'],
    [
      'a code the contract does not list',
      () => json({ statusCode: 409, code: 'something_new' }, 409),
      'unavailable',
    ],
    [
      'a body that is not JSON',
      () => new HttpResponse('<html>bad gateway</html>', { status: 502 }),
      'unavailable',
    ],
    ['no answer at all', () => HttpResponse.error(), 'offline'],
    ['an applied body that breaks the contract', () => json({ data: {} }), 'offline'],
  ]
  it.each(unclosed)('maps %s to one state', async (_name, respond, failure) => {
    useMswHandlers(mutationHandler(DECISION_PATH, respond))
    expect(await closedFailure(applyDecision)).toEqual({ failure, detail: null })
  })

  it('maps anything else it is handed to unavailable', () => {
    expect(moderationDecisionFailure(new Error('anything'))).toEqual({
      failure: 'unavailable',
      detail: null,
    })
  })

  it('never copies a response body into the error', async () => {
    useMswHandlers(
      mutationHandler(DECISION_PATH, () =>
        json({ statusCode: 403, code: 'admin_required', message: 'secret-detail' }, 403)
      )
    )
    const failure = await failureOf(applyDecision)
    expect(failure.message).not.toContain('secret-detail')
  })

  it('treats only the failures a same-payload retry can get past as retryable', () => {
    expect([...RETRYABLE_DECISION_FAILURES].sort()).toEqual([
      'audit_unavailable',
      'offline',
      'rate_limited',
      'unavailable',
    ])
  })
})

describe('U-WEB-D-CLIENT: the mutation id keeper', () => {
  const counting = () => {
    let minted = 0
    return createMutationIdKeeper(() => `id-${(minted += 1)}`)
  }

  it('holds one id for one payload, whatever the object identity', () => {
    const keeper = counting()
    expect(keeper.idFor({ action: 'resolve', reason: 'abc' })).toBe('id-1')
    expect(keeper.idFor({ action: 'resolve', reason: 'abc' })).toBe('id-1')
  })

  it('mints for a new reason, a new action and new ban terms', () => {
    const keeper = counting()
    expect(keeper.idFor({ action: 'resolve', reason: 'abc' })).toBe('id-1')
    expect(keeper.idFor({ action: 'resolve', reason: 'abcd' })).toBe('id-2')
    expect(keeper.idFor({ action: 'escalate', reason: 'abcd' })).toBe('id-3')
    expect(keeper.idFor({ action: 'ban', reason: 'abcd', ban: { days: 1 } })).toBe('id-4')
    expect(keeper.idFor({ action: 'ban', reason: 'abcd', ban: { days: 7 } })).toBe('id-5')
  })

  it('mints after clear, so the next intent never reuses a finished id', () => {
    const keeper = counting()
    const payload = { action: 'resolve', reason: 'abc' }
    expect(keeper.idFor(payload)).toBe('id-1')
    keeper.clear()
    expect(keeper.idFor(payload)).toBe('id-2')
  })

  it('mints a real UUID by default', () => {
    expect(createMutationIdKeeper().idFor({})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})

describe('U-WEB-D-NO-DIRECT: the console and the notice reach data only through the API', () => {
  const SOURCES = [
    '../app/components/moderation-decision-panel.tsx',
    '../app/components/moderation-account-standing.tsx',
    '../app/components/community-banned-notice.tsx',
  ]
  const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8')

  it.each(SOURCES)('%s imports no table client, Prisma or server action', (file) => {
    const source = read(file)
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const from of imports)
      expect(from).not.toMatch(/supabase|prisma|next\/headers|\/actions?\b|server/i)
    expect(source).not.toMatch(/['"]use server['"]/)
    expect(source).not.toMatch(/\bfetch\(/)
  })

  it.each(SOURCES)('%s holds no browser dialog', (file) => {
    expect(read(file)).not.toMatch(/(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/)
  })
})

describe('U-WEB-D-CLIENT: community_banned reads by code (TEA-22)', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
  })

  const sanction: CommunityBannedError['sanction'] = {
    kind: 'temporary',
    expiresAt: '2026-11-10T12:00:00.000Z',
    appealStatus: 'not_requested',
  }
  const banned = (message: string = COMMUNITY_BANNED_MESSAGE): CommunityBannedError => ({
    statusCode: 403,
    code: 'community_banned',
    message,
    sanction,
  })
  /** Every community route answers the same refusal, and counts what reached it. */
  const refuseEverything = (body: object = banned()) => {
    const calls: string[] = []
    const refuse = ({ request }: { request: Request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json(body, { status: 403 })
    }
    const install = useMswHandlers
    install(
      http.get('/api/v1/community/*', refuse),
      http.post('/api/v1/community/*', refuse),
      http.put('/api/v1/community/*', refuse)
    )
    return calls
  }
  const failureOf = (run: () => Promise<unknown>) =>
    run().then(
      () => {
        throw new Error('expected the request to be refused')
      },
      (error: unknown) => error
    )

  const READ_ROUTES: [string, () => Promise<unknown>][] = [
    ['the feed', () => getCommunityFeedFromWeb({ mode: 'auto' })],
    ['a single post', () => getCommunityPostFromWeb('post-1')],
    ['the spotlight', () => getCommunitySpotlightFromWeb()],
    ['the home teaser', () => getCommunitySpotlightFromWeb({ surface: 'home_teaser' })],
    ['a card open', () => openCommunityPostFromWeb('post-1', 'auto')],
    ['a spotlight open', () => openCommunitySpotlightPostFromWeb('post-1', 1, 'city')],
    ['comment roots', () => communityCommentsRootsFromWeb('post-1')],
    ['comment replies', () => communityCommentsRepliesFromWeb('post-1', 'comment-1')],
    ['own submissions', () => communityCommentsSubmissionsFromWeb('post-1')],
  ]

  it.each(READ_ROUTES)('%s reaches the banned state, once', async (_route, run) => {
    const calls = refuseEverything()
    const failure = await failureOf(run)
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
    expect(calls).toHaveLength(1)
  })

  it('a report reaches the banned state', async () => {
    refuseEverything()
    const failure = await failureOf(() => reportCommunityPostFromWeb('post-1', 'spam'))
    expect(communityFailureReason(failure)).toBe('banned')
  })

  it('a reaction reaches the banned state ahead of the eligibility rule', async () => {
    refuseEverything()
    const failure = await failureOf(() =>
      setCommunityReactionFromWeb('post-1', {
        selection: 'love',
        mutationId: '00000000-0000-4000-8000-000000000001',
        baseRevision: 0,
      })
    )
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
  })

  it('a deep link answers false, and asks once', async () => {
    const calls = refuseEverything()
    await expect(isCommunityPostVisibleFromWeb('post-1')).resolves.toBe(false)
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['the age gate', COMMUNITY_AGE_GATE_DENIED_MESSAGE],
    ['the rollout', COMMUNITY_FEED_DISABLED_MESSAGE],
    ['a self report', COMMUNITY_SELF_REPORT_MESSAGE],
    ['a comment self report', COMMUNITY_COMMENT_SELF_REPORT_MESSAGE],
  ])('beats the %s message rule', async (_rule, message) => {
    refuseEverything(banned(message))
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('banned')
    expect(communitySanctionOf(failure)).toEqual(sanction)
  })

  it('keeps the message distinct from the rollout and age gate copy', () => {
    for (const copy of [
      COMMUNITY_FEED_DISABLED_MESSAGE,
      COMMUNITY_AGE_GATE_DENIED_MESSAGE,
    ]) {
      expect(COMMUNITY_BANNED_MESSAGE).not.toContain(copy)
      expect(copy).not.toContain(COMMUNITY_BANNED_MESSAGE)
    }
  })

  it('reads the code, so a body a newer server extended still reaches the banned state', async () => {
    refuseEverything({
      ...banned(COMMUNITY_FEED_DISABLED_MESSAGE),
      sanction: { ...sanction, addedLater: 'x' },
    })
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('banned')
  })

  it('leaves every other 403 to its own rule, and no sanction on it', async () => {
    refuseEverything({
      statusCode: 403,
      code: 'denied',
      message: COMMUNITY_FEED_DISABLED_MESSAGE,
    })
    const rollout = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(rollout)).toBe('disabled')
    expect(communitySanctionOf(rollout)).toBeNull()

    refuseEverything({ statusCode: 403, message: COMMUNITY_BANNED_MESSAGE })
    const noCode = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(noCode)).toBe('unknown')
    expect(communitySanctionOf(noCode)).toBeNull()
  })

  it('never reads a ban from any status but 403', async () => {
    useMswHandlers(
      http.get('/api/v1/community/feed', () =>
        HttpResponse.json({ ...banned(), statusCode: 500 }, { status: 500 })
      )
    )
    const failure = await failureOf(() => getCommunityFeedFromWeb({ mode: 'auto' }))
    expect(communityFailureReason(failure)).toBe('unknown')
  })
})
