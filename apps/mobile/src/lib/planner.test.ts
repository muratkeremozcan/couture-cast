// Story 5.5 Task 8: the mobile planner network boundary, tested directly.
//
// `planner-screen.test.tsx` exercises this module through a whole screen render, which
// is the right place for the STATE MACHINE (locked/disabled/ready, busy guards, per-day
// notices) but a poor place to reach every status-code and malformed-response branch
// this module classifies: a screen test would need an extra render per edge case for
// branches that have nothing to do with rendering. Everything here is asserted through
// MSW against the real generated client, the way `premium-theme.test.ts` and
// `commerce.test.ts` cover their own boundaries: the failure taxonomy is only worth
// anything if the status codes really map onto it.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import {
  formatPlannerDayLabel,
  getPlannerFromMobile,
  plannerFailureReason,
  reshufflePlannerDayFromMobile,
} from './planner'

const PLANNER_ROUTE = '*/api/v1/commerce/premium/planner'

/** The shared error envelope: `.strict()` over `{ statusCode, message, error }`. */
const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

describe('mobile planner boundary', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('plannerFailureReason', () => {
    it("5.5-MOB-LIB-01 reads 'unknown' from anything this module didn't throw", () => {
      expect(plannerFailureReason(new Error('bare'))).toBe('unknown')
      expect(plannerFailureReason('not an error')).toBe('unknown')
      expect(plannerFailureReason(null)).toBe('unknown')
    })
  })

  describe('formatPlannerDayLabel', () => {
    it('5.5-MOB-LIB-02 formats a well-formed local date without shifting near midnight', () => {
      // Every locale reads the same UTC-anchored calendar date; a naive
      // `new Date(planDate)` read in the device's local zone would render a
      // different weekday for a reader west of Greenwich.
      expect(formatPlannerDayLabel('2026-09-07', 'en-US')).toBe('Mon, Sep 7')
    })

    /**
     * `planDate` always arrives validated by the contract in production, but the
     * month/day parts are typed as possibly-undefined (this project's strict
     * array-index typing), and the function falls back to the 1st of the month
     * rather than rendering `NaN`. A malformed value should degrade, not throw.
     */
    it('5.5-MOB-LIB-03 degrades a malformed date to day one of the month rather than throwing', () => {
      expect(() => formatPlannerDayLabel('2026-09', 'en-US')).not.toThrow()
      expect(formatPlannerDayLabel('2026-09', 'en-US')).toBe('Tue, Sep 1')
    })
  })

  describe('getPlannerFromMobile', () => {
    it('5.5-MOB-LIB-04 returns the resolved week on success', async () => {
      server.use(
        http.get(PLANNER_ROUTE, () =>
          HttpResponse.json({
            data: {
              locationId: 'location-1',
              timezone: 'America/New_York',
              anchorDate: '2026-09-07',
              daysReady: 0,
              days: [
                {
                  status: 'error',
                  planDate: '2026-09-07',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-08',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-09',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-10',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-11',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-12',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
                {
                  status: 'error',
                  planDate: '2026-09-13',
                  errorCode: 'generation_failed',
                  retryable: true,
                },
              ],
            },
          })
        )
      )

      const week = await getPlannerFromMobile({})
      expect(week.locationId).toBe('location-1')
      expect(week.daysReady).toBe(0)
    })

    it('5.5-MOB-LIB-05 rejects as signed_out without issuing a request when there is no token', async () => {
      restoreAccessTokenResolver?.()
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

      let requested = false
      server.use(
        http.get(PLANNER_ROUTE, () => {
          requested = true
          return errorEnvelope(200, '')
        })
      )

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('signed_out')
        }
      )
      expect(requested).toBe(false)
    })

    it('5.5-MOB-LIB-06 maps a real server 401 onto signed_out', async () => {
      server.use(http.get(PLANNER_ROUTE, () => errorEnvelope(401, 'Session invalid.')))

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('signed_out')
        }
      )
    })

    it('5.5-MOB-LIB-07 maps 403 onto not_entitled', async () => {
      server.use(
        http.get(PLANNER_ROUTE, () =>
          errorEnvelope(403, 'Premium subscription required.')
        )
      )

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('not_entitled')
        }
      )
    })

    it.each([
      ['The premium planner is temporarily unavailable.', 'disabled'],
      ['Some other maintenance message.', 'unknown'],
    ] as const)(
      '5.5-MOB-LIB-08 maps a 503 with message %j onto %s',
      async (message, reason) => {
        server.use(http.get(PLANNER_ROUTE, () => errorEnvelope(503, message)))

        await getPlannerFromMobile({}).then(
          () => expect.unreachable('the read should have rejected'),
          (error: unknown) => {
            expect(plannerFailureReason(error)).toBe(reason)
          }
        )
      }
    )

    /**
     * A 500 (or any other unmapped status) falls to `unknown`, and this variant
     * replies with a non-JSON body so `readServerMessage`'s `.json()` parse fails
     * and it falls back to the caller's fallback message rather than throwing a
     * second, masking error.
     */
    it('5.5-MOB-LIB-09 falls back to a generic message when the error body is not JSON', async () => {
      server.use(
        http.get(PLANNER_ROUTE, () =>
          HttpResponse.text('<html>gateway down</html>', { status: 500 })
        )
      )

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('unknown')
          expect((error as Error).message).toBe('Unable to load your weekly planner.')
        }
      )
    })

    /**
     * A JSON body with no `message` field is equally "nothing to read": the ternary
     * that inspects `body.message` and the one that validates it is a non-empty
     * string both take their false branch here, and the caller's fallback wins.
     */
    it('5.5-MOB-LIB-10 falls back to a generic message when the error body has no message field', async () => {
      server.use(
        http.get(PLANNER_ROUTE, () =>
          HttpResponse.json({ statusCode: 500 }, { status: 500 })
        )
      )

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect((error as Error).message).toBe('Unable to load your weekly planner.')
        }
      )
    })

    /**
     * A network-level failure (DNS, offline, a dropped connection) never reaches
     * the generated client's status-code handling at all: `fetch` itself rejects,
     * with whatever `AbortSignal.reason` was in play. This is the module's
     * catch-all path, distinct from every case above, which all rejected with a
     * `ResponseError` wrapping a real HTTP response.
     */
    it('5.5-MOB-LIB-11 classifies a transport failure as unknown and keeps an Error message', async () => {
      server.use(http.get(PLANNER_ROUTE, () => HttpResponse.error()))

      await getPlannerFromMobile({}).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('unknown')
          expect(typeof (error as Error).message).toBe('string')
        }
      )
    })

    /**
     * The same catch-all path, but the rejection value itself is not an `Error`:
     * an aborted request whose caller supplied a plain reason, for instance. The
     * module must not assume `.message` exists on whatever it catches.
     */
    it('5.5-MOB-LIB-12 falls back to the caller message when the thrown value is not an Error', async () => {
      const controller = new AbortController()
      controller.abort('a plain string reason')

      await getPlannerFromMobile({ signal: controller.signal }).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('unknown')
          expect((error as Error).message).toBe('Unable to load your weekly planner.')
        }
      )
    })
  })

  describe('reshufflePlannerDayFromMobile', () => {
    it('5.5-MOB-LIB-13 sends the expected version and platform header', async () => {
      let sentHeaders: Headers | undefined
      let sentBody: unknown
      server.use(
        http.post(`${PLANNER_ROUTE}/2026-09-07/reshuffle`, async ({ request }) => {
          sentHeaders = request.headers
          sentBody = await request.json()
          return HttpResponse.json({
            data: {
              day: {
                status: 'ready',
                planDate: '2026-09-07',
                version: 2,
                weather: {
                  confidence: 'unavailable',
                  freshness: null,
                  condition: null,
                  temperatureLow: null,
                  temperatureHigh: null,
                },
                isStarterWardrobe: true,
                outfits: [
                  {
                    id: 'o1',
                    scenario: 'morning',
                    garmentIds: [],
                    reasoningBadges: [],
                    comfortNotes: 'n',
                    displayGarments: [],
                    shopThisLook: null,
                  },
                  {
                    id: 'o2',
                    scenario: 'midday',
                    garmentIds: [],
                    reasoningBadges: [],
                    comfortNotes: 'n',
                    displayGarments: [],
                    shopThisLook: null,
                  },
                  {
                    id: 'o3',
                    scenario: 'evening',
                    garmentIds: [],
                    reasoningBadges: [],
                    comfortNotes: 'n',
                    displayGarments: [],
                    shopThisLook: null,
                  },
                ],
              },
              unchanged: false,
            },
          })
        })
      )

      const result = await reshufflePlannerDayFromMobile({
        planDate: '2026-09-07',
        expectedVersion: 1,
      })

      expect(result.day.version).toBe(2)
      expect(sentBody).toEqual({ expectedVersion: 1 })
      expect(sentHeaders?.get('x-couture-platform')).toBe('mobile')
    })

    it('5.5-MOB-LIB-14 maps a 409 onto version_conflict', async () => {
      server.use(
        http.post(`${PLANNER_ROUTE}/2026-09-07/reshuffle`, () =>
          errorEnvelope(409, 'This day changed since you last viewed it.')
        )
      )

      await reshufflePlannerDayFromMobile({
        planDate: '2026-09-07',
        expectedVersion: 1,
      }).then(
        () => expect.unreachable('the reshuffle should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('version_conflict')
        }
      )
    })

    it('5.5-MOB-LIB-15 maps a 409 with an unrelated message onto unknown', async () => {
      server.use(
        http.post(`${PLANNER_ROUTE}/2026-09-07/reshuffle`, () =>
          errorEnvelope(409, 'Some other precondition failed.')
        )
      )

      await reshufflePlannerDayFromMobile({
        planDate: '2026-09-07',
        expectedVersion: 1,
      }).then(
        () => expect.unreachable('the reshuffle should have rejected'),
        (error: unknown) => {
          expect(plannerFailureReason(error)).toBe('unknown')
        }
      )
    })
  })
})
