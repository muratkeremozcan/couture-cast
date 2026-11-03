// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: U-WEB-Q-CLIENT. Transport, server-clock offset and closed failure states.
import { HttpResponse, http, type JsonBodyType } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  getModerationCaseFromWeb,
  listModerationCasesFromWeb,
  moderationFailureReason,
  type ModerationRequestError,
  remainingMs,
} from './moderation'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  DETAIL_PATH,
  MODERATOR_TOKEN,
  QUEUE_PATH,
  SERVER_NOW,
  detail,
  detailHandler,
  errorBody,
  json,
  page,
  queueHandler,
  signIn,
  summary,
  type RecordedQuery,
} from '../test-utils/moderation-console'

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
    useMswHandlers(
      queueHandler(() => json({ data: { ...page([]).data, leak: 'userId' } }))
    )
    expect((await failureOf(list)).reason).toBe('unavailable')
    expect(moderationFailureReason(new Error('anything'))).toBe('unavailable')
  })

  it('never copies a response body into the error message', async () => {
    useMswHandlers(
      queueHandler(() => json({ statusCode: 403, message: 'secret-detail' }, 403))
    )
    const failure = await failureOf(list)
    expect(failure.message).not.toContain('secret-detail')
  })
})
