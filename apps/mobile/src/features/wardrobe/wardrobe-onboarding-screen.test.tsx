import React from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as NativeUtilsModule from '@/src/lib/native-utils'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('expo-router', () => ({
  router: routerMock,
  Stack: { Screen: () => null },
}))

const imagePicker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => imagePicker)

const imageManipulator = vi.hoisted(() => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))
vi.mock('expo-image-manipulator', () => imageManipulator)

vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array())
    }
  },
  Paths: { cache: 'file:///cache/' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(),
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
  }
})

vi.mock('@/src/lib/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof NativeUtilsModule>()
  return {
    ...actual,
    // Unlike WardrobeHubScreen (which takes an injectable `pollOffsetsMs`
    // prop), WardrobeOnboardingScreen's garment poll has no override, so
    // 4.4-MOB-ONB-14 would otherwise pay the real production 1s/2s/4s/8s
    // schedule -- the same class of real-wall-clock wait already fixed once
    // for silhouette-editor.test.tsx's 4.4-MOB-SIL-07 via an injectable prop.
    // Delegating to the real implementation with a near-zero delay keeps the
    // abort-signal contract faithful while making the test fast.
    waitForPoll: (_delayMs: number, signal: AbortSignal) => actual.waitForPoll(5, signal),
  }
})

import { createSuggestGarmentTagsDataFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { press } from '@/src/test-utils/press'
import { WardrobeOnboardingScreen } from './wardrobe-onboarding-screen'

/**
 * Base64url-shaped JWT payload so `resolveOwnerUserId` can decode a userId.
 * Built at runtime (not a literal) so it doesn't look like a credential to
 * secret scanners -- a hardcoded JWT-shaped string here previously tripped
 * gitleaks' generic-api-key rule in CI.
 */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('user-1')

const notStartedState = {
  status: 'not_started' as const,
  currentStep: 'permission' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 0,
  startedAt: null,
  completedAt: null,
  revision: 0,
}

// `onboardingStateSchema` enforces the API's cross-field invariants, so a
// mid-flow or completed state cannot be spelled by spreading
// `notStartedState`: `startedAt` is null only for the virtual `not_started`
// default, `not_started` only occurs at the permission step at revision 0,
// and `currentStep: 'complete'` holds exactly when `status` is `completed`
// with a `completedAt`. Seeding an impossible state makes the client reject
// the response, which surfaces as the screen never leaving its initial phase.
const inProgressState = {
  ...notStartedState,
  status: 'in_progress' as const,
  startedAt: '2026-08-09T00:00:00.000Z',
}

const completedState = {
  ...inProgressState,
  status: 'completed' as const,
  currentStep: 'complete' as const,
  completedAt: '2026-08-09T00:10:00.000Z',
  revision: 3,
}

// The default-mannequin silhouette profile MSW returns whenever a test
// advances to the silhouette step. Shared so the three call sites that need
// it can't drift from one another the way the fixed poller-offset bug did.
const defaultSilhouetteProfile = {
  mode: 'default_mannequin' as const,
  heightSlider: 50,
  buildSlider: 50,
  myForm: null,
  revision: 0,
  updatedAt: '2026-08-09T00:00:00.000Z',
}

const readyGarment = {
  id: 'garment-1',
  status: 'ready' as const,
  category: 'top' as const,
  material: 'cotton' as const,
  comfortRange: 'mild' as const,
  tagsConfirmedAt: '2026-08-09T00:01:00.000Z',
  fileSizeBytes: 1024,
  mimeType: 'image/png' as const,
  retentionStatus: 'active' as const,
  createdAt: '2026-08-09T00:00:00.000Z',
  committedAt: '2026-08-09T00:00:01.000Z',
  imageAccess: null,
}

function renderScreen() {
  render(
    <AccessibilityAnnouncerProvider>
      <WardrobeOnboardingScreen />
    </AccessibilityAnnouncerProvider>
  )
}

describe('WardrobeOnboardingScreen', () => {
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    }
    restoreAccessTokenResolver()
    routerMock.replace.mockClear()
    routerMock.push.mockClear()
    vi.clearAllMocks()
  })

  it('4.4-MOB-ONB-01 renders the permission step for a not_started user', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: notStartedState })
      )
    )
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-permission-step')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-ONB-02 redirects to the wardrobe hub when onboarding is already completed', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: completedState,
        })
      )
    )
    renderScreen()

    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith('/wardrobe')
    })
  })

  it('4.4-MOB-ONB-03 grants permission and advances to the capture step', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: notStartedState })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"onboarding:user-1:0"')
        expect(await request.json()).toEqual({ targetStep: 'capture' })
        return HttpResponse.json({
          data: { ...inProgressState, currentStep: 'capture', revision: 1 },
        })
      }),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('onboarding-request-permission'))

    fireEvent.click(screen.getByTestId('onboarding-request-permission'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-capture-step')).toBeInTheDocument()
    })
    expect(screen.getByTestId('onboarding-use-starter')).toBeInTheDocument()
  })

  it('4.4-MOB-ONB-04 shows a denial banner but still advances to the capture step', async () => {
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false })
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: notStartedState })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'capture', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('onboarding-request-permission'))

    fireEvent.click(screen.getByTestId('onboarding-request-permission'))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'You can still import files or use the starter wardrobe.'
      )
    })
  })

  it('4.4-MOB-ONB-05 skips straight to the silhouette step via the starter wardrobe', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'capture', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultSilhouetteProfile })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(await request.json()).toEqual({
          targetStep: 'silhouette',
          usedStarterWardrobe: true,
        })
        return HttpResponse.json({
          data: { ...inProgressState, currentStep: 'silhouette', revision: 2 },
        })
      })
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('onboarding-use-starter'))

    fireEvent.click(screen.getByTestId('onboarding-use-starter'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-silhouette-step')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-ONB-06 shows a checklist row and blocks Continue while a garment needs tags', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [{ ...readyGarment, status: 'awaiting_tags' }] })
      )
    )
    renderScreen()

    await waitFor(() => {
      expect(
        screen.getByTestId(`onboarding-checklist-${readyGarment.id}`)
      ).toHaveTextContent('needs tags')
    })
    expect(screen.getByTestId('onboarding-continue')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('4.4-MOB-ONB-07 enables Continue once every garment is tagged and advances to silhouette', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [readyGarment] })
      ),
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultSilhouetteProfile })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(await request.json()).toEqual({ targetStep: 'silhouette' })
        return HttpResponse.json({
          data: { ...inProgressState, currentStep: 'silhouette', revision: 2 },
        })
      })
    )
    renderScreen()
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-continue')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    fireEvent.click(screen.getByTestId('onboarding-continue'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-silhouette-step')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-ONB-08 resumes mid-flow after a reload with both the announcement and the checklist state', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [readyGarment] })
      )
    )
    renderScreen()

    await waitFor(() => {
      const liveRegion = document.getElementById('a11y-live-announcer')
      expect(liveRegion?.textContent).toBe('Picking up where you left off')
    })
    // AC1 requires resuming "at the same step with the same checklist
    // state" -- the announcement alone doesn't prove the checklist itself
    // came back; a regression that dropped listGarmentsFromMobile on resume
    // would still pass on the announcement check alone.
    await waitFor(() => {
      expect(
        screen.getByTestId(`onboarding-checklist-${readyGarment.id}`)
      ).toHaveTextContent('tags confirmed')
    })
  })

  it('4.4-MOB-ONB-08B never claims a still-processing garment is tagged, and keeps Continue disabled', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [{ ...readyGarment, status: 'processing' }] })
      )
    )
    renderScreen()

    await waitFor(() => {
      expect(
        screen.getByTestId(`onboarding-checklist-${readyGarment.id}`)
      ).toHaveTextContent('needs tags')
    })
    // A 'processing' garment previously satisfied the "no awaiting_tags
    // garments" check and let Continue advance before tagging was even
    // possible; only every garment reaching 'ready' may enable it.
    expect(screen.getByTestId('onboarding-continue')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    // 'processing' is also not tappable -- there's no suggestion data to
    // tag yet, unlike 'awaiting_tags'.
    expect(
      screen.queryByTestId(`onboarding-tag-${readyGarment.id}`)
    ).not.toBeInTheDocument()
  })

  it('4.4-MOB-ONB-09 surfaces a guardian-consent block for a teen actor', async () => {
    // Simulates the *outcome* a real guardian-consent-revoked teen actor
    // triggers (the API's 403 GUARDIAN_CONSENT_REQUIRED response) rather than
    // constructing a teen/guardian persona -- that decision lives server-side
    // (Task 3/4), out of this component test's scope.
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED', error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    renderScreen()

    await waitFor(() => {
      expect(
        screen.getByText('Guardian consent required for wardrobe uploads.')
      ).toBeInTheDocument()
    })
    expect(screen.getByTestId('onboarding-load-retry')).toBeInTheDocument()
  })

  it('4.4-MOB-ONB-10 shows an offline retry when the initial load fails', async () => {
    server.use(http.get('*/api/v1/wardrobe/onboarding', () => HttpResponse.error()))
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-load-retry')).toBeInTheDocument()
    })

    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: notStartedState })
      )
    )
    fireEvent.click(screen.getByTestId('onboarding-load-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-permission-step')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-ONB-11 reaches the completion step and returns to the wardrobe hub', async () => {
    // The completion step has to be advanced into rather than loaded: an
    // initial GET already at `complete` is necessarily `status: 'completed'`,
    // which the screen redirects straight to the hub (see 4.4-MOB-ONB-02).
    // Only the post-PATCH path renders it, which is what a real user hits.
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'silhouette', revision: 2 },
        })
      ),
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultSilhouetteProfile })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(await request.json()).toEqual({ targetStep: 'complete' })
        return HttpResponse.json({ data: completedState })
      })
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('onboarding-finish'))

    fireEvent.click(screen.getByTestId('onboarding-finish'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-complete-step')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('onboarding-done'))
    expect(routerMock.replace).toHaveBeenCalledWith('/wardrobe')
  })

  it('4.4-MOB-ONB-12 recovers from a stale revision by refreshing before retrying, instead of repeating the same 412 forever', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: notStartedState })
      )
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('onboarding-request-permission'))

    // The first PATCH races another device that already advanced the
    // revision: reject with a stale precondition.
    server.use(
      http.patch('*/api/v1/wardrobe/onboarding', ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"onboarding:user-1:0"')
        return HttpResponse.json(
          {
            statusCode: 412,
            message: 'ONBOARDING_REVISION_MISMATCH',
            error: 'Precondition Failed',
          },
          { status: 412 }
        )
      })
    )
    fireEvent.click(screen.getByTestId('onboarding-request-permission'))
    await waitFor(() => {
      expect(screen.getByText('ONBOARDING_REVISION_MISMATCH')).toBeInTheDocument()
    })

    // Retry must first pick up the revision the other device already
    // advanced to (a GET refresh), then resubmit with a live If-Match --
    // not blindly repeat the same stale header.
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: { ...inProgressState, revision: 5 } })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"onboarding:user-1:5"')
        expect(await request.json()).toEqual({ targetStep: 'capture' })
        return HttpResponse.json({
          data: { ...inProgressState, currentStep: 'capture', revision: 6 },
        })
      }),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    fireEvent.click(screen.getByTestId('onboarding-advance-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-capture-step')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-ONB-13 tags a garment from the checklist and unblocks Continue', async () => {
    // The checklist is the only place in onboarding where tagging can be
    // started, and Continue stays blocked until every garment is ready --
    // so the tagging round trip has to update the checklist in place.
    let garmentListReads = 0
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data: [{ ...readyGarment, status: 'awaiting_tags', category: null }],
        })
      }),
      http.post('*/api/v1/wardrobe/garments/:garmentId/suggest-tags', () =>
        HttpResponse.json({
          data: createSuggestGarmentTagsDataFixture({ garmentId: readyGarment.id }),
        })
      ),
      http.patch('*/api/v1/wardrobe/garments/:garmentId/tags', () =>
        HttpResponse.json({ data: readyGarment })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByTestId(`onboarding-tag-${readyGarment.id}`))
    fireEvent.click(screen.getByTestId(`onboarding-tag-${readyGarment.id}`))

    await screen.findByText('AI suggested: Top')
    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-save')).toBeEnabled()
    })
    press(screen.getByTestId('garment-tagging-save'))

    await waitFor(() => {
      expect(
        screen.getByTestId(`onboarding-checklist-${readyGarment.id}`)
      ).toHaveTextContent('tags confirmed')
    })
    expect(screen.getByTestId('onboarding-continue')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    // The checklist is updated from the tagging response, not by re-reading
    // the whole wardrobe.
    expect(garmentListReads).toBe(1)
  })

  it('4.4-MOB-ONB-14 keeps polling a garment captured during onboarding until it is tagged', async () => {
    // A garment that commits as `processing` has no tags yet; onboarding owns
    // the poll that turns it into a completed checklist row.
    let garmentListReads = 0
    imageManipulator.manipulateAsync.mockResolvedValue({
      uri: 'file:///cropped.png',
      width: 512,
      height: 512,
    })
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library-shot.png', width: 900, height: 900 }],
    })
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...inProgressState, currentStep: 'capture', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data:
            garmentListReads === 1 ? [] : [{ ...readyGarment, id: 'garment-processing' }],
        })
      }),
      http.post('*/api/v1/wardrobe/upload-url', () =>
        HttpResponse.json({
          data: {
            garmentId: 'garment-processing',
            uploadSessionId: 'session-1',
            uploadUrl: `${window.location.origin}/mock-storage/session-1`,
            uploadToken: 'upload-token-1',
            requiredHeaders: { 'content-type': 'image/png' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      ),
      http.put('*/mock-storage/session-1', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({
          data: { ...readyGarment, id: 'garment-processing', status: 'processing' },
        })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByTestId('onboarding-add-garment'))
    fireEvent.click(screen.getByTestId('onboarding-add-garment'))
    await waitFor(() => screen.getByTestId('garment-source-library'))
    fireEvent.click(screen.getByTestId('garment-source-library'))
    await waitFor(() => screen.getByTestId('garment-crop-preview'))
    fireEvent.click(screen.getByTestId('garment-confirm-image'))
    await waitFor(() => screen.getByTestId('garment-capture-complete'))
    fireEvent.click(screen.getByTestId('garment-capture-done'))

    // The `native-utils` mock above collapses the production 1s/2s/4s/8s
    // poll schedule to a few ms, so this resolves almost immediately; the
    // generous timeout is just a safety margin, not an expected wait.
    await waitFor(() => {
      expect(
        screen.getByTestId('onboarding-checklist-garment-processing')
      ).toHaveTextContent('tags confirmed')
    })
  })
})
