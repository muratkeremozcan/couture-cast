// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the web console's two read-only moderation routes.
// Volatile fields (server clock, cursor, signed URL) use matchers so the pact stays byte-stable
// across the three determinism runs. Every refusal names its own provider state.
// Story 6.11 test owner: C-D-PACT, the decision and appeal writes, the fields they add to the case
// detail, and the one refusal a banned member reads on the feed.
// A closed value the state fixes (code, detail, replayed, targetStatus, active) is recorded exact,
// so a provider that answers another one fails verification.
// Volatile values (ids, revision, times) use matchers.
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { expect, vi } from 'vitest'
import {
  COMMUNITY_BANNED_MESSAGE,
  type ModerationAppealInput,
  type ModerationDecisionDetail,
  type ModerationDecisionInput,
} from '@couture/api-client/contracts/http'
import {
  CommunityRequestError,
  getCommunityFeedFromWeb,
} from '../../../../apps/web/src/lib/community'
import {
  applyModerationDecisionFromWeb,
  getModerationCaseFromWeb,
  listModerationCasesFromWeb,
  ModerationDecisionRequestError,
  ModerationRequestError,
  recordModerationAppealFromWeb,
  type ModerationDecisionFailure,
  type ModerationFailureReason,
} from '../../../../apps/web/src/lib/moderation'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../../apps/web/src/lib/wardrobe'
import {
  eachLike,
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  pactModeratorAuth,
  pactModeratorHeaders,
  regex,
  string,
} from './shared'

const ISO = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z'
const iso = (example: string) => regex(ISO, example)
const SERVER_NOW = '2026-11-03T12:00:00.000Z'
const CURSOR = 'eyJ2IjoxfQ.c2lnbmF0dXJl'
const QUEUE_PATH = '/api/v1/moderation/cases'
const CASE_PATH = '/api/v1/moderation/cases/post.pactpost1'
const CASE_ID = 'post.pactpost1'
const DECISION_PATH = `${CASE_PATH}/decisions`
const SANCTION_ID = 'pact-sanction-1'
const APPEAL_PATH = `/api/v1/moderation/sanctions/${SANCTION_ID}/appeal`
const FEED_PATH = '/api/v1/community/feed'
const CURRENT_REVISION = '0123456789abcdef'
const STALE_REVISION = 'fedcba9876543210'
const NEXT_REVISION = 'aaaabbbbccccdddd'
const MUTATION_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const DECISION_ACTIONS = 'resolve|release|takedown|escalate|ban'
const SANCTION_KINDS = 'temporary|permanent'
const APPEAL_STATUSES = 'not_requested|requested|upheld|overturned'
const APPEAL_STEPS = 'requested|upheld|overturned'
const CACHE_OUTCOMES = 'completed|deferred'
const BAN_EXPIRES_AT = '2026-11-10T12:00:00.000Z'
const revision = (example: string) => regex('^[0-9a-f]{16}$', example)

const summary = {
  caseId: string('post.pactpost1'),
  source: regex('post|comment', 'post'),
  status: regex('open|resolved', 'open'),
  risk: regex('low|medium|high', 'high'),
  slaState: regex('on_track|at_risk|breached|resolved', 'at_risk'),
  slaDueAt: iso('2026-11-03T15:00:00.000Z'),
  acceptedAt: iso('2026-11-03T10:00:00.000Z'),
  reportCount: like(3),
  reasons: eachLike(
    regex(
      'spam|harassment|inappropriate_content|hate_speech|violence|other',
      'harassment'
    )
  ),
  locale: like('en-US'),
  hasFinding: like(true),
  excerpt: like('A reported caption'),
  escalated: like(false),
}

const sanctionBody = {
  sanctionId: string(SANCTION_ID),
  kind: regex(SANCTION_KINDS, 'temporary'),
  expiresAt: iso(BAN_EXPIRES_AT),
  appealStatus: regex(APPEAL_STATUSES, 'not_requested'),
}

/** An author with no ban on record, so the viewer's actions include one and no appeal step exists. */
const standingClean = {
  active: false,
  sanction: nullValue(),
  priorBanCount: like(0),
  allowedAppealSteps: [],
}

const decisionState = {
  revision: revision(CURRENT_REVISION),
  allowedActions: eachLike(regex(DECISION_ACTIONS, 'takedown')),
  banKinds: eachLike(regex(SANCTION_KINDS, 'temporary')),
  escalated: like(false),
  firstDecisionAt: nullValue(),
  subjectStanding: standingClean,
}

const identity = (alias: string) => ({
  state: regex('alias|erased|unknown', 'alias'),
  alias: like(alias),
})

const detailBody = {
  caseId: string('post.pactpost1'),
  source: regex('post|comment', 'post'),
  status: regex('open|resolved', 'open'),
  risk: regex('low|medium|high', 'high'),
  slaState: regex('on_track|at_risk|breached|resolved', 'at_risk'),
  slaDueAt: iso('2026-11-03T15:00:00.000Z'),
  acceptedAt: iso('2026-11-03T10:00:00.000Z'),
  serverNow: iso(SERVER_NOW),
  reportCount: like(1),
  locale: like('en-US'),
  subject: identity('quiet-fox-1234'),
  snapshot: like({
    available: true,
    caption: 'What the reporter saw',
    altText: 'Alt text',
    body: null,
    climateBand: 'temperate_dry',
    capturedAt: '2026-11-03T10:00:00.000Z',
  }),
  target: like({
    state: 'live',
    status: 'published',
    publishedAt: '2026-11-03T07:00:00.000Z',
    parentBody: null,
  }),
  findings: like({
    codes: ['text_policy_match'],
    categories: ['language'],
    engineVersion: '1.2.0',
    operatorNote: null,
  }),
  reporters: eachLike({
    identity: identity('brave-owl-9876'),
    origin: 'member',
    reason: regex(
      'spam|harassment|inappropriate_content|hate_speech|violence|other',
      'harassment'
    ),
    details: like('Reporter note'),
    reportedAt: iso('2026-11-03T10:00:00.000Z'),
    resolved: like(false),
  }),
  priorActions: eachLike({
    actorKind: regex('screening|reporter|operator', 'screening'),
    action: string('flagged'),
    reason: like('text_policy_match'),
    occurredAt: iso('2026-11-03T06:00:00.000Z'),
  }),
  viewerConflict: like(false),
  ...decisionState,
}

const withImage = {
  ...detailBody,
  // The author already holds a temporary ban, so a moderator can order no further ban and can
  // record the appeal request.
  banKinds: [],
  subjectStanding: {
    active: true,
    sanction: sanctionBody,
    priorBanCount: like(1),
    allowedAppealSteps: eachLike(regex(APPEAL_STEPS, 'requested')),
  },
  media: {
    state: regex('available', 'available'),
    url: regex(
      'https://[^ ]+',
      'https://storage.example.test/object/sign/community/p1/a.jpg?token=pact-signature'
    ),
    expiresAt: iso('2026-11-03T12:01:48.000Z'),
    altText: like('Alt text'),
  },
}
const withoutImage = {
  ...detailBody,
  // No author survives an erased target, so the standing is null and no ban can apply.
  allowedActions: eachLike(regex('resolve|escalate', 'resolve')),
  banKinds: [],
  subjectStanding: nullValue(),
  target: like({ state: 'erased', status: null, publishedAt: null, parentBody: null }),
  reporters: eachLike({
    identity: { state: regex('erased', 'erased'), alias: null },
    origin: 'member',
    reason: regex(
      'spam|harassment|inappropriate_content|hate_speech|violence|other',
      'harassment'
    ),
    details: like('Reporter note'),
    reportedAt: iso('2026-11-03T10:00:00.000Z'),
    resolved: like(false),
  }),
  media: {
    state: regex('unavailable', 'unavailable'),
    reason: regex(
      'target_erased|anonymized|purged|no_image|signing_failed',
      'target_erased'
    ),
  },
}

const closed = (statusCode: number, code: string) => ({
  statusCode: like(statusCode),
  code: string(code),
  message: like('Closed message.'),
})

/**
 * Runs the real `apps/web/src/lib/moderation.ts` read against the mock server, with the bearer
 * in session storage as the web app keeps it. The query string, the headers and the failure
 * classification recorded here are the ones the console sends and maps.
 */
async function withWebSession<T>(
  server: V3MockServer,
  token: string,
  run: () => Promise<T>
) {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  process.env.NEXT_PUBLIC_API_BASE_URL = server.url
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => (key === WEB_ACCESS_TOKEN_STORAGE_KEY ? token : null),
    },
  })
  try {
    return await run()
  } finally {
    vi.unstubAllGlobals()
    if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl
  }
}

// A non-moderator is refused before the flag is read, so the 403 interactions run with the console off.
const consoleOff = 'The moderation console is turned off'
const COMMENT_CASE_PATH = '/api/v1/moderation/cases/comment.pactcomment1'
const state = (name: string) => createProviderState({ name, params: {} })

export async function verifyModerationQueueInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...state('A moderator reads a queue with open cases'))
    .uponReceiving('a moderator reading the first page of the open case queue')
    .withRequest(
      'GET',
      QUEUE_PATH,
      setJsonContent({
        headers: pactModeratorHeaders,
        query: { status: 'open', source: 'post', risk: 'high', limit: '25' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: {
          data: {
            items: eachLike({ ...summary, source: 'post', risk: 'high' }, 2),
            nextCursor: regex('[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+', CURSOR),
            serverNow: iso(SERVER_NOW),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const page = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        listModerationCasesFromWeb({
          filters: { status: 'open', source: 'post', risk: 'high' },
          limit: 25,
        })
      )
      expect(page.items).toHaveLength(2)
      expect(page.nextCursor).toBe(CURSOR)
      expect(page.serverNow).toBe(SERVER_NOW)
      expect(page.items[0]).toMatchObject({
        caseId: 'post.pactpost1',
        risk: 'high',
        slaState: 'at_risk',
      })
      expect(Number.isFinite(page.clockOffsetMs)).toBe(true)
    })
}

export async function verifyModerationQueueOrphanInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...state('A moderator reads a queue with an erased comment'))
    .uponReceiving('a moderator reading a queue that holds an erased comment case')
    .withRequest(
      'GET',
      QUEUE_PATH,
      setJsonContent({
        headers: pactModeratorHeaders,
        query: { status: 'open', source: 'comment' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: eachLike({
              ...summary,
              caseId: string('orphan-comment.pactreport2'),
              source: regex('post|comment', 'comment'),
              locale: nullValue(),
              excerpt: nullValue(),
              hasFinding: like(false),
            }),
            nextCursor: null,
            serverNow: iso(SERVER_NOW),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const page = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        listModerationCasesFromWeb({ filters: { status: 'open', source: 'comment' } })
      )
      expect(page.items).toHaveLength(1)
      expect(page.items[0]).toMatchObject({
        caseId: 'orphan-comment.pactreport2',
        locale: null,
        excerpt: null,
      })
    })
}

export async function verifyModerationQueueEmptyInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...state('A moderator reads an empty queue'))
    .uponReceiving('a moderator reading a queue with no open case')
    .withRequest(
      'GET',
      QUEUE_PATH,
      setJsonContent({ headers: pactModeratorHeaders, query: { status: 'open' } })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [],
            nextCursor: null,
            serverNow: iso(SERVER_NOW),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const page = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        listModerationCasesFromWeb({ filters: { status: 'open' } })
      )
      expect(page.items).toEqual([])
      expect(page.nextCursor).toBeNull()
    })
}

export async function verifyModerationCaseInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...state('A moderator opens a case with an image'))
    .uponReceiving('a moderator opening a case whose image can be signed')
    .withRequest('GET', CASE_PATH, setJsonContent({ headers: pactModeratorHeaders }))
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: { data: withImage },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const data = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        getModerationCaseFromWeb('post.pactpost1')
      )
      expect(data.media.state).toBe('available')
      expect(data.serverNow).toBe(SERVER_NOW)
      expect(data.reporters[0]?.identity.alias).toBe('brave-owl-9876')
      expect(data.revision).toBe(CURRENT_REVISION)
      expect(data.allowedActions).toEqual(['takedown'])
      expect(data.banKinds).toEqual([])
      expect(data.subjectStanding).toEqual({
        active: true,
        sanction: {
          sanctionId: SANCTION_ID,
          kind: 'temporary',
          expiresAt: BAN_EXPIRES_AT,
          appealStatus: 'not_requested',
        },
        priorBanCount: 1,
        allowedAppealSteps: ['requested'],
      })
    })

  await pact
    .addInteraction()
    .given(...state('A moderator opens a case whose target was erased'))
    .uponReceiving('a moderator opening a case whose target and image are gone')
    .withRequest('GET', CASE_PATH, setJsonContent({ headers: pactModeratorHeaders }))
    .willRespondWith(200, setJsonContent({ body: { data: withoutImage } }))
    .executeTest(async (server: V3MockServer) => {
      const data = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        getModerationCaseFromWeb('post.pactpost1')
      )
      expect(data.media).toEqual({ state: 'unavailable', reason: 'target_erased' })
      expect(data.target.state).toBe('erased')
      expect(data.reporters[0]?.identity).toEqual({ state: 'erased', alias: null })
      expect(data.banKinds).toEqual([])
      expect(data.subjectStanding).toBeNull()
    })

  await pact
    .addInteraction()
    .given(...state('A moderator opens a resolved comment case with no findings'))
    .uponReceiving(
      'a moderator opening a resolved comment case with no findings and no image'
    )
    .withRequest(
      'GET',
      COMMENT_CASE_PATH,
      setJsonContent({ headers: pactModeratorHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            caseId: string('comment.pactcomment1'),
            source: regex('post|comment', 'comment'),
            status: regex('open|resolved', 'resolved'),
            risk: regex('low|medium|high', 'low'),
            slaState: regex('on_track|at_risk|breached|resolved', 'resolved'),
            slaDueAt: iso('2026-11-03T15:00:00.000Z'),
            acceptedAt: iso('2026-11-03T10:00:00.000Z'),
            serverNow: iso(SERVER_NOW),
            reportCount: like(1),
            locale: nullValue(),
            subject: {
              state: regex('alias|erased|unknown', 'unknown'),
              alias: nullValue(),
            },
            snapshot: {
              available: like(true),
              caption: nullValue(),
              altText: nullValue(),
              body: like('A reported comment'),
              climateBand: nullValue(),
              capturedAt: iso('2026-11-03T10:00:00.000Z'),
            },
            target: {
              state: regex('live|erased', 'live'),
              status: like('published'),
              publishedAt: iso('2026-11-03T07:00:00.000Z'),
              parentBody: like('The parent comment'),
            },
            findings: nullValue(),
            reporters: eachLike({
              identity: {
                state: regex('alias|erased|unknown', 'unknown'),
                alias: nullValue(),
              },
              origin: 'member',
              reason: regex(
                'spam|harassment|inappropriate_content|hate_speech|violence|other',
                'other'
              ),
              details: nullValue(),
              reportedAt: iso('2026-11-03T10:00:00.000Z'),
              resolved: like(true),
            }),
            priorActions: [],
            media: {
              state: regex('unavailable', 'unavailable'),
              reason: regex(
                'target_erased|anonymized|purged|no_image|signing_failed',
                'no_image'
              ),
            },
            viewerConflict: like(true),
            // A viewer in conflict gets empty lists, so the console renders no form.
            revision: revision(CURRENT_REVISION),
            allowedActions: [],
            banKinds: [],
            escalated: like(false),
            firstDecisionAt: iso('2026-11-03T11:00:00.000Z'),
            subjectStanding: standingClean,
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const data = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        getModerationCaseFromWeb('comment.pactcomment1')
      )
      expect(data.source).toBe('comment')
      expect(data.status).toBe('resolved')
      expect(data.findings).toBeNull()
      expect(data.locale).toBeNull()
      expect(data.subject).toEqual({ state: 'unknown', alias: null })
      expect(data.reporters[0]?.identity).toEqual({ state: 'unknown', alias: null })
      expect(data.media).toEqual({ state: 'unavailable', reason: 'no_image' })
      expect(data.target.parentBody).toBe('The parent comment')
      expect(data.viewerConflict).toBe(true)
      expect(data.allowedActions).toEqual([])
      expect(data.banKinds).toEqual([])
      expect(data.firstDecisionAt).toBe('2026-11-03T11:00:00.000Z')
    })

  await pact
    .addInteraction()
    .given(...state('A moderator opens a case whose image cannot be signed'))
    .uponReceiving('a moderator opening a case whose image cannot be signed')
    .withRequest('GET', CASE_PATH, setJsonContent({ headers: pactModeratorHeaders }))
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            ...detailBody,
            snapshot: {
              available: like(false),
              caption: nullValue(),
              altText: nullValue(),
              body: nullValue(),
              climateBand: nullValue(),
              capturedAt: nullValue(),
            },
            findings: {
              codes: [],
              categories: [],
              engineVersion: nullValue(),
              operatorNote: like('Taken down by an operator'),
            },
            media: {
              state: regex('unavailable', 'unavailable'),
              reason: regex(
                'target_erased|anonymized|purged|no_image|signing_failed',
                'signing_failed'
              ),
            },
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const data = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        getModerationCaseFromWeb('post.pactpost1')
      )
      expect(data.media).toEqual({ state: 'unavailable', reason: 'signing_failed' })
      expect(data.snapshot.available).toBe(false)
      expect(data.findings).toEqual({
        codes: [],
        categories: [],
        engineVersion: null,
        operatorNote: 'Taken down by an operator',
      })
      expect(data.banKinds).toEqual(['temporary'])
      expect(data.firstDecisionAt).toBeNull()
      expect(data.subjectStanding).toEqual({
        active: false,
        sanction: null,
        priorBanCount: 0,
        allowedAppealSteps: [],
      })
    })
}

type Refusal = {
  name: string
  given: string
  path: string
  headers: Record<string, string>
  token: string
  query?: Record<string, string>
  status: number
  body: unknown
  /** What the console shows for this answer: the closed failure reason it maps to. */
  reason: ModerationFailureReason
  call: () => Promise<unknown>
}

export const moderationRefusals: Refusal[] = [
  {
    name: 'a guardian reading the queue while the console is off',
    given: consoleOff,
    path: QUEUE_PATH,
    headers: pactEventHeaders,
    token: pactEventAuth.accessToken,
    query: { status: 'open' },
    status: 403,
    reason: 'forbidden',
    body: {
      statusCode: like(403),
      message: string('Insufficient role'),
      error: string('Forbidden'),
    },
    call: () => listModerationCasesFromWeb({ filters: { status: 'open' } }),
  },
  {
    name: 'a guardian opening a case while the console is off',
    given: consoleOff,
    path: CASE_PATH,
    headers: pactEventHeaders,
    token: pactEventAuth.accessToken,
    status: 403,
    reason: 'forbidden',
    body: {
      statusCode: like(403),
      message: string('Insufficient role'),
      error: string('Forbidden'),
    },
    call: () => getModerationCaseFromWeb('post.pactpost1'),
  },
  {
    name: 'a moderator reading the queue while the console is off',
    given: consoleOff,
    path: QUEUE_PATH,
    headers: pactModeratorHeaders,
    token: pactModeratorAuth.accessToken,
    query: { status: 'open' },
    status: 503,
    reason: 'disabled',
    body: closed(503, 'moderation_console_disabled'),
    call: () => listModerationCasesFromWeb({ filters: { status: 'open' } }),
  },
  {
    name: 'a moderator holding a cursor the server refuses',
    given: 'A moderator holds a cursor that no longer matches',
    path: QUEUE_PATH,
    headers: pactModeratorHeaders,
    token: pactModeratorAuth.accessToken,
    query: { status: 'open', cursor: 'stale.cursor' },
    status: 400,
    reason: 'invalid_cursor',
    body: closed(400, 'invalid_cursor'),
    call: () =>
      listModerationCasesFromWeb({ filters: { status: 'open' }, cursor: 'stale.cursor' }),
  },
  {
    name: 'a moderator opening a case that does not exist',
    given: 'A moderator opens a case that does not exist',
    path: CASE_PATH,
    headers: pactModeratorHeaders,
    token: pactModeratorAuth.accessToken,
    status: 404,
    reason: 'not_found',
    body: closed(404, 'case_not_found'),
    call: () => getModerationCaseFromWeb('post.pactpost1'),
  },
  {
    name: 'a moderator opening a case whose view cannot be recorded',
    given: 'A moderator opens a case that cannot be audited',
    path: CASE_PATH,
    headers: pactModeratorHeaders,
    token: pactModeratorAuth.accessToken,
    status: 503,
    reason: 'audit_unavailable',
    body: closed(503, 'audit_unavailable'),
    call: () => getModerationCaseFromWeb('post.pactpost1'),
  },
]

export async function verifyModerationRefusal(pact: PactV4, refusal: Refusal) {
  await pact
    .addInteraction()
    .given(...state(refusal.given))
    .uponReceiving(refusal.name)
    .withRequest(
      'GET',
      refusal.path,
      setJsonContent({
        headers: refusal.headers,
        ...(refusal.query ? { query: refusal.query } : {}),
      })
    )
    .willRespondWith(
      refusal.status,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: refusal.body,
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const failure = await withWebSession(server, refusal.token, () =>
        refusal.call().catch((error: unknown) => error)
      )
      expect(failure).toBeInstanceOf(ModerationRequestError)
      const error = failure as ModerationRequestError
      expect(error.status).toBe(refusal.status)
      // The console maps the recorded status and code to this closed reason.
      expect(error.reason).toBe(refusal.reason)
      // A refusal never carries case data.
      expect(error.message).not.toMatch(/quiet-fox|brave-owl|caption|storage\.example/i)
    })
}

/** The request body as the panel sends it, with matchers on the two values each intent mints. */
function decisionRequestBody(input: ModerationDecisionInput) {
  return {
    ...input,
    reason: like(input.reason),
    mutationId: regex(UUID, input.mutationId),
    expectedRevision: revision(input.expectedRevision),
  }
}

const REASON = 'Breaks the community rules.'
const decide = (fields: Partial<ModerationDecisionInput> = {}): ModerationDecisionInput =>
  ({
    action: 'takedown',
    reason: REASON,
    mutationId: MUTATION_ID,
    expectedRevision: CURRENT_REVISION,
    ...fields,
  }) as ModerationDecisionInput

export async function verifyModerationDecisionAppliedInteraction(pact: PactV4) {
  const input = decide()
  await pact
    .addInteraction()
    .given(...state('A moderator applies a decision to an open case'))
    .uponReceiving('a moderator taking down the target of an open case')
    .withRequest(
      'POST',
      DECISION_PATH,
      setJsonContent({ headers: pactModeratorHeaders, body: decisionRequestBody(input) })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: {
          data: {
            decisionId: string('pact-decision-1'),
            caseId: string(CASE_ID),
            action: 'takedown',
            decidedAt: iso(SERVER_NOW),
            firstDecisionAt: iso(SERVER_NOW),
            revision: revision(NEXT_REVISION),
            caseStatus: 'resolved',
            escalated: false,
            targetStatus: 'flagged',
            sanction: nullValue(),
            replayed: false,
            cacheInvalidation: regex(CACHE_OUTCOMES, 'completed'),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const result = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        applyModerationDecisionFromWeb(CASE_ID, input)
      )
      expect(result).toEqual({
        decisionId: 'pact-decision-1',
        caseId: CASE_ID,
        action: 'takedown',
        decidedAt: SERVER_NOW,
        firstDecisionAt: SERVER_NOW,
        revision: NEXT_REVISION,
        caseStatus: 'resolved',
        escalated: false,
        targetStatus: 'flagged',
        sanction: null,
        replayed: false,
        cacheInvalidation: 'completed',
      })
    })
}

export async function verifyModerationDecisionReplayedInteraction(pact: PactV4) {
  const input = decide({
    action: 'ban',
    ban: { kind: 'temporary', durationDays: 7 },
  })
  await pact
    .addInteraction()
    .given(...state('A moderator retries a ban that already applied'))
    .uponReceiving('a moderator retrying a ban with the same mutation id')
    .withRequest(
      'POST',
      DECISION_PATH,
      setJsonContent({ headers: pactModeratorHeaders, body: decisionRequestBody(input) })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: {
          data: {
            decisionId: string('pact-decision-1'),
            caseId: string(CASE_ID),
            action: 'ban',
            decidedAt: iso(SERVER_NOW),
            firstDecisionAt: iso(SERVER_NOW),
            revision: revision(NEXT_REVISION),
            caseStatus: 'resolved',
            escalated: false,
            targetStatus: 'flagged',
            sanction: sanctionBody,
            replayed: true,
            cacheInvalidation: regex(CACHE_OUTCOMES, 'completed'),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const result = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        applyModerationDecisionFromWeb(CASE_ID, input)
      )
      expect(result.replayed).toBe(true)
      expect(result.action).toBe('ban')
      expect(result.sanction).toEqual({
        sanctionId: SANCTION_ID,
        kind: 'temporary',
        expiresAt: BAN_EXPIRES_AT,
        appealStatus: 'not_requested',
      })
    })
}

const decisionRefused = (
  statusCode: number,
  code: string,
  extra: Record<string, unknown> = {}
) => ({
  statusCode: like(statusCode),
  code,
  message: like('Closed message.'),
  ...extra,
})

type DecisionRefusal = {
  name: string
  given: string
  input: ModerationDecisionInput
  status: number
  body: unknown
  /** The closed reason and detail the panel maps this answer to. */
  failure: ModerationDecisionFailure
  detail?: ModerationDecisionDetail
}

export const moderationDecisionRefusals: DecisionRefusal[] = [
  {
    name: 'a moderator deciding from a stale reading of the case',
    given: 'A moderator decides from a stale reading of the case',
    input: decide({ expectedRevision: STALE_REVISION }),
    status: 409,
    failure: 'case_conflict',
    body: decisionRefused(409, 'case_conflict', {
      currentRevision: revision(CURRENT_REVISION),
    }),
  },
  {
    name: 'a moderator releasing a target that is not held',
    given: 'A moderator releases a case whose target is not held',
    input: decide({ action: 'release' }),
    status: 409,
    failure: 'action_not_applicable',
    detail: 'target_not_held',
    body: decisionRefused(409, 'action_not_applicable', { detail: 'target_not_held' }),
  },
  {
    name: 'a moderator ruling on a case they are party to',
    given: 'A moderator rules on a case they reported',
    input: decide(),
    status: 403,
    failure: 'self_review_refused',
    body: decisionRefused(403, 'self_review_refused'),
  },
  {
    name: 'a moderator ordering a permanent ban',
    given: 'A moderator orders a ban only an admin may order',
    input: decide({ action: 'ban', ban: { kind: 'permanent' } }),
    status: 403,
    failure: 'admin_required',
    body: decisionRefused(403, 'admin_required'),
  },
  {
    name: 'a moderator deciding while decisions are off',
    given: 'Moderation decisions are turned off',
    input: decide(),
    status: 503,
    failure: 'moderation_decisions_disabled',
    body: decisionRefused(503, 'moderation_decisions_disabled'),
  },
]

export async function verifyModerationDecisionRefusal(
  pact: PactV4,
  refusal: DecisionRefusal
) {
  await pact
    .addInteraction()
    .given(...state(refusal.given))
    .uponReceiving(refusal.name)
    .withRequest(
      'POST',
      DECISION_PATH,
      setJsonContent({
        headers: pactModeratorHeaders,
        body: decisionRequestBody(refusal.input),
      })
    )
    .willRespondWith(
      refusal.status,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: refusal.body,
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const failure = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        applyModerationDecisionFromWeb(CASE_ID, refusal.input).catch(
          (error: unknown) => error
        )
      )
      expect(failure).toBeInstanceOf(ModerationDecisionRequestError)
      const error = failure as ModerationDecisionRequestError
      expect(error.failure).toBe(refusal.failure)
      expect(error.detail).toBe(refusal.detail ?? null)
    })
}

export async function verifyModerationAppealInteraction(pact: PactV4) {
  const input: ModerationAppealInput = {
    status: 'requested',
    reason: REASON,
    mutationId: MUTATION_ID,
  }
  await pact
    .addInteraction()
    .given(...state('A moderator records an appeal request on a ban'))
    .uponReceiving('a moderator recording an appeal request')
    .withRequest(
      'POST',
      APPEAL_PATH,
      setJsonContent({
        headers: pactModeratorHeaders,
        body: {
          status: 'requested',
          reason: like(REASON),
          mutationId: regex(UUID, MUTATION_ID),
        },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': 'private, no-store' },
        body: {
          data: {
            decisionId: string('pact-decision-2'),
            decidedAt: iso(SERVER_NOW),
            sanction: { ...sanctionBody, appealStatus: 'requested' },
            active: true,
            restoredCount: 0,
            replayed: false,
            cacheInvalidation: regex(CACHE_OUTCOMES, 'completed'),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const result = await withWebSession(server, pactModeratorAuth.accessToken, () =>
        recordModerationAppealFromWeb(SANCTION_ID, input)
      )
      expect(result).toEqual({
        decisionId: 'pact-decision-2',
        decidedAt: SERVER_NOW,
        sanction: {
          sanctionId: SANCTION_ID,
          kind: 'temporary',
          expiresAt: BAN_EXPIRES_AT,
          appealStatus: 'requested',
        },
        active: true,
        restoredCount: 0,
        replayed: false,
        cacheInvalidation: 'completed',
      })
    })
}

export async function verifyCommunityBannedFeedInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...state('A banned member reads the community feed'))
    .uponReceiving('a banned member reading the community feed')
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'x-couture-platform': 'web',
          'x-couture-reactions': '1',
          'x-couture-sponsorship': '1',
        },
        query: { mode: 'auto', limit: '12' },
      })
    )
    .willRespondWith(
      403,
      setJsonContent({
        body: {
          statusCode: 403,
          code: 'community_banned',
          message: COMMUNITY_BANNED_MESSAGE,
          sanction: {
            kind: regex(SANCTION_KINDS, 'temporary'),
            expiresAt: iso(BAN_EXPIRES_AT),
            appealStatus: regex(APPEAL_STATUSES, 'not_requested'),
          },
        },
      })
    )
    .executeTest(async (server: V3MockServer) => {
      const failure = await withWebSession(server, pactEventAuth.accessToken, () =>
        getCommunityFeedFromWeb({ mode: 'auto' }).catch((error: unknown) => error)
      )
      expect(failure).toBeInstanceOf(CommunityRequestError)
      const error = failure as CommunityRequestError
      expect(error.reason).toBe('banned')
      expect(error.message).toBe(COMMUNITY_BANNED_MESSAGE)
      // Exactly the member's view: kind, expiry and appeal status, with nothing about the case.
      expect(error.sanction).toEqual({
        kind: 'temporary',
        expiresAt: BAN_EXPIRES_AT,
        appealStatus: 'not_requested',
      })
    })
}
