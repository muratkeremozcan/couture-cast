// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
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
} from '@couture/api-client/contracts/http'
import type * as WardrobeModule from './wardrobe'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  analyzeWardrobePaletteFromWeb,
  erasePaletteAdvisorFromWeb,
  getPaletteAdvisorFromWeb,
  paletteAdvisorFailureReason,
  setPaletteConsentFromWeb,
  uploadPaletteSelfieFromWeb,
} from './palette-advisor'

const PALETTE_PATH = '/api/v1/commerce/premium/palette'

// Canvas is not implemented in jsdom, so the one genuinely browser-only step of the
// upload is replaced. Everything downstream of it (the allocate call, the header the
// bytes go up with, the commit body and the idempotency key shared by both requests)
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
   * AC 3, and the bug story 4.3's review found: one idempotency key covers the whole
   * upload attempt. A fresh key per request would allocate a second upload session on
   * every retry instead of replaying the first.
   */
  it('5.4-WEB-008 reuses one idempotency key across allocate and commit', async () => {
    signIn()
    const seen: Record<string, string | null> = {}
    let bytesHeaders: Record<string, string> = {}
    useMswHandlers(
      http.post(`${PALETTE_PATH}/selfie/upload-url`, ({ request }) => {
        seen.allocate = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: {
            uploadSessionId: 'session-1',
            uploadUrl:
              'http://localhost/api/v1/commerce/premium/palette/selfie/uploads/session-1',
            uploadToken: 'upload-token',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-25T10:15:00.000Z',
          },
        })
      }),
      http.put(
        'http://localhost/api/v1/commerce/premium/palette/selfie/uploads/session-1',
        ({ request }) => {
          bytesHeaders = Object.fromEntries(request.headers.entries())
          return new HttpResponse(null, { status: 204 })
        }
      ),
      http.post(`${PALETTE_PATH}/selfie/commit`, async ({ request }) => {
        seen.commit = request.headers.get('idempotency-key')
        seen.body = JSON.stringify(await request.json())
        return HttpResponse.json(profileBody)
      })
    )

    const states: string[] = []
    await uploadPaletteSelfieFromWeb({
      imagePreview: 'blob:selfie',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      onStateChange: (state) => states.push(state),
    })

    expect(seen.allocate).toBe('11111111-1111-4111-8111-111111111111')
    expect(seen.commit).toBe(seen.allocate)
    expect(seen.body).toBe(JSON.stringify({ uploadSessionId: 'session-1' }))
    expect(bytesHeaders['x-upload-token']).toBe('upload-token')
    expect(bytesHeaders['content-type']).toBe('image/jpeg')
    expect(states).toEqual(['preparing', 'requesting_upload', 'uploading', 'committing'])
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
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      })
    ).rejects.toSatisfy(
      (error: unknown) => paletteAdvisorFailureReason(error) === 'no_consent'
    )
  })
})
