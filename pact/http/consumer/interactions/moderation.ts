// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the web console's two read-only moderation routes.
// Volatile fields (server clock, cursor, signed URL) use matchers so the pact stays byte-stable
// across the three determinism runs. Every refusal names its own provider state.
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { expect, vi } from 'vitest'
import {
  getModerationCaseFromWeb,
  listModerationCasesFromWeb,
  ModerationRequestError,
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
}

const withImage = {
  ...detailBody,
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
  target: like({ state: 'erased', status: null, publishedAt: null, parentBody: null }),
  reporters: eachLike({
    identity: { state: regex('erased', 'erased'), alias: null },
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

const consoleOn = 'The moderation console is on'
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
            items: eachLike(summary, 2),
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
    name: 'a guardian reading the queue',
    given: consoleOn,
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
    name: 'a guardian opening a case',
    given: consoleOn,
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
    given: 'The moderation console is turned off',
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
