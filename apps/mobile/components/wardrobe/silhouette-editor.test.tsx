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

const imageManipulator = vi.hoisted(() => ({
  manipulateAsync: vi.fn().mockResolvedValue({
    uri: 'file:///resized.png',
    width: 1024,
    height: 1536,
  }),
}))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: imageManipulator.manipulateAsync,
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

// Sequential (not fixed) so a test can prove two upload attempts actually
// mint two different idempotency keys instead of accidentally reusing one.
let idempotencyKeyCounter = 0
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => `idem-key-${(idempotencyKeyCounter += 1)}`),
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

/** Mirrors the discriminated union in `silhouetteMyFormSchema`. */
function myFormProfile(myForm: unknown, overrides: Record<string, unknown> = {}) {
  return { ...defaultProfile, mode: 'my_form', myForm, ...overrides }
}

const readyMyForm = {
  status: 'ready',
  failureReason: null,
  committedAt: '2026-08-09T00:05:00.000Z',
  imageAccess: {
    url: 'https://example.test/my-form.png',
    expiresAt: '2026-08-09T02:00:00.000Z',
  },
}

const processingMyForm = {
  status: 'processing',
  failureReason: null,
  committedAt: '2026-08-09T00:05:00.000Z',
  imageAccess: null,
}

/** The full allocate/put/commit chain a My Form upload walks through. */
function uploadHandlers() {
  return [
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
      HttpResponse.json({ data: myFormProfile(processingMyForm) })
    ),
  ]
}

/** Opens the My Form tab and confirms the basewear guidance switch. */
async function openConfirmedMyFormTab() {
  await waitFor(() => screen.getByTestId('silhouette-height-value'))
  fireEvent.click(screen.getByTestId('silhouette-tab-my-form'))
  await waitFor(() => screen.getByTestId('silhouette-my-form-confirm'))
  fireEvent.click(screen.getByRole('switch'))
  await waitFor(() => {
    expect(screen.getByTestId('silhouette-my-form-camera')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })
}

function renderEditor(pollIntervalMs = 10) {
  const onProfileChange = vi.fn()
  render(
    <AccessibilityAnnouncerProvider>
      <SilhouetteEditor
        accessToken={ACCESS_TOKEN}
        onProfileChange={onProfileChange}
        pollIntervalMs={pollIntervalMs}
      />
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
    idempotencyKeyCounter = 0
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
      http.post(
        '*/api/v1/wardrobe/silhouette/my-form/upload-url',
        async ({ request }) => {
          // The picked asset (1000x1600, set in beforeEach) is already under the
          // 4096px cap, so no resize is needed -- but the photo must still be
          // re-encoded through manipulateAsync so the declared mimeType below
          // is actually true. A prior version skipped re-encoding whenever no
          // resize was needed, silently uploading the original (possibly JPEG)
          // bytes under a false 'image/png' declaration.
          expect(imageManipulator.manipulateAsync).toHaveBeenCalled()
          const body = (await request.json()) as { mimeType: string }
          expect(body.mimeType).toBe('image/png')
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
        }
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

    // pollIntervalMs is overridden to 10ms in renderEditor(), so this settles
    // almost immediately instead of paying the real 2s production interval.
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
    })
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

  it('4.4-MOB-SIL-08B mints a fresh idempotency key when retrying with a different photo after a failure', async () => {
    const seenIdempotencyKeys: string[] = []
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.post('*/api/v1/wardrobe/silhouette/my-form/upload-url', ({ request }) => {
        seenIdempotencyKeys.push(request.headers.get('idempotency-key') ?? '')
        return HttpResponse.json(
          { statusCode: 500, message: 'boom', error: 'Internal Server Error' },
          { status: 500 }
        )
      })
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

    // First attempt fails at allocation.
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-failed'))
    expect(seenIdempotencyKeys).toHaveLength(1)

    // Retry sends the user back to source selection; picking a photo again
    // (same or different) must not resubmit the failed attempt's key.
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => {
      expect(seenIdempotencyKeys).toHaveLength(2)
    })

    expect(seenIdempotencyKeys[0]).not.toBe(seenIdempotencyKeys[1])
  })

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

  it('4.4-MOB-SIL-10 announces the changed slider name and its new value', async () => {
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
      expect(liveRegion?.textContent).toBe('Height: 55')
    })
  })

  it('4.4-MOB-SIL-11 announces the build slider by name, not a hardcoded height announcement', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.put('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: { ...defaultProfile, buildSlider: 45, revision: 2 } })
      )
    )
    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-build-value'))

    fireEvent.click(screen.getByTestId('silhouette-build-decrement'))

    await waitFor(() => {
      const liveRegion = document.getElementById('a11y-live-announcer')
      expect(liveRegion?.textContent).toBe('Build: 45')
    })
  })

  it('4.4-MOB-SIL-12 resumes polling a My Form photo still processing from a prior session', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
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

    // Nothing re-triggers the upload flow here; a resumed 'processing' state
    // must start polling on its own from load(), not only from a same-mount
    // upload success.
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-SIL-13 reports a denied camera permission without opening the camera', async () => {
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false })
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-camera'))

    await waitFor(() => {
      expect(screen.getByText('Camera permission was denied.')).toBeInTheDocument()
    })
    expect(imagePicker.launchCameraAsync).not.toHaveBeenCalled()
  })

  it('4.4-MOB-SIL-14 uploads a photo taken with the camera', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      ...uploadHandlers()
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-camera'))

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })
  })

  /** Backing out of the camera must leave the source choices, not a stuck spinner. */
  it('4.4-MOB-SIL-15 keeps the source choices when the camera is cancelled', async () => {
    imagePicker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null })
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-camera'))

    await waitFor(() => expect(imagePicker.launchCameraAsync).toHaveBeenCalled())
    expect(screen.getByTestId('silhouette-my-form-camera')).toBeInTheDocument()
    expect(screen.queryByTestId('silhouette-my-form-processing')).not.toBeInTheDocument()
  })

  it('4.4-MOB-SIL-16 reports a denied photo-library permission', async () => {
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))

    await waitFor(() => {
      expect(screen.getByText('Photo library permission was denied.')).toBeInTheDocument()
    })
    expect(imagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
  })

  it('4.4-MOB-SIL-17 keeps the source choices when the photo library is cancelled', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    })
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))

    await waitFor(() => expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalled())
    expect(screen.getByTestId('silhouette-my-form-library')).toBeInTheDocument()
  })

  /**
   * A slider write is fire-and-forget from the user's point of view, so a failed
   * one has to surface inline with a retry rather than silently reverting.
   */
  it('4.4-MOB-SIL-18 surfaces a failed slider save and recovers through retry', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.put('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED', error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    renderEditor()
    await waitFor(() => screen.getByTestId('silhouette-height-value'))

    fireEvent.click(screen.getByTestId('silhouette-height-decrement'))

    await waitFor(() => {
      expect(
        screen.getByText('Guardian consent required for wardrobe uploads.')
      ).toBeInTheDocument()
    })

    server.use(
      http.put('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: { ...defaultProfile, heightSlider: 45, revision: 2 } })
      )
    )
    fireEvent.click(screen.getByTestId('silhouette-slider-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-height-value')).toHaveTextContent('45')
    })
    expect(screen.queryByTestId('silhouette-slider-retry')).not.toBeInTheDocument()
  })

  it('4.4-MOB-SIL-19 keeps the photo visible when removal fails', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: myFormProfile(readyMyForm, { revision: 3 }) })
      ),
      http.delete('*/api/v1/wardrobe/silhouette/my-form', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Storage is unavailable.', error: 'Server Error' },
          { status: 500 }
        )
      )
    )
    renderEditor()

    await waitFor(() => screen.getByTestId('silhouette-my-form-remove'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-remove'))

    await waitFor(() => {
      expect(screen.getByText('Storage is unavailable.')).toBeInTheDocument()
    })
    expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
  })

  it('4.4-MOB-SIL-20 surfaces the guardian-consent block when removal is forbidden', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: myFormProfile(readyMyForm, { revision: 3 }) })
      ),
      http.delete('*/api/v1/wardrobe/silhouette/my-form', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'GUARDIAN_CONSENT_REQUIRED', error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    renderEditor()

    await waitFor(() => screen.getByTestId('silhouette-my-form-remove'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-remove'))

    await waitFor(() => {
      expect(
        screen.getByText('Guardian consent required for wardrobe uploads.')
      ).toBeInTheDocument()
    })
  })

  /** The terminal failure arrives from the poll, not from the initial read. */
  it('4.4-MOB-SIL-21 shows the failure reason when processing fails mid-poll', async () => {
    let call = 0
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () => {
        call += 1
        return HttpResponse.json({
          data:
            call < 3
              ? myFormProfile(processingMyForm)
              : myFormProfile({
                  status: 'failed',
                  failureReason: 'privacy_violation',
                  committedAt: '2026-08-09T00:05:00.000Z',
                  imageAccess: null,
                }),
        })
      })
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-failed').textContent).toContain(
        'Choose a different photo.'
      )
    })
  })

  it('4.4-MOB-SIL-22 resumes polling a photo whose bytes are uploaded but not yet processed', async () => {
    let call = 0
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () => {
        call += 1
        return HttpResponse.json({
          data:
            call === 1
              ? myFormProfile({
                  status: 'bytes_uploaded',
                  failureReason: null,
                  committedAt: null,
                  imageAccess: null,
                })
              : myFormProfile(readyMyForm),
        })
      })
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
    })
  })

  /**
   * `pending_upload` means the allocation exists but no bytes landed, so there is
   * nothing to poll for and the user must be able to pick a photo again.
   */
  it('4.4-MOB-SIL-23 offers the source choices again for an abandoned pending upload', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: myFormProfile({
            status: 'pending_upload',
            failureReason: null,
            committedAt: null,
            imageAccess: null,
          }),
        })
      )
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-library')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('silhouette-my-form-processing')).not.toBeInTheDocument()
  })

  /** A never-adjusted profile stores nulls; the steppers still need a number. */
  it('4.4-MOB-SIL-24 falls back to the midpoint when the sliders have never been set', async () => {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({
          data: { ...defaultProfile, heightSlider: null, buildSlider: null },
        })
      )
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-height-value')).toHaveTextContent('50')
      expect(screen.getByTestId('silhouette-build-value')).toHaveTextContent('50')
    })
  })

  /** Deleting the photo on another device must settle this one back to idle. */
  it('4.4-MOB-SIL-25 returns to the source choices when the photo disappears mid-poll', async () => {
    let call = 0
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () => {
        call += 1
        return HttpResponse.json({
          data: call === 1 ? myFormProfile(processingMyForm) : defaultProfile,
        })
      })
    )
    renderEditor()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })

    // Decision 12 again: with no photo the profile is back on the default
    // mannequin, which is the tab the editor must land on.
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-sliders')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('silhouette-my-form-processing')).not.toBeInTheDocument()
  })
})
