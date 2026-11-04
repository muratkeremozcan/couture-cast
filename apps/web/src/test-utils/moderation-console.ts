// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: fixtures and MSW handlers for the moderator console tests.
// Every fixture is parsed by the shipped contract, so a drifting field fails here first.
import { http, HttpResponse, type JsonBodyType, type RequestHandler } from 'msw'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  type ModerationCaseDetail,
  type ModerationCaseSummary,
} from '@couture/api-client/contracts/http'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'

export const SERVER_NOW = '2026-11-03T12:00:00.000Z'
export const QUEUE_PATH = '*/api/v1/moderation/cases'
export const DETAIL_PATH = '*/api/v1/moderation/cases/:caseId'
export const MODERATOR_TOKEN = 'test-token-moderator'

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
