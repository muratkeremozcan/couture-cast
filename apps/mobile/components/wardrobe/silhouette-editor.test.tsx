import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { SilhouetteEditor } from './silhouette-editor'

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
  }
})

const imagePicker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => imagePicker)

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn().mockResolvedValue({
    uri: 'file:///resized.png',
    width: 1024,
    height: 1536,
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

/** Base64url-shaped JWT payload so `resolveOwnerUserId` can decode a userId. */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('user-1')

const defaultProfile = {
  mode: 'default_mannequin' as const,
  heightSlider: 50,
  buildSlider: 50,
  myForm: null,
  revision: 1,
  updatedAt: '2026-08-09T00:00:00.000Z',
}

function renderEditor() {
  const onProfileChange = vi.fn()
  render(
    <AccessibilityAnnouncerProvider>
      <SilhouetteEditor accessToken={ACCESS_TOKEN} onProfileChange={onProfileChange} />
    </AccessibilityAnnouncerProvider>
  )
  return { onProfileChange }
}

describe('SilhouetteEditor', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.png', width: 1000, height: 1600 }],
    })
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.png', width: 1000, height: 1600 }],
    })
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    vi.clearAllMocks()
  })

  it('4.4-MOB-SIL-01 loads the profile and shows current slider values', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-height-value')).toHaveTextContent('50')
      expect(screen.getByTestId('silhouette-build-value')).toHaveTextContent('50')
    })
  })

  it('4.4-MOB-SIL-02 shows a retry action when the initial load fails offline', async () => {
    server.use(http.get('*/api/v1/wardrobe/silhouette', () => HttpResponse.error()))
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-load-retry')).toBeInTheDocument()
    })

    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    fireEvent.click(screen.getByTestId('silhouette-load-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-sliders')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-SIL-03 persists a slider change immediately with the revision If-Match', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-height-value'))

    server.use(
      http.put('*/api/v1/wardrobe/silhouette', async ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"silhouette:user-1:1"')
        expect(await request.json()).toEqual({ heightSlider: 55, buildSlider: 50 })
        return HttpResponse.json({
          data: { ...defaultProfile, heightSlider: 55, revision: 2 },
        })
      })
    )
    fireEvent.click(screen.getByTestId('silhouette-height-increment'))

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-height-value')).toHaveTextContent('55')
    })
  })

  it('4.4-MOB-SIL-04 disables the decrement stepper at the lower boundary', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: { ...defaultProfile, heightSlider: 0 } })
      )
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-height-decrement')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
  })

  it('4.4-MOB-SIL-05 surfaces a guardian-consent block on a 403 load', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED', error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    renderEditor()

    await waitFor(() => {
      expect(
        screen.getByText('Guardian consent required for wardrobe uploads.')
      ).toBeInTheDocument()
    })
  })

  it('4.4-MOB-SIL-06 blocks My Form upload until the basewear guidance is confirmed', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-height-value'))

    fireEvent.click(screen.getByTestId('silhouette-tab-my-form'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))

    expect(screen.getByTestId('silhouette-my-form-library')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('4.4-MOB-SIL-07 uploads a My Form photo through processing to ready', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.post('*/api/v1/wardrobe/silhouette/my-form/upload-url', () =>
        HttpResponse.json(
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
      ),
      http.put('*/mock-storage/session-1', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/v1/wardrobe/silhouette/my-form/commit', () =>
        HttpResponse.json({
          data: {
            ...defaultProfile,
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

    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-height-value'))
    fireEvent.click(screen.getByTestId('silhouette-tab-my-form'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-confirm'))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-library')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })

    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: {
            ...defaultProfile,
            mode: 'my_form',
            myForm: {
              status: 'ready',
              failureReason: null,
              committedAt: '2026-08-09T00:05:00.000Z',
              imageAccess: {
                url: 'https://example.test/my-form.png',
                expiresAt: '2026-08-09T02:00:00.000Z',
              },
            },
          },
        })
      )
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
      },
      { timeout: 5_000 }
    )
    expect(screen.getByTestId('silhouette-my-form-image')).toBeInTheDocument()
  })

  it.each([
    // Substrings avoid the apostrophe in the full copy so this file stays
    // single-quoted throughout; the full string lives in en-US.json.
    ['contrast', 'Retake the photo with plainer clothing or a plainer background.'],
    ['privacy_violation', 'Choose a different photo.'],
    ['timeout', 'Processing took too long. Try again.'],
    ['storage_error', 'Try again.'],
  ] as const)(
    '4.4-MOB-SIL-08 shows the %s failure reason with a retry action',
    async (reason, messageSubstring) => {
      server.use(
        http.get('*/api/v1/wardrobe/silhouette', () =>
          HttpResponse.json({
            data: {
              ...defaultProfile,
              mode: 'my_form',
              myForm: {
                status: 'failed',
                failureReason: reason,
                committedAt: '2026-08-09T00:05:00.000Z',
                imageAccess: null,
              },
            },
          })
        )
      )
      renderEditor()

      await waitFor(() => {
        expect(screen.getByTestId('silhouette-my-form-failed').textContent).toContain(
          messageSubstring
        )
      })
      expect(screen.getByTestId('silhouette-my-form-retry')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
      await waitFor(() => {
        expect(screen.getByTestId('silhouette-my-form-library')).toBeInTheDocument()
      })
    }
  )

  it('4.4-MOB-SIL-09 removes the My Form photo and reverts to the default mannequin', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: {
            ...defaultProfile,
            mode: 'my_form',
            revision: 3,
            myForm: {
              status: 'ready',
              failureReason: null,
              committedAt: '2026-08-09T00:05:00.000Z',
              imageAccess: {
                url: 'https://example.test/my-form.png',
                expiresAt: '2026-08-09T02:00:00.000Z',
              },
            },
          },
        })
      ),
      http.delete('*/api/v1/wardrobe/silhouette/my-form', ({ request }) => {
        expect(request.headers.get('if-match')).toBe('"silhouette:user-1:3"')
        return HttpResponse.json({
          data: {
            ...defaultProfile,
            mode: 'default_mannequin',
            myForm: null,
            revision: 4,
          },
        })
      })
    )
    renderEditor()

    await waitFor(() => screen.getByTestId('silhouette-my-form-remove'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-remove'))

    // Decision 12: deletion falls the profile back to `default_mannequin`, which
    // switches the active tab back to the sliders.
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-sliders')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-SIL-10 announces a live region message when a slider save completes', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.put('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: { ...defaultProfile, heightSlider: 55, revision: 2 } })
      )
    )
    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-height-value'))

    fireEvent.click(screen.getByTestId('silhouette-height-increment'))

    await waitFor(() => {
      const liveRegion = document.getElementById('a11y-live-announcer')
      expect(liveRegion?.textContent).toBe('Height')
    })
  })
})
