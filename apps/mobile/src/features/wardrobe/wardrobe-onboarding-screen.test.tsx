import React from 'react'
import type * as ReactNativeModule from 'react-native'
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

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))

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

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
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
          data: { ...notStartedState, status: 'completed', currentStep: 'complete' },
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
          data: { ...notStartedState, currentStep: 'capture', revision: 1 },
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
          data: { ...notStartedState, currentStep: 'capture', revision: 1 },
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
          data: { ...notStartedState, currentStep: 'capture', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
            revision: 0,
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(await request.json()).toEqual({
          targetStep: 'silhouette',
          usedStarterWardrobe: true,
        })
        return HttpResponse.json({
          data: { ...notStartedState, currentStep: 'silhouette', revision: 2 },
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
          data: { ...notStartedState, currentStep: 'tagging', revision: 1 },
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
          data: { ...notStartedState, currentStep: 'tagging', revision: 1 },
        })
      ),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [readyGarment] })
      ),
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
            revision: 0,
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(await request.json()).toEqual({ targetStep: 'silhouette' })
        return HttpResponse.json({
          data: { ...notStartedState, currentStep: 'silhouette', revision: 2 },
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
          data: { ...notStartedState, currentStep: 'tagging', revision: 1 },
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
          data: { ...notStartedState, currentStep: 'tagging', revision: 1 },
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
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: { ...notStartedState, currentStep: 'complete', revision: 3 },
        })
      )
    )
    renderScreen()

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
        HttpResponse.json({ data: { ...notStartedState, revision: 5 } })
      ),
      http.patch('*/api/v1/wardrobe/onboarding', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"onboarding:user-1:5"')
        expect(await request.json()).toEqual({ targetStep: 'capture' })
        return HttpResponse.json({
          data: { ...notStartedState, currentStep: 'capture', revision: 6 },
        })
      }),
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] }))
    )
    fireEvent.click(screen.getByTestId('onboarding-advance-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-capture-step')).toBeInTheDocument()
    })
  })
})
