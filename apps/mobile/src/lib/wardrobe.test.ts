import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { server } from '../test-utils/msw/server'
import {
  commitSilhouettePhotoFromMobile,
  createSilhouetteUploadUrlFromMobile,
  deleteSilhouettePhotoFromMobile,
  getSilhouetteProfileFromMobile,
  getWardrobeOnboardingStateFromMobile,
  onboardingETag,
  pollGarmentUntilSettled,
  silhouetteETag,
  updateSilhouetteSlidersFromMobile,
  updateWardrobeOnboardingStateFromMobile,
} from './wardrobe'

function garmentFixture(overrides: { id: string; status: string }) {
  return {
    id: overrides.id,
    status: overrides.status,
    category: null,
    material: null,
    comfortRange: null,
    tagsConfirmedAt: null,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-09T00:00:00.000Z',
    committedAt: '2026-08-09T00:00:01.000Z',
    imageAccess: null,
  }
}

const onboardingState = {
  status: 'in_progress' as const,
  currentStep: 'capture' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 1,
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
  revision: 1,
}

const silhouetteProfile = {
  mode: 'default_mannequin' as const,
  heightSlider: 50,
  buildSlider: 50,
  myForm: null,
  revision: 1,
  updatedAt: '2026-08-09T00:00:00.000Z',
}

describe('mobile wardrobe onboarding + silhouette API wrappers', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('4.4-MOB-LIB-01 builds the documented onboarding ETag format', () => {
    expect(onboardingETag('user-1', 0)).toBe('"onboarding:user-1:0"')
  })

  it('4.4-MOB-LIB-02 builds the analogous silhouette ETag format', () => {
    expect(silhouetteETag('user-1', 3)).toBe('"silhouette:user-1:3"')
  })

  it('4.4-MOB-LIB-03 reads onboarding state', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingState })
      )
    )

    const result = await getWardrobeOnboardingStateFromMobile('token')
    expect(result).toEqual(onboardingState)
  })

  it('4.4-MOB-LIB-04 advances the onboarding step machine with If-Match', async () => {
    server.use(
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"onboarding:user-1:0"')
        expect(await request.json()).toEqual({ targetStep: 'capture' })
        return HttpResponse.json({ data: { ...onboardingState, currentStep: 'capture' } })
      })
    )

    const result = await updateWardrobeOnboardingStateFromMobile(
      'token',
      { targetStep: 'capture' },
      '"onboarding:user-1:0"'
    )
    expect(result.currentStep).toBe('capture')
  })

  it('4.4-MOB-LIB-05 surfaces the guardian-consent-required message on a 403', async () => {
    server.use(
      http.patch('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED', error: 'Forbidden' },
          { status: 403 }
        )
      )
    )

    await expect(
      updateWardrobeOnboardingStateFromMobile(
        'token',
        { targetStep: 'capture' },
        '"onboarding:user-1:0"'
      )
    ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
  })

  it('4.4-MOB-LIB-06 reads the silhouette profile', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: silhouetteProfile })
      )
    )

    const result = await getSilhouetteProfileFromMobile('token')
    expect(result).toEqual(silhouetteProfile)
  })

  it('4.4-MOB-LIB-07 saves slider values with If-Match', async () => {
    server.use(
      http.put('*/api/v1/wardrobe/silhouette', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"silhouette:user-1:1"')
        expect(await request.json()).toEqual({ heightSlider: 70, buildSlider: 40 })
        return HttpResponse.json({
          data: { ...silhouetteProfile, heightSlider: 70, buildSlider: 40, revision: 2 },
        })
      })
    )

    const result = await updateSilhouetteSlidersFromMobile(
      'token',
      { heightSlider: 70, buildSlider: 40 },
      '"silhouette:user-1:1"'
    )
    expect(result.heightSlider).toBe(70)
    expect(result.revision).toBe(2)
  })

  it('4.4-MOB-LIB-08 allocates a My Form upload session', async () => {
    server.use(
      http.post('*/api/v1/wardrobe/silhouette/my-form/upload-url', ({ request }) => {
        expect(request.headers.get('idempotency-key')).toBe('idem-1')
        return HttpResponse.json(
          {
            data: {
              uploadSessionId: 'session-1',
              uploadUrl: `${window.location.origin}/mock-storage/session-1`,
              uploadToken: 'upload-token-1',
              requiredHeaders: { 'content-type': 'image/png' },
              expiresAt: '2026-08-09T01:00:00.000Z',
            },
          },
          { status: 201 }
        )
      })
    )

    const result = await createSilhouetteUploadUrlFromMobile(
      'token',
      {
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
        widthPx: 800,
        heightPx: 1200,
      },
      'idem-1'
    )
    expect(result.uploadSessionId).toBe('session-1')
  })

  it('4.4-MOB-LIB-09 commits the My Form photo', async () => {
    server.use(
      http.post('*/api/v1/wardrobe/silhouette/my-form/commit', () =>
        HttpResponse.json({
          data: {
            ...silhouetteProfile,
            mode: 'my_form',
            myForm: {
              status: 'processing',
              failureReason: null,
              committedAt: '2026-08-09T00:05:00.000Z',
              imageAccess: null,
            },
          },
        })
      )
    )

    const result = await commitSilhouettePhotoFromMobile(
      'token',
      { uploadSessionId: 'session-1', confirmsBasewearGuidance: true },
      'idem-2'
    )
    expect(result.myForm?.status).toBe('processing')
  })

  it('4.4-MOB-LIB-10 hard-deletes the My Form photo', async () => {
    server.use(
      http.delete('*/api/v1/wardrobe/silhouette/my-form', ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"silhouette:user-1:2"')
        return HttpResponse.json({
          data: { ...silhouetteProfile, mode: 'default_mannequin', myForm: null },
        })
      })
    )

    const result = await deleteSilhouettePhotoFromMobile('token', '"silhouette:user-1:2"')
    expect(result.mode).toBe('default_mannequin')
  })
})

describe('pollGarmentUntilSettled', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('4.4-MOB-LIB-11 resolves once the garment leaves processing, reporting every tick', async () => {
    let call = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        call += 1
        const status = call < 3 ? 'processing' : 'awaiting_tags'
        return HttpResponse.json({ data: [garmentFixture({ id: 'g-1', status })] })
      })
    )
    const updates: string[][] = []
    const controller = new AbortController()

    const settled = await pollGarmentUntilSettled(
      'token',
      'g-1',
      controller.signal,
      (garments) => updates.push(garments.map((g) => g.status)),
      [1, 1, 1, 1]
    )

    expect(settled?.status).toBe('awaiting_tags')
    expect(updates).toEqual([['processing'], ['processing'], ['awaiting_tags']])
  })

  it('4.4-MOB-LIB-12 gives up once the schedule is exhausted while still processing', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture({ id: 'g-1', status: 'processing' })] })
      )
    )
    const controller = new AbortController()

    const settled = await pollGarmentUntilSettled(
      'token',
      'g-1',
      controller.signal,
      () => undefined,
      [1, 1]
    )

    expect(settled).toBeUndefined()
  })

  it('4.4-MOB-LIB-13 stops immediately if the garment disappears from the list', async () => {
    let call = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        call += 1
        return HttpResponse.json({ data: [] })
      })
    )
    const controller = new AbortController()

    const settled = await pollGarmentUntilSettled(
      'token',
      'g-1',
      controller.signal,
      () => undefined,
      [1, 1, 1, 1]
    )

    expect(settled).toBeUndefined()
    expect(call).toBe(1)
  })
})
