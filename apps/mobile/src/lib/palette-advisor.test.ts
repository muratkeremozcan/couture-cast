// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 5.5 TEA coverage-gate follow-up: the mobile colour palette advisor network
// boundary, tested directly.
//
// `palette-advisor-screen.test.tsx` exercises this module through a whole screen
// render, the right place for the STATE MACHINE (locked/consent/sources/result) but a
// poor place to reach every status-code and malformed-response branch this module
// classifies; a screen test needs an extra render per edge case for branches that have
// nothing to do with rendering. Everything here is asserted through MSW against the real
// generated client, the way `planner.test.ts` and `premium-theme.test.ts` cover their
// own boundaries: the failure taxonomy is only worth anything if the status codes really
// map onto it.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { currentUploadSession, forgetAllUploadAttempts } from '@/src/lib/upload-attempts'
import {
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  UploadSessionChangedError,
} from '@couture/api-client/contracts/http'

import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver, setMobileApplicationUserId } from './mobile-auth'
import {
  erasePaletteAdvisorFromMobile,
  getPaletteAdvisorFromMobile,
  paletteAdvisorFailureReason,
  setPaletteConsentFromMobile,
  uploadPaletteSelfieFromMobile,
} from './palette-advisor'

const PALETTE_ROUTE = '*/api/v1/commerce/premium/palette'

/** The shared error envelope: `.strict()` over `{ statusCode, message, error }`. */
const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

const profile = () => ({
  data: {
    profileId: 'p1',
    isEntitled: true,
    analysisEnabled: true,
    hasConsent: false,
    analysis: null,
    recommendations: [],
  },
})

describe('mobile palette advisor boundary', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    // Upload attempts live for the app session; each test starts signed out with none open.
    setMobileApplicationUserId(null)
    forgetAllUploadAttempts()
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  describe('paletteAdvisorFailureReason', () => {
    it("reads 'unknown' from anything this module didn't throw", () => {
      expect(paletteAdvisorFailureReason(new Error('bare'))).toBe('unknown')
      expect(paletteAdvisorFailureReason('nope')).toBe('unknown')
    })
  })

  describe('getPaletteAdvisorFromMobile', () => {
    it.each([['GARMENT_ANALYSIS_PENDING-unrelated', 'unknown']] as const)(
      'maps a 409 with an unrelated message %s onto %s',
      async (message, reason) => {
        server.use(http.get(PALETTE_ROUTE, () => errorEnvelope(409, message)))

        await getPaletteAdvisorFromMobile().then(
          () => expect.unreachable('the read should have rejected'),
          (error: unknown) => {
            expect(paletteAdvisorFailureReason(error)).toBe(reason)
          }
        )
      }
    )

    it('maps a 503 with an unrelated message onto unknown', async () => {
      server.use(http.get(PALETTE_ROUTE, () => errorEnvelope(503, 'Some other outage.')))

      await getPaletteAdvisorFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('unknown')
        }
      )
    })

    it('falls back to a generic message when the error body is not JSON', async () => {
      server.use(
        http.get(PALETTE_ROUTE, () =>
          HttpResponse.text('<html>down</html>', { status: 500 })
        )
      )

      await getPaletteAdvisorFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect((error as Error).message).toBe('Unable to load your colour palette.')
        }
      )
    })

    it('falls back to a generic message when the error body has no message field', async () => {
      server.use(
        http.get(PALETTE_ROUTE, () =>
          HttpResponse.json({ statusCode: 500 }, { status: 500 })
        )
      )

      await getPaletteAdvisorFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect((error as Error).message).toBe('Unable to load your colour palette.')
        }
      )
    })

    /**
     * A network-level failure never reaches the generated client's status-code
     * handling: `fetch` itself rejects, with whatever `AbortSignal.reason` is in
     * play. Distinct from every status-code case above, which reject with a
     * `ResponseError` wrapping a real HTTP response.
     */
    it('classifies a transport failure as unknown and keeps an Error message', async () => {
      server.use(http.get(PALETTE_ROUTE, () => HttpResponse.error()))

      await getPaletteAdvisorFromMobile().then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('unknown')
          expect(typeof (error as Error).message).toBe('string')
        }
      )
    })

    /** The same catch-all path, but the rejection value itself is not an `Error`. */
    it('falls back to the caller message when the thrown value is not an Error', async () => {
      const controller = new AbortController()
      controller.abort('a plain string reason')

      await getPaletteAdvisorFromMobile(controller.signal).then(
        () => expect.unreachable('the read should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('unknown')
          expect((error as Error).message).toBe('Unable to load your colour palette.')
        }
      )
    })
  })

  describe('setPaletteConsentFromMobile', () => {
    it('classifies a rejected consent write', async () => {
      server.use(
        http.post(`${PALETTE_ROUTE}/consent`, () =>
          errorEnvelope(503, PALETTE_ANALYSIS_DISABLED_MESSAGE)
        )
      )

      await setPaletteConsentFromMobile(true).then(
        () => expect.unreachable('the write should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('analysis_disabled')
        }
      )
    })
  })

  describe('erasePaletteAdvisorFromMobile', () => {
    it('classifies a rejected erase', async () => {
      server.use(http.delete(PALETTE_ROUTE, () => errorEnvelope(500, 'Storage error.')))

      await erasePaletteAdvisorFromMobile().then(
        () => expect.unreachable('the erase should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('unknown')
        }
      )
    })
  })

  describe('uploadPaletteSelfieFromMobile', () => {
    /** The prepared photo, bound to the session current when the test picks it. */
    const uploadInput = () => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/png' as const,
      widthPx: 512,
      heightPx: 512,
      sha256: 'a'.repeat(64),
      uploadSession: currentUploadSession(),
    })

    it('classifies a rejected allocate call', async () => {
      server.use(
        http.post(`${PALETTE_ROUTE}/selfie/upload-url`, () =>
          errorEnvelope(403, 'Premium subscription required.')
        )
      )

      await uploadPaletteSelfieFromMobile(uploadInput()).then(
        () => expect.unreachable('the allocate should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('not_entitled')
        }
      )
    })

    it('classifies a rejected commit call', async () => {
      server.use(
        http.post(`${PALETTE_ROUTE}/selfie/upload-url`, () =>
          HttpResponse.json({
            data: {
              uploadSessionId: 'session-1',
              uploadUrl: `${window.location.origin}/mock-storage/selfie-session-1`,
              uploadToken: 'upload-token',
              requiredHeaders: { 'content-type': 'image/png' },
              expiresAt: '2026-09-04T17:00:00.000Z',
            },
          })
        ),
        http.put(`${window.location.origin}/mock-storage/selfie-session-1`, () =>
          HttpResponse.json({})
        ),
        http.post(`${PALETTE_ROUTE}/selfie/commit`, () =>
          errorEnvelope(500, 'Storage error.')
        )
      )

      await uploadPaletteSelfieFromMobile(uploadInput()).then(
        () => expect.unreachable('the commit should have rejected'),
        (error: unknown) => {
          expect(paletteAdvisorFailureReason(error)).toBe('unknown')
        }
      )
    })

    it('returns the resolved profile on a full allocate -> upload -> commit success', async () => {
      server.use(
        http.post(`${PALETTE_ROUTE}/selfie/upload-url`, () =>
          HttpResponse.json({
            data: {
              uploadSessionId: 'session-2',
              uploadUrl: `${window.location.origin}/mock-storage/selfie-session-2`,
              uploadToken: 'upload-token',
              requiredHeaders: { 'content-type': 'image/png' },
              expiresAt: '2026-09-04T17:00:00.000Z',
            },
          })
        ),
        http.put(`${window.location.origin}/mock-storage/selfie-session-2`, () =>
          HttpResponse.json({})
        ),
        http.post(`${PALETTE_ROUTE}/selfie/commit`, () => HttpResponse.json(profile()))
      )

      await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
        profile().data
      )
    })

    /**
     * Production follow-up 2026-11-19 (review round 2, Codex 6): one upload attempt keeps its
     * allocation and keys across retries. Choosing the same photo again commits first; the
     * bytes go out again only when commit reports them missing.
     */
    describe('retrying the same photo', () => {
      type Seen = { allocateKeys: string[]; puts: number; commitKeys: string[] }

      function selfieRoutes(commitAnswers: (() => Response)[]): Seen {
        const seen: Seen = { allocateKeys: [], puts: 0, commitKeys: [] }
        server.use(
          http.post(`${PALETTE_ROUTE}/selfie/upload-url`, ({ request }) => {
            seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
            return HttpResponse.json({
              data: {
                uploadSessionId: 'session-retry',
                uploadUrl: `${window.location.origin}/mock-storage/selfie-retry`,
                uploadToken: 'upload-token',
                requiredHeaders: { 'content-type': 'image/png' },
                expiresAt: '2026-09-04T17:00:00.000Z',
              },
            })
          }),
          http.put(`${window.location.origin}/mock-storage/selfie-retry`, () => {
            seen.puts += 1
            return HttpResponse.json({})
          }),
          http.post(`${PALETTE_ROUTE}/selfie/commit`, ({ request }) => {
            seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
            const answer = commitAnswers[seen.commitKeys.length - 1]
            if (!answer) throw new Error('unexpected commit')
            return answer()
          })
        )
        return seen
      }

      it('replays a commit whose answer was lost, with no second allocation or PUT', async () => {
        const seen = selfieRoutes([
          () => errorEnvelope(503, 'Service Unavailable'),
          () => HttpResponse.json(profile()),
        ])

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toThrow()
        // Picking the same photo again resumes the open attempt for these bytes with its keys.
        await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
          profile().data
        )

        expect(seen.allocateKeys).toHaveLength(1)
        expect(seen.puts).toBe(1)
        expect(seen.commitKeys).toEqual([seen.commitKeys[0], seen.commitKeys[0]])
      })

      it('keeps the attempt after UPLOAD_IN_PROGRESS, so the next pick commits again with its key', async () => {
        const seen = selfieRoutes([
          () => errorEnvelope(409, 'UPLOAD_IN_PROGRESS'),
          () => HttpResponse.json(profile()),
        ])

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toThrow()
        await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
          profile().data
        )

        expect(seen.allocateKeys).toHaveLength(1)
        expect(seen.puts).toBe(1)
        expect(seen.commitKeys).toEqual([seen.commitKeys[0], seen.commitKeys[0]])
      })

      it('re-sends the bytes only when commit reports them missing', async () => {
        const seen = selfieRoutes([
          () => errorEnvelope(503, 'Service Unavailable'),
          () => errorEnvelope(409, 'UPLOAD_BYTES_MISSING'),
          () => HttpResponse.json(profile()),
        ])

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toThrow()
        await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
          profile().data
        )

        expect(seen.allocateKeys).toHaveLength(1)
        expect(seen.puts).toBe(2)
        expect(new Set(seen.commitKeys).size).toBe(1)
        expect(seen.commitKeys).toHaveLength(3)
      })

      it('starts one fresh attempt in the same pick after a terminal answer, and a new one after a success', async () => {
        const seen = selfieRoutes([
          () => errorEnvelope(409, 'UPLOAD_SESSION_EXPIRED'),
          () => HttpResponse.json(profile()),
          () => HttpResponse.json(profile()),
        ])

        // The server ended the first attempt, so the same pick allocates, uploads and commits
        // once more with fresh keys.
        await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
          profile().data
        )
        expect(seen.allocateKeys).toHaveLength(2)
        expect(seen.puts).toBe(2)
        expect(seen.commitKeys).toHaveLength(2)

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
          profile().data
        )

        expect(seen.puts).toBe(3)
        expect(new Set(seen.allocateKeys).size).toBe(3)
        expect(new Set(seen.commitKeys).size).toBe(3)
      })

      // Learning path Step 58: Image uploads straight to storage.
      // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
      it.each([
        'IMAGE_CHECKSUM_MISMATCH',
        'IMAGE_DIMENSIONS_INVALID',
        'IMAGE_DECODE_FAILED',
      ])(
        'starts one fresh attempt in the same pick when commit rejects the resumed bytes with 400 %s',
        async (code) => {
          const seen = selfieRoutes([
            () => errorEnvelope(503, 'Service Unavailable'),
            () => errorEnvelope(400, code),
            () => HttpResponse.json(profile()),
          ])

          await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toThrow()
          // The selfie commit ended the session on 400; this same pick restarts with this
          // run's own bytes under fresh keys.
          await expect(uploadPaletteSelfieFromMobile(uploadInput())).resolves.toEqual(
            profile().data
          )

          expect(seen.allocateKeys).toHaveLength(2)
          expect(new Set(seen.allocateKeys).size).toBe(2)
          expect(seen.puts).toBe(2)
          expect(seen.commitKeys).toHaveLength(3)
          expect(seen.commitKeys[1]).toBe(seen.commitKeys[0])
          expect(seen.commitKeys[2]).not.toBe(seen.commitKeys[0])
        }
      )

      it('shows a 400 IMAGE_CHECKSUM_MISMATCH of the bytes the same run uploaded, with no restart', async () => {
        const seen = selfieRoutes([() => errorEnvelope(400, 'IMAGE_CHECKSUM_MISMATCH')])

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toSatisfy(
          (error: unknown) => paletteAdvisorFailureReason(error) === 'unknown'
        )

        expect(seen.allocateKeys).toHaveLength(1)
        expect(seen.puts).toBe(1)
        expect(seen.commitKeys).toHaveLength(1)
      })

      it('refuses a photo picked before the account changed, before any request', async () => {
        const seen = selfieRoutes([])
        setMobileApplicationUserId('member-a')
        const pickedUnderA = uploadInput()
        setMobileApplicationUserId('member-b')

        await expect(uploadPaletteSelfieFromMobile(pickedUnderA)).rejects.toBeInstanceOf(
          UploadSessionChangedError
        )

        expect(seen.allocateKeys).toHaveLength(0)
        expect(seen.puts).toBe(0)
      })

      it('refuses when resolving the bearer finds another account signed in', async () => {
        const seen = selfieRoutes([])
        setMobileApplicationUserId('member-a')
        const pickedUnderA = uploadInput()
        // Resolving the token is where the app notices the stored session now belongs to B.
        restoreAccessTokenResolver?.()
        restoreAccessTokenResolver = setMobileAccessTokenResolver(() => {
          setMobileApplicationUserId('member-b')
          return 'member-b-token'
        })

        await expect(uploadPaletteSelfieFromMobile(pickedUnderA)).rejects.toBeInstanceOf(
          UploadSessionChangedError
        )

        expect(seen.allocateKeys).toHaveLength(0)
        expect(seen.puts).toBe(0)
      })

      it('gives a different photo its own attempt and keys', async () => {
        const seen = selfieRoutes([
          () => errorEnvelope(503, 'Service Unavailable'),
          () => HttpResponse.json(profile()),
        ])

        await expect(uploadPaletteSelfieFromMobile(uploadInput())).rejects.toThrow()
        await expect(
          uploadPaletteSelfieFromMobile({ ...uploadInput(), sha256: 'b'.repeat(64) })
        ).resolves.toEqual(profile().data)

        expect(seen.puts).toBe(2)
        expect(new Set(seen.allocateKeys).size).toBe(2)
        expect(new Set(seen.commitKeys).size).toBe(2)
      })
    })
  })
})
