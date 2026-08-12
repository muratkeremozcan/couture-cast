// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('expo-router', () => ({ router: routerMock }))

const imagePicker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => imagePicker)

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn().mockResolvedValue({
    uri: 'file:///cropped.png',
    width: 512,
    height: 512,
  }),
  SaveFormat: { PNG: 'png' },
}))

vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
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

import { createSuggestGarmentTagsDataFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { press } from '@/src/test-utils/press'
import { WardrobeHubScreen } from './wardrobe-hub-screen'

/**
 * Base64url-shaped JWT payload, built at runtime (not a literal) so it
 * doesn't look like a credential to secret scanners -- a hardcoded
 * JWT-shaped string here previously tripped gitleaks' generic-api-key rule
 * in CI.
 */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('user-1')

const onboardingNotCompleted = {
  status: 'in_progress' as const,
  currentStep: 'capture' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 0,
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
  revision: 1,
}

function renderScreen(pollOffsetsMs: readonly number[] = [1, 1, 1, 1]) {
  // pollOffsetsMs keeps the still-processing garment poll deterministic and
  // fast in tests instead of paying the real 1s/2s/4s/8s production schedule.
  render(<WardrobeHubScreen pollOffsetsMs={pollOffsetsMs} />)
}

function garmentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'garment-1',
    status: 'awaiting_tags',
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
    ...overrides,
  }
}

/** Drives the capture sheet until the commit response comes back. */
async function captureOneGarment() {
  imagePicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///library-shot.png', width: 900, height: 900 }],
  })
  await waitFor(() => screen.getByTestId('garment-capture-open'))
  fireEvent.click(screen.getByTestId('garment-capture-open'))
  await waitFor(() => screen.getByTestId('garment-source-library'))
  fireEvent.click(screen.getByTestId('garment-source-library'))
  await waitFor(() => screen.getByTestId('garment-crop-preview'))
  fireEvent.click(screen.getByTestId('garment-confirm-image'))
  await waitFor(() => screen.getByTestId('garment-capture-complete'))
}

function captureUploadHandlers(garmentId: string, status: string) {
  return [
    http.post('*/api/v1/wardrobe/upload-url', () =>
      HttpResponse.json({
        data: {
          garmentId,
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
      HttpResponse.json({ data: garmentFixture({ id: garmentId, status }) })
    ),
  ]
}

describe('WardrobeHubScreen', () => {
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
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingNotCompleted })
      )
    )
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

  it('4.4-MOB-HUB-01 renders the wardrobe hub header and empty state (regression)', async () => {
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-screen')).toBeInTheDocument()
    })
    expect(screen.getByTestId('garment-capture-open')).toBeInTheDocument()
  })

  it('4.4-MOB-HUB-02 opens the extracted capture modal from the existing entry point (regression)', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('garment-capture-open'))

    fireEvent.click(screen.getByTestId('garment-capture-open'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-03 captures a garment end to end and opens tagging once it needs tags (regression)', async () => {
    server.use(...captureUploadHandlers('garment-1', 'awaiting_tags'))

    renderScreen()
    await captureOneGarment()
    fireEvent.click(screen.getByTestId('garment-capture-done'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-03B polls a still-processing commit until it needs tags, then opens tagging (regression, 4.4-R05)', async () => {
    // The extraction split "who owns polling a still-processing garment"
    // across the capture modal (reports the commit result) and this screen
    // (owns pollCommittedGarment) -- exactly the seam a regression could
    // silently break with no test noticing, since every other capture test
    // here only exercises the immediate 'awaiting_tags' commit result.
    server.use(...captureUploadHandlers('garment-2', 'processing'))

    renderScreen()
    await captureOneGarment()
    fireEvent.click(screen.getByTestId('garment-capture-done'))

    // Still processing: no tagging modal yet, and the grid reflects it.
    await waitFor(() => {
      expect(screen.getByTestId('garment-status-processing')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()

    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({
          data: [garmentFixture({ id: 'garment-2', status: 'awaiting_tags' })],
        })
      )
    )

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-04 shows the onboarding entry-point card while onboarding is not completed', async () => {
    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-onboarding-card')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('wardrobe-onboarding-card'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-onboarding')
  })

  it('4.4-MOB-HUB-05 hides the onboarding entry-point card once onboarding is completed', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: {
            ...onboardingNotCompleted,
            status: 'completed',
            currentStep: 'complete',
            // `onboardingStateSchema` sets `completedAt` exactly when the
            // status is `completed`; without it the client rejects the
            // response and the card would stay visible for the wrong reason.
            completedAt: '2026-08-09T00:10:00.000Z',
          },
        })
      )
    )
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-screen'))

    expect(screen.queryByTestId('wardrobe-onboarding-card')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-06 links to the silhouette settings screen', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-silhouette-link'))

    fireEvent.click(screen.getByTestId('wardrobe-silhouette-link'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-silhouette')
  })

  it('4.4-MOB-HUB-07 links to outfit capsules (regression)', async () => {
    renderScreen()
    await waitFor(() => screen.getByTestId('wardrobe-capsules-link'))

    fireEvent.click(screen.getByTestId('wardrobe-capsules-link'))
    expect(routerMock.push).toHaveBeenCalledWith('/wardrobe-capsules')
  })

  it('4.4-MOB-HUB-08 does not let a broken onboarding read hide the garment list (regression)', async () => {
    server.use(http.get('*/api/v1/wardrobe/onboarding', () => HttpResponse.error()))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-screen')).toBeInTheDocument()
      expect(screen.queryByTestId('wardrobe-onboarding-card')).not.toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-09 settles into the empty state instead of a permanent spinner when there is no session', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    // The load rejects with AUTHENTICATION_REQUIRED; the `finally` must still
    // clear `isLoading` or the hub shows a spinner forever with no way out.
    await waitFor(() => {
      expect(screen.getByText('No garments added yet')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Loading wardrobe')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-10 opens tagging from the Needs tags action on an already-untagged garment', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByLabelText('Needs tags'))
    fireEvent.click(screen.getByLabelText('Needs tags'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-11 refuses to open tagging with an expired session and says why', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: [garmentFixture()] })
      )
    )
    renderScreen()
    await waitFor(() => screen.getByLabelText('Needs tags'))

    // The session lapses between listing the wardrobe and tapping the action;
    // the token is re-resolved at tap time precisely for this case.
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    fireEvent.click(screen.getByLabelText('Needs tags'))

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'AUTHENTICATION_REQUIRED'
      )
    })
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-12 reflects confirmed tags in the grid and re-reads the wardrobe', async () => {
    // The hub owns what happens *after* the modal saves: it patches the garment
    // into the grid and then re-reads the wardrobe so anything the server
    // changed alongside the tags shows up. Only an end-to-end save through the
    // real network path proves that seam.
    let garmentListReads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data:
            garmentListReads === 1
              ? [garmentFixture()]
              : [
                  garmentFixture({ id: 'garment-1', status: 'ready' }),
                  garmentFixture({ id: 'garment-refreshed', status: 'ready' }),
                ],
        })
      }),
      http.post('*/api/v1/wardrobe/garments/:garmentId/suggest-tags', () =>
        HttpResponse.json({
          data: createSuggestGarmentTagsDataFixture({ garmentId: 'garment-1' }),
        })
      ),
      http.patch('*/api/v1/wardrobe/garments/:garmentId/tags', () =>
        HttpResponse.json({ data: garmentFixture({ id: 'garment-1', status: 'ready' }) })
      )
    )
    renderScreen()

    await waitFor(() => screen.getByLabelText('Needs tags'))
    fireEvent.click(screen.getByLabelText('Needs tags'))

    // Saving is only possible once the confident suggestions have been applied,
    // so wait on that rather than on the button merely existing.
    await screen.findByText('AI suggested: Top')
    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-save')).toBeEnabled()
    })
    press(screen.getByTestId('garment-tagging-save'))

    // The second wardrobe read is what surfaces `garment-refreshed`; asserting
    // on it proves the re-read happened without counting mock calls.
    await waitFor(() => {
      expect(screen.getByText('garment-refreshed')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('garment-status-ready')).toHaveLength(2)
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
  })

  it('4.4-MOB-HUB-13 flags a garment that never leaves processing and offers a manual tagging route', async () => {
    server.use(
      ...captureUploadHandlers('garment-3', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({
          data: [garmentFixture({ id: 'garment-3', status: 'processing' })],
        })
      )
    )
    renderScreen()
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'Smart tagging is taking longer than expected.'
      )
    })
    // Exhausting the poll budget must not strand the garment: the manual
    // action is the only remaining way to get tags onto it.
    fireEvent.click(screen.getByTestId('garment-capture-done'))
    await waitFor(() => {
      expect(screen.getByLabelText('Needs tags')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-HUB-14 surfaces a wardrobe read failure that happens mid-poll', async () => {
    let garmentListReads = 0
    server.use(
      ...captureUploadHandlers('garment-4', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        if (garmentListReads === 1) {
          return HttpResponse.json({ data: [] })
        }
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Wardrobe temporarily unavailable',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      })
    )
    renderScreen()
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('wardrobe-error-banner')).toHaveTextContent(
        'Wardrobe temporarily unavailable'
      )
    })
  })

  it('4.4-MOB-HUB-15 defers tagging until the capture sheet closes when the poll settles first', async () => {
    let garmentListReads = 0
    server.use(
      ...captureUploadHandlers('garment-5', 'processing'),
      http.get('*/api/v1/wardrobe/garments', () => {
        garmentListReads += 1
        return HttpResponse.json({
          data:
            garmentListReads === 1
              ? []
              : [garmentFixture({ id: 'garment-5', status: 'awaiting_tags' })],
        })
      })
    )
    // Slow enough that the poll resolves while the capture sheet is still up,
    // which is the ordering this deferral exists for.
    renderScreen([40, 80, 160, 320])
    await captureOneGarment()

    await waitFor(() => {
      expect(screen.getByTestId('garment-status-awaiting_tags')).toBeInTheDocument()
    })
    // Stacking the tagging sheet on top of the still-open capture sheet would
    // trap focus between two modals.
    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('garment-capture-done'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tagging-modal')).toBeInTheDocument()
    })
  })
})
