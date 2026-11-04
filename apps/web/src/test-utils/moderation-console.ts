// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: fixtures and MSW handlers for the moderator console tests.
// Story 6.11 test owner: the decision state on the detail and the mutation handlers.
// Every fixture is parsed by the shipped contract, so a drifting field fails here first.
import { http, HttpResponse, type JsonBodyType, type RequestHandler } from 'msw'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  moderationAppealResponseSchema,
  moderationDecisionResponseSchema,
  type ModerationAppealResult,
  type ModerationCaseDetail,
  type ModerationCaseSummary,
  type ModerationDecisionResult,
} from '@couture/api-client/contracts/http'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'

export const SERVER_NOW = '2026-11-03T12:00:00.000Z'
export const QUEUE_PATH = '*/api/v1/moderation/cases'
export const DETAIL_PATH = '*/api/v1/moderation/cases/:caseId'
export const MODERATOR_TOKEN = 'test-token-moderator'
export const DECISION_PATH = '*/api/v1/moderation/cases/:caseId/decisions'
export const APPEAL_PATH = '*/api/v1/moderation/sanctions/:sanctionId/appeal'
export const REVISION = 'aaaaaaaaaaaaaaaa'
export const MOVED_REVISION = 'bbbbbbbbbbbbbbbb'

/** The console reads the bearer from session storage, as every other web route does. */
export function signIn(token: string | null = MODERATOR_TOKEN) {
  if (token === null) window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
}

const hours = (count: number) =>
  new Date(Date.parse(SERVER_NOW) + count * 3_600_000).toISOString()

export function summary(
  overrides: Partial<ModerationCaseSummary> = {}
): ModerationCaseSummary {
  return {
    caseId: 'post.p1',
    source: 'post',
    status: 'open',
    risk: 'high',
    slaState: 'on_track',
    slaDueAt: hours(10),
    acceptedAt: hours(-1),
    reportCount: 1,
    reasons: ['harassment'],
    locale: 'en-US',
    hasFinding: false,
    excerpt: 'A reported caption',
    escalated: false,
    ...overrides,
  }
}

export function detail(
  overrides: Partial<ModerationCaseDetail> = {}
): ModerationCaseDetail {
  return moderationCaseDetailResponseSchema.parse({
    data: {
      caseId: 'post.p1',
      source: 'post',
      status: 'open',
      risk: 'high',
      slaState: 'at_risk',
      slaDueAt: hours(3),
      acceptedAt: hours(-2),
      serverNow: SERVER_NOW,
      reportCount: 1,
      locale: 'en-US',
      subject: { state: 'alias', alias: 'quiet-fox-1234' },
      snapshot: {
        available: true,
        caption: 'Caption the reporter saw',
        altText: 'Alt the reporter saw',
        body: null,
        climateBand: 'temperate_dry',
        capturedAt: hours(-2),
      },
      target: {
        state: 'live',
        status: 'published',
        publishedAt: hours(-5),
        parentBody: null,
      },
      findings: null,
      reporters: [
        {
          identity: { state: 'alias', alias: 'brave-owl-9876' },
          origin: 'member',
          reason: 'harassment',
          details: 'Reporter typed this',
          reportedAt: hours(-2),
          resolved: false,
        },
      ],
      priorActions: [],
      media: {
        state: 'available',
        url: 'https://storage.test/object/sign/community/p1/a.jpg?token=SIGNED-SECRET',
        expiresAt: new Date(Date.parse(SERVER_NOW) + 120_000).toISOString(),
        altText: 'Alt the reporter saw',
      },
      viewerConflict: false,
      // Story 6.11: no action is allowed unless a test says so, so a read-only view stays the default.
      revision: REVISION,
      allowedActions: [],
      banKinds: [],
      escalated: false,
      firstDecisionAt: null,
      subjectStanding: null,
      ...overrides,
    },
  }).data
}

export const page = (
  items: ModerationCaseSummary[],
  nextCursor: string | null = null,
  serverNow = SERVER_NOW
) => moderationCasesResponseSchema.parse({ data: { items, nextCursor, serverNow } })

export const errorBody = (statusCode: number, code: string) => ({
  statusCode,
  code,
  message: 'Closed message.',
})

export type RecordedQuery = Record<string, string>

/** A queue handler that records every query string it sees. */
export function queueHandler(
  respond: (query: RecordedQuery, call: number) => Response | Promise<Response>,
  seen: RecordedQuery[] = []
): RequestHandler {
  return http.get(QUEUE_PATH, ({ request }) => {
    const query = Object.fromEntries(new URL(request.url).searchParams.entries())
    seen.push(query)
    return respond(query, seen.length)
  })
}

/** A detail handler that counts reads: every read writes one audit row on the server. */
export function detailHandler(
  respond: (caseId: string, call: number) => Response | Promise<Response>,
  reads: string[] = []
): RequestHandler {
  return http.get(DETAIL_PATH, ({ params }) => {
    const caseId = String(params.caseId)
    reads.push(caseId)
    return respond(caseId, reads.length)
  })
}

export const json = (body: JsonBodyType, status = 200) =>
  HttpResponse.json(body, { status })

/** Story 6.11: the body of an applied decision, parsed by the shipped contract. */
export function decisionBody(overrides: Partial<ModerationDecisionResult> = {}) {
  return moderationDecisionResponseSchema.parse({
    data: {
      decisionId: 'decision-1',
      caseId: 'post.p1',
      action: 'resolve',
      decidedAt: SERVER_NOW,
      firstDecisionAt: SERVER_NOW,
      revision: MOVED_REVISION,
      caseStatus: 'resolved',
      escalated: false,
      targetStatus: 'published',
      sanction: null,
      replayed: false,
      cacheInvalidation: 'completed',
      ...overrides,
    },
  })
}

/** Story 6.11: the body of a recorded appeal step, parsed by the shipped contract. */
export function appealBody(overrides: Partial<ModerationAppealResult> = {}) {
  return moderationAppealResponseSchema.parse({
    data: {
      decisionId: 'decision-2',
      decidedAt: SERVER_NOW,
      sanction: {
        sanctionId: 'sanction-1',
        kind: 'temporary',
        expiresAt: hours(24),
        appealStatus: 'requested',
      },
      active: true,
      restoredCount: 0,
      replayed: false,
      cacheInvalidation: 'completed',
      ...overrides,
    },
  })
}

/** A decision or appeal handler that records every body it receives. */
export function mutationHandler<Body>(
  path: string,
  respond: (body: Body, call: number) => Response | Promise<Response>,
  bodies: Body[] = []
): RequestHandler {
  return http.post(path, async ({ request }) => {
    const body = (await request.json()) as Body
    bodies.push(body)
    return respond(body, bodies.length)
  })
}
