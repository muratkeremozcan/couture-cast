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

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { WardrobeHubScreen } from './wardrobe-hub-screen'

const ACCESS_TOKEN = 'header.eyJzdWIiOiJ1c2VyLTEifQ.signature'

const onboardingNotCompleted = {
  status: 'in_progress' as const,
  currentStep: 'capture' as const,
  usedStarterWardrobe: false,
  garmentsCapturedCount: 0,
  startedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
  revision: 1,
}

function renderScreen() {
  render(<WardrobeHubScreen />)
}

describe('WardrobeHubScreen', () => {
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
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: [] })),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({ data: onboardingNotCompleted })
      )
    )
  })

  afterEach(() => {
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
    const committedGarment = {
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
    }
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library-shot.png', width: 900, height: 900 }],
    })
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () =>
        HttpResponse.json({
          data: {
            garmentId: 'garment-1',
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
        HttpResponse.json({ data: committedGarment })
      )
    )

    renderScreen()
    await waitFor(() => screen.getByTestId('garment-capture-open'))
    fireEvent.click(screen.getByTestId('garment-capture-open'))
    await waitFor(() => screen.getByTestId('garment-source-library'))
    fireEvent.click(screen.getByTestId('garment-source-library'))
    await waitFor(() => screen.getByTestId('garment-crop-preview'))
    fireEvent.click(screen.getByTestId('garment-confirm-image'))
    await waitFor(() => screen.getByTestId('garment-capture-complete'))

    fireEvent.click(screen.getByTestId('garment-capture-done'))

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
})
