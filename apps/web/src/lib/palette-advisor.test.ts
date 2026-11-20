// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 5.4 Task 7 owner: the web palette advisor client.
//
// The panel's tests cover what each state renders. These cover the one thing the panel
// cannot see: how a rejection is classified. Both 403 shapes, the 409 and the 503 are
// distinguished only by the server's own message constants, and getting that wrong is
// how a consent gate turns into an upsell (or the reverse) with no visible error.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  UploadSessionChangedError,
} from '@couture/api-client/contracts/http'
import type * as WardrobeModule from './wardrobe'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  currentUploadSession,
  forgetAllUploadAttempts,
  setUploadAttemptAccount,
} from './upload-attempts'
import {
  analyzeWardrobePaletteFromWeb,
  erasePaletteAdvisorFromWeb,
  getPaletteAdvisorFromWeb,
  paletteAdvisorFailureReason,
  setPaletteConsentFromWeb,
  uploadPaletteSelfieFromWeb,
} from './palette-advisor'

const PALETTE_PATH = '/api/v1/commerce/premium/palette'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// Canvas is not implemented in jsdom, so the one genuinely browser-only step of the
// upload is replaced. Everything downstream of it (the allocate call, the header the
// bytes go up with, the commit body and the idempotency keys of both requests)
// is the real code path.
vi.mock('./wardrobe', async (importOriginal) => {
  const actual = await importOriginal<typeof WardrobeModule>()
  return {
    ...actual,
    prepareGarmentImage: vi.fn(() =>
      Promise.resolve({
        blob: new Blob(['selfie-bytes'], { type: 'image/jpeg' }),
        widthPx: 1024,
        heightPx: 1365,
        mimeType: 'image/jpeg' as const,
        sha256: 'a'.repeat(64),
      })
    ),
  }
})

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function errorBody(statusCode: number, message: string, error: string) {
  return HttpResponse.json({ statusCode, message, error }, { status: statusCode })
}

const profileBody = {
  data: {
    profileId: 'palette-profile-1',
    isEntitled: true,
    analysisEnabled: true,
    hasConsent: true,
    analysis: null,
    recommendations: [],
  },
}

describe('web palette advisor client (Story 5.4)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    // Every selfie here prepares to the same bytes, and open attempts live for the whole tab.
    setUploadAttemptAccount(null)
    forgetAllUploadAttempts()
  })

  it('5.4-WEB-001 classifies a call with no session as signed_out without a request', async () => {
    await expect(getPaletteAdvisorFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'signed_out'
    )
  })

  it('5.4-WEB-002 classifies 401 as signed_out', async () => {
    signIn()
    useMswHandlers(http.get(PALETTE_PATH, () => errorBody(401, 'nope', 'Unauthorized')))

    await expect(getPaletteAdvisorFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'signed_out'
    )
  })

  /**
   * The two 403s are the whole reason this module classifies on the message rather
   * than the status alone. `PremiumEntitlementGuard` runs pre-handler and the consent
   * check runs in the service body, so the pair is deterministic (Decision 10). Only
   * the message distinguishes them on the wire.
   */
  it('5.4-WEB-003 separates the consent 403 from the entitlement 403', async () => {
    signIn()
    useMswHandlers(
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(403, PALETTE_CONSENT_REQUIRED_MESSAGE, 'Forbidden')
      )
    )
    await expect(analyzeWardrobePaletteFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'no_consent'
    )

    useMswHandlers(
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(403, PREMIUM_REQUIRED_MESSAGE, 'Forbidden')
      )
    )
    await expect(analyzeWardrobePaletteFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'not_entitled'
    )
  })

  /** An unrecognised 403 reads as `not_entitled`: the locked panel, never a consent invite. */
  it('5.4-WEB-004 falls back to not_entitled on an unrecognised 403', async () => {
    signIn()
    useMswHandlers(
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(403, 'GUARDIAN_CONSENT_REQUIRED', 'Forbidden')
      )
    )

    await expect(analyzeWardrobePaletteFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'not_entitled'
    )
  })

  it('5.4-WEB-005 classifies 409 as in_progress and 503 as analysis_disabled', async () => {
    signIn()
    useMswHandlers(
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(409, PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE, 'Conflict')
      )
    )
    await expect(analyzeWardrobePaletteFromWeb()).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'in_progress'
    )

    useMswHandlers(
      http.post(`${PALETTE_PATH}/consent`, () =>
        errorBody(503, PALETTE_ANALYSIS_DISABLED_MESSAGE, 'Service Unavailable')
      )
    )
    await expect(setPaletteConsentFromWeb(true)).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'analysis_disabled'
    )
  })

  it('5.4-WEB-006 carries the server message for logs while keeping the reason for the UI', async () => {
    signIn()
    useMswHandlers(
      http.post(`${PALETTE_PATH}/analyze`, () =>
        errorBody(403, PALETTE_CONSENT_REQUIRED_MESSAGE, 'Forbidden')
      )
    )

    await expect(analyzeWardrobePaletteFromWeb()).rejects.toThrow(
      PALETTE_CONSENT_REQUIRED_MESSAGE
    )
  })

  it('5.4-WEB-007 erases through DELETE, which mounts no entitlement guard', async () => {
    signIn()
    let method: string | null = null
    useMswHandlers(
      http.delete(PALETTE_PATH, ({ request }) => {
        method = request.method
        return HttpResponse.json(profileBody)
      })
    )

    const result = await erasePaletteAdvisorFromWeb()

    expect(method).toBe('DELETE')
    expect(result.profileId).toBe('palette-profile-1')
  })

  /**
   * AC 3, and the bug story 4.3's review found: the attempt's keys cover the whole upload, and
   * a retry reuses them and replays the first session (see 5.4-WEB-010).
   */
  const SIGNED_SELFIE_UPLOAD_URL =
    'http://127.0.0.1:54321/storage/v1/object/upload/sign/wardrobe-images/users/user-1/palette/session-1.jpg'

  it('5.4-WEB-008 sends UUID idempotency keys on allocate and commit', async () => {
    signIn()
    const seen: Record<string, string | null> = {}
    let bytesHeaders: Record<string, string> = {}
    useMswHandlers(
      http.post(`${PALETTE_PATH}/selfie/upload-url`, ({ request }) => {
        seen.allocate = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: {
            uploadSessionId: 'session-1',
            // A storage signed upload URL: the bytes go straight there, as given, and never
            // through an API function (production follow-up 2026-11-19).
            uploadUrl: `${SIGNED_SELFIE_UPLOAD_URL}?token=signed-upload-token`,
            uploadToken: 'upload-token',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-25T10:15:00.000Z',
          },
        })
      }),
      http.put(SIGNED_SELFIE_UPLOAD_URL, ({ request }) => {
        bytesHeaders = Object.fromEntries(request.headers.entries())
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${PALETTE_PATH}/selfie/commit`, async ({ request }) => {
        seen.commit = request.headers.get('idempotency-key')
        seen.body = JSON.stringify(await request.json())
        return HttpResponse.json(profileBody)
      })
    )

    const states: string[] = []
    await uploadPaletteSelfieFromWeb({
      imagePreview: 'blob:selfie',
      uploadSession: currentUploadSession(),
      onStateChange: (state) => states.push(state),
    })

    expect(seen.allocate).toMatch(UUID_V4)
    expect(seen.commit).toMatch(UUID_V4)
    expect(seen.body).toBe(JSON.stringify({ uploadSessionId: 'session-1' }))
    expect(bytesHeaders['x-upload-token']).toBe('upload-token')
    expect(bytesHeaders['content-type']).toBe('image/jpeg')
    expect(states).toEqual(['preparing', 'requesting_upload', 'uploading', 'committing'])
  })

  /**
   * Review round 2 (C2-6): one selfie attempt keeps its session and key across retries. A retry
   * commits first and re-sends the bytes only after commit answers UPLOAD_BYTES_MISSING.
   */
  function useSelfieLegHandlers(
    commitAnswers: (() => Response)[],
    putAnswers: (() => Response)[]
  ) {
    const counts = { allocate: 0, put: 0, commit: 0 }
    const allocateKeys: (string | null)[] = []
    const commitKeys: (string | null)[] = []
    useMswHandlers(
      http.post(`${PALETTE_PATH}/selfie/upload-url`, ({ request }) => {
        counts.allocate += 1
        allocateKeys.push(request.headers.get('idempotency-key'))
        return HttpResponse.json({
          data: {
            uploadSessionId: 'session-retry',
            uploadUrl: `${SIGNED_SELFIE_UPLOAD_URL}?token=signed-upload-token`,
            uploadToken: 'upload-token',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-25T10:15:00.000Z',
          },
        })
      }),
      http.put(SIGNED_SELFIE_UPLOAD_URL, () => {
        counts.put += 1
        const answer = putAnswers.shift()
        if (!answer) throw new Error('No PUT answer left')
        return answer()
      }),
      http.post(`${PALETTE_PATH}/selfie/commit`, ({ request }) => {
        counts.commit += 1
        commitKeys.push(request.headers.get('idempotency-key'))
        const answer = commitAnswers.shift()
        if (!answer) throw new Error('No commit answer left')
        return answer()
      })
    )
    return { counts, allocateKeys, commitKeys }
  }

  it('5.4-WEB-010 replays a lost commit answer with the same key and no second allocation or PUT', async () => {
    signIn()
    const { counts, commitKeys } = useSelfieLegHandlers(
      [() => HttpResponse.error(), () => HttpResponse.json(profileBody)],
      [() => new HttpResponse(null, { status: 204 })]
    )

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: currentUploadSession(),
      })
    ).rejects.toThrow()
    await uploadPaletteSelfieFromWeb({
      imagePreview: 'blob:selfie',
      uploadSession: currentUploadSession(),
    })

    expect(counts).toEqual({ allocate: 1, put: 1, commit: 2 })
    expect(commitKeys).toEqual([commitKeys[0], commitKeys[0]])
  })

  it('5.4-WEB-011 re-sends the bytes on a retry only after commit answers UPLOAD_BYTES_MISSING', async () => {
    signIn()
    const { counts } = useSelfieLegHandlers(
      [
        () => errorBody(409, 'UPLOAD_BYTES_MISSING', 'Conflict'),
        () => HttpResponse.json(profileBody),
      ],
      [
        () => new HttpResponse(null, { status: 503 }),
        () => new HttpResponse(null, { status: 204 }),
      ]
    )

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: currentUploadSession(),
      })
    ).rejects.toThrow()
    await uploadPaletteSelfieFromWeb({
      imagePreview: 'blob:selfie',
      uploadSession: currentUploadSession(),
    })

    expect(counts).toEqual({ allocate: 1, put: 2, commit: 2 })
  })

  /**
   * The server ended the attempt (its session expired), so the same call starts one fresh
   * attempt at once: a new allocation and new keys, the bytes again, and a commit that succeeds.
   * The member never has to pick the photo a second time.
   */
  it('5.4-WEB-012 starts one fresh attempt in the same call after the server ended the first', async () => {
    signIn()
    const { counts, allocateKeys, commitKeys } = useSelfieLegHandlers(
      [
        () => errorBody(409, 'UPLOAD_SESSION_EXPIRED', 'Conflict'),
        () => HttpResponse.json(profileBody),
      ],
      [
        () => new HttpResponse(null, { status: 204 }),
        () => new HttpResponse(null, { status: 204 }),
      ]
    )

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: currentUploadSession(),
      })
    ).resolves.toEqual(profileBody.data)

    expect(counts).toEqual({ allocate: 2, put: 2, commit: 2 })
    expect(allocateKeys[0]).toMatch(UUID_V4)
    expect(allocateKeys[1]).toMatch(UUID_V4)
    expect(allocateKeys[1]).not.toBe(allocateKeys[0])
    expect(commitKeys[1]).toMatch(UUID_V4)
    expect(commitKeys[1]).not.toBe(commitKeys[0])
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it.each(['IMAGE_CHECKSUM_MISMATCH', 'IMAGE_DIMENSIONS_INVALID', 'IMAGE_DECODE_FAILED'])(
    'restarts a resumed attempt in the same call when commit rejects the staged bytes with 400 %s',
    async (code) => {
      signIn()
      const { counts, allocateKeys, commitKeys } = useSelfieLegHandlers(
        [
          () => HttpResponse.error(),
          () => errorBody(400, code, 'Bad Request'),
          () => HttpResponse.json(profileBody),
        ],
        [
          () => new HttpResponse(null, { status: 204 }),
          () => new HttpResponse(null, { status: 204 }),
        ]
      )
      const pick = () =>
        uploadPaletteSelfieFromWeb({
          imagePreview: 'blob:selfie',
          uploadSession: currentUploadSession(),
        })

      await expect(pick()).rejects.toThrow()
      // The selfie commit ended the session on 400; this same pick restarts with fresh keys.
      await expect(pick()).resolves.toEqual(profileBody.data)

      expect(counts).toEqual({ allocate: 2, put: 2, commit: 3 })
      expect(allocateKeys[1]).not.toBe(allocateKeys[0])
      expect(commitKeys[1]).toBe(commitKeys[0])
      expect(commitKeys[2]).not.toBe(commitKeys[0])
    }
  )

  it('shows a 400 IMAGE_CHECKSUM_MISMATCH of the bytes the same call uploaded, with no restart', async () => {
    signIn()
    const { counts } = useSelfieLegHandlers(
      [() => errorBody(400, 'IMAGE_CHECKSUM_MISMATCH', 'Bad Request')],
      [() => new HttpResponse(null, { status: 204 })]
    )

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: currentUploadSession(),
      })
    ).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'unknown'
    )

    expect(counts).toEqual({ allocate: 1, put: 1, commit: 1 })
  })

  it('refuses a selfie picked under another account before any request', async () => {
    signIn()
    const { counts } = useSelfieLegHandlers([], [])
    setUploadAttemptAccount('member-a')
    const pickedUnderA = currentUploadSession()
    setUploadAttemptAccount('member-b')

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: pickedUnderA,
      })
    ).rejects.toBeInstanceOf(UploadSessionChangedError)

    expect(counts).toEqual({ allocate: 0, put: 0, commit: 0 })
  })

  it('5.4-WEB-009 classifies an upload rejection rather than surfacing its text', async () => {
    signIn()
    useMswHandlers(
      http.post(`${PALETTE_PATH}/selfie/upload-url`, () =>
        errorBody(403, PALETTE_CONSENT_REQUIRED_MESSAGE, 'Forbidden')
      )
    )

    await expect(
      uploadPaletteSelfieFromWeb({
        imagePreview: 'blob:selfie',
        uploadSession: currentUploadSession(),
      })
    ).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'no_consent'
    )
  })
})
