// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAllUploadAttempts } from '@/src/lib/upload-attempts'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
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
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
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

// Upload keys come from the attempt store (UUID v4 from `src/lib/uuid`), so only the digest
// the photo fingerprint needs is stood in for here.
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

/** Synthetic auth principal; the profile HTTP response supplies the application owner. */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('auth-principal-user-1')

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
        onProfileChange={onProfileChange}
        pollIntervalMs={pollIntervalMs}
      />
    </AccessibilityAnnouncerProvider>
  )
  return { onProfileChange }
}

describe('SilhouetteEditor', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  let restoreAccessTokenResolver: () => void

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    server.use(
      http.get('*/api/v1/user/profile', ({ request }) => {
        if (request.headers.get('authorization') !== `Bearer ${ACCESS_TOKEN}`)
          return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
        return HttpResponse.json({
          user: {
            id: 'user-1',
            email: 'owner@synthetic.test',
            displayName: null,
            birthdate: '1990-01-01T00:00:00.000Z',
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [],
        })
      })
    )
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    // A My Form upload resolves its bearer through the app's resolver at upload time.
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
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
    // Upload attempts live for the app session; each test starts signed out with none open.
    setMobileApplicationUserId(null)
    forgetAllUploadAttempts()
    restoreAccessTokenResolver()
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

  /**
   * Review round 1, 2026-11-19: a signed URL writes one object and never overwrites, so a retry
   * after a PUT whose answer was lost finds storage saying the object already exists. That must
   * go on to commit, which verifies the stored sha256, instead of failing before it.
   */
  it('4.4-MOB-SIL-26 commits when storage says the photo is already uploaded', async () => {
    const seen: { cacheControl?: string | null; committed: boolean } = {
      committed: false,
    }
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
              requiredHeaders: { 'content-type': 'image/jpeg' },
              expiresAt: '2026-08-09T01:00:00.000Z',
            },
          },
          { status: 201 }
        )
      ),
      http.put('*/mock-storage/session-1', ({ request }) => {
        seen.cacheControl = request.headers.get('cache-control')
        return HttpResponse.json(
          {
            statusCode: '409',
            error: 'Duplicate',
            message: 'The resource already exists',
          },
          { status: 400 }
        )
      }),
      http.post('*/api/v1/wardrobe/silhouette/my-form/commit', () => {
        seen.committed = true
        return HttpResponse.json({
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
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))

    await waitFor(() => expect(seen.committed).toBe(true))
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('silhouette-my-form-failed')).toBeNull()
    expect(seen.cacheControl).toBe('private, max-age=0')
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
          // 4096px cap, so no resize is needed, but the photo must still be
          // re-encoded through manipulateAsync so the declared mimeType below
          // is actually true. A prior version skipped re-encoding whenever no
          // resize was needed, silently uploading the original (possibly PNG
          // or WebP) bytes under a false declaration. JPEG because a full-body
          // photo saved as PNG came to several megabytes.
          expect(imageManipulator.manipulateAsync).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            { compress: 0.9, format: 'jpeg' }
          )
          const body = (await request.json()) as { mimeType: string }
          expect(body.mimeType).toBe('image/jpeg')
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

  /**
   * Production follow-up 2026-11-19 (review round 2, Codex 6): an attempt is named by the
   * prepared photo. Picking the same photo again after a failure resumes it with its key (the
   * declaration is identical, so the server replays the same session); a different photo is a
   * new attempt with a fresh key, so a key never carries a second declaration.
   */
  it('4.4-MOB-SIL-08B resumes the failed attempt with its key when the same photo is picked again', async () => {
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
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-failed'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => {
      expect(seenIdempotencyKeys).toHaveLength(2)
    })

    // The allocation answer never arrived (a 500), so the same photo replays it with its key.
    expect(seenIdempotencyKeys[1]).toBe(seenIdempotencyKeys[0])
  })

  it('4.4-MOB-SIL-08C mints a fresh idempotency key when retrying with a different photo after a failure', async () => {
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
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-failed'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))
    // A different photo: the prepared frame differs, so its fingerprint does too.
    imageManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: 'file:///resized-other.jpg',
      width: 900,
      height: 1400,
    })
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => {
      expect(seenIdempotencyKeys).toHaveLength(2)
    })

    expect(seenIdempotencyKeys[0]).not.toBe(seenIdempotencyKeys[1])
  })

  it('4.4-MOB-SIL-27 commits first when the same photo is picked after a lost commit answer', async () => {
    const seen = { allocateKeys: [] as string[], puts: 0, commitKeys: [] as string[] }
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.post('*/api/v1/wardrobe/silhouette/my-form/upload-url', ({ request }) => {
        seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
        return HttpResponse.json(
          {
            data: {
              uploadSessionId: 'session-1',
              uploadUrl: `${window.location.origin}/mock-storage/session-1`,
              uploadToken: 'upload-token-1',
              requiredHeaders: { 'content-type': 'image/jpeg' },
              expiresAt: '2026-08-09T01:00:00.000Z',
            },
          },
          { status: 201 }
        )
      }),
      http.put('*/mock-storage/session-1', () => {
        seen.puts += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/wardrobe/silhouette/my-form/commit', ({ request }) => {
        seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
        return seen.commitKeys.length === 1
          ? HttpResponse.json(
              { statusCode: 503, message: 'Service Unavailable', error: 'Error' },
              { status: 503 }
            )
          : HttpResponse.json({ data: myFormProfile(processingMyForm) })
      })
    )
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-failed'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    // The uploading phase shares the processing panel, so wait for the commit itself.
    await waitFor(() => expect(seen.commitKeys).toHaveLength(2))
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-processing')).toBeInTheDocument()
    })

    expect(seen.allocateKeys).toHaveLength(1)
    expect(seen.puts).toBe(1)
    expect(seen.commitKeys).toEqual([seen.commitKeys[0], seen.commitKeys[0]])
  })

  /**
   * Retry routes for the same prepared photo: each leg answers from its own queue and records
   * the idempotency key it was sent.
   */
  function myFormRetryRoutes(commitAnswers: (() => Response)[]) {
    const seen = { allocateKeys: [] as string[], puts: 0, commitKeys: [] as string[] }
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      ),
      http.post('*/api/v1/wardrobe/silhouette/my-form/upload-url', ({ request }) => {
        seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
        return HttpResponse.json(
          {
            data: {
              uploadSessionId: `session-${seen.allocateKeys.length}`,
              uploadUrl: `${window.location.origin}/mock-storage/my-form-retry`,
              uploadToken: 'upload-token-1',
              requiredHeaders: { 'content-type': 'image/jpeg' },
              expiresAt: '2026-08-09T01:00:00.000Z',
            },
          },
          { status: 201 }
        )
      }),
      http.put('*/mock-storage/my-form-retry', () => {
        seen.puts += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/wardrobe/silhouette/my-form/commit', ({ request }) => {
        seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
        const answer = commitAnswers.shift()
        if (!answer) throw new Error('No commit answer left')
        return answer()
      })
    )
    return seen
  }

  /** The profile poll answers ready once the commit has been accepted. */
  function serveReadyMyForm() {
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: myFormProfile(readyMyForm) })
      )
    )
  }

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  /** Retry, then the same photo from the library: the member's retry of the attempt. */
  async function retryWithSamePhoto() {
    await waitFor(() => screen.getByTestId('silhouette-my-form-failed'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-library'))
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
  }

  /**
   * Production follow-up 2026-11-19: when the commit a retry resumed answers that the server
   * ended the attempt (its session expired), that same pick starts one fresh attempt with fresh
   * keys: a new allocation, the bytes again, and a commit. The member never retries twice, and
   * the rejected keys are never sent again.
   */
  it('4.4-MOB-SIL-27B starts one fresh attempt in the same retry once the session expired', async () => {
    const seen = myFormRetryRoutes([
      () =>
        HttpResponse.json(
          { statusCode: 503, message: 'Service Unavailable', error: 'Error' },
          { status: 503 }
        ),
      () =>
        HttpResponse.json(
          { statusCode: 409, message: 'UPLOAD_SESSION_EXPIRED', error: 'Conflict' },
          { status: 409 }
        ),
      () => HttpResponse.json({ data: myFormProfile(processingMyForm) }),
    ])
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await retryWithSamePhoto()
    await waitFor(() => expect(seen.commitKeys).toHaveLength(3))
    serveReadyMyForm()
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('silhouette-my-form-failed')).not.toBeInTheDocument()
    expect(seen.allocateKeys).toHaveLength(2)
    expect(seen.allocateKeys[1]).toMatch(UUID_V4)
    expect(seen.allocateKeys[1]).not.toBe(seen.allocateKeys[0])
    expect(seen.puts).toBe(2)
    expect(seen.commitKeys[0]).toMatch(UUID_V4)
    expect(seen.commitKeys[1]).toBe(seen.commitKeys[0])
    expect(seen.commitKeys[2]).toMatch(UUID_V4)
    expect(seen.commitKeys[2]).not.toBe(seen.commitKeys[0])
  })

  it('4.4-MOB-SIL-27C keeps the attempt on the next retry after UPLOAD_IN_PROGRESS', async () => {
    const seen = myFormRetryRoutes([
      () =>
        HttpResponse.json(
          { statusCode: 409, message: 'UPLOAD_IN_PROGRESS', error: 'Conflict' },
          { status: 409 }
        ),
      () => HttpResponse.json({ data: myFormProfile(processingMyForm) }),
    ])
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-failed')).toHaveTextContent(
        'This photo is still being saved. Try again in a moment.'
      )
    })
    await retryWithSamePhoto()
    await waitFor(() => expect(seen.commitKeys).toHaveLength(2))
    serveReadyMyForm()
    await waitFor(() => {
      expect(screen.getByTestId('silhouette-my-form-ready')).toBeInTheDocument()
    })

    expect(seen.allocateKeys).toHaveLength(1)
    expect(seen.puts).toBe(1)
    expect(seen.commitKeys[0]).toMatch(UUID_V4)
    expect(seen.commitKeys[1]).toBe(seen.commitKeys[0])
  })

  /** The camera and library buttons are enabled only after the basewear confirmation. */
  function expectConfirmationCleared() {
    expect(screen.getByTestId('silhouette-my-form-library')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByTestId('silhouette-my-form-camera')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  }

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('4.4-MOB-SIL-28 drops a photo the picker returns after the account changed, and uploads nothing', async () => {
    const seen = myFormRetryRoutes([])
    let returnPick: (result: unknown) => void = () => undefined
    imagePicker.launchImageLibraryAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        returnPick = resolve
      })
    )
    setMobileApplicationUserId('member-a')
    renderEditor()
    await openConfirmedMyFormTab()

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalled())
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      returnPick({
        canceled: false,
        assets: [{ uri: 'file:///photo.png', width: 1000, height: 1600 }],
      })
      // The picker callback resumes on microtasks only, so one macrotask turn lets it finish.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expectConfirmationCleared()
    expect(screen.queryByTestId('silhouette-my-form-failed')).not.toBeInTheDocument()
    expect(imageManipulator.manipulateAsync).not.toHaveBeenCalled()
    expect(seen.allocateKeys).toHaveLength(0)
    expect(seen.puts).toBe(0)
  })

  it('4.4-MOB-SIL-29 clears the confirmation and the failed photo on an account change, so Retry cannot upload under the next account', async () => {
    const seen = myFormRetryRoutes([
      () =>
        HttpResponse.json(
          { statusCode: 503, message: 'Service Unavailable', error: 'Error' },
          { status: 503 }
        ),
    ])
    setMobileApplicationUserId('member-a')
    renderEditor()
    await openConfirmedMyFormTab()
    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))
    await waitFor(() => screen.getByTestId('silhouette-my-form-retry'))

    act(() => setMobileApplicationUserId('member-b'))

    expect(screen.queryByTestId('silhouette-my-form-failed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('silhouette-my-form-retry')).not.toBeInTheDocument()
    expectConfirmationCleared()
    expect(seen.allocateKeys).toHaveLength(1)
    expect(seen.commitKeys).toHaveLength(1)
  })

  it('4.4-MOB-SIL-30 refuses the upload when resolving the bearer finds another account signed in', async () => {
    const seen = myFormRetryRoutes([])
    setMobileApplicationUserId('member-a')
    renderEditor()
    await openConfirmedMyFormTab()
    // Resolving the token is where the app notices the stored session now belongs to member B.
    const restoreSwitchingResolver = setMobileAccessTokenResolver(() => {
      setMobileApplicationUserId('member-b')
      return fakeAccessToken('auth-principal-member-b')
    })

    fireEvent.click(screen.getByTestId('silhouette-my-form-library'))

    await waitFor(() => {
      // The catalog's wardrobe.silhouette.errors.session_changed copy, never the raw error.
      expect(screen.getByTestId('silhouette-my-form-failed')).toHaveTextContent(
        'You signed out or switched accounts during this upload. Choose the photo again.'
      )
    })
    restoreSwitchingResolver()
    fireEvent.click(screen.getByTestId('silhouette-my-form-retry'))
    expectConfirmationCleared()
    expect(seen.allocateKeys).toHaveLength(0)
    expect(seen.puts).toBe(0)
    expect(seen.commitKeys).toHaveLength(0)
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  //
  // Production follow-up 2026-11-19 (review round 6, Codex C5-1): an account change clears
  // everything read for the previous account (profile, revision, signed photo URL, the bearer
  // and a running poll) and reads the profile again for the account signed in now. Remove comes
  // back only once that account's own read landed, and sends its bearer and revision.
  describe('round 6 account switch with a My Form photo on screen', () => {
    const MEMBER_A_PHOTO = 'https://example.test/member-a-my-form.png'
    const MEMBER_B_PHOTO = 'https://example.test/member-b-my-form.png'
    const MEMBER_B_TOKEN = fakeAccessToken('auth-principal-member-b')

    function photo(url: string) {
      return { ...readyMyForm, imageAccess: { ...readyMyForm.imageAccess, url } }
    }

    /** Both members' identity reads, keyed on the bearer each request carries. */
    function serveBothIdentities() {
      server.use(
        http.get('*/api/v1/user/profile', ({ request }) => {
          const authorization = request.headers.get('authorization')
          const id =
            authorization === `Bearer ${ACCESS_TOKEN}`
              ? 'user-1'
              : authorization === `Bearer ${MEMBER_B_TOKEN}`
                ? 'user-b'
                : null
          if (!id) return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
          return HttpResponse.json({
            user: {
              id,
              email: `${id}@synthetic.test`,
              displayName: null,
              birthdate: '1990-01-01T00:00:00.000Z',
              role: 'guardian',
            },
            linkedGuardians: [],
            linkedTeens: [],
          })
        })
      )
    }

    function isMemberA(request: Request) {
      return request.headers.get('authorization') === `Bearer ${ACCESS_TOKEN}`
    }

    let restoreMemberBResolver: (() => void) | null = null
    afterEach(() => {
      restoreMemberBResolver?.()
      restoreMemberBResolver = null
    })

    /** Signs member B in: the app's resolver now answers B's bearer, then the account flips. */
    function switchToMemberB() {
      restoreMemberBResolver = setMobileAccessTokenResolver(() => MEMBER_B_TOKEN)
      act(() => setMobileApplicationUserId('member-b'))
    }

    it("4.4-MOB-SIL-31 clears A's ready photo and removes only with B's bearer and revision", async () => {
      let releaseMemberBRead: () => void = () => undefined
      const memberBRead = new Promise<void>((resolve) => {
        releaseMemberBRead = resolve
      })
      const removals: { authorization: string | null; ifMatch: string | null }[] = []
      serveBothIdentities()
      server.use(
        http.get('*/api/v1/wardrobe/silhouette', async ({ request }) => {
          if (isMemberA(request)) {
            return HttpResponse.json({
              data: myFormProfile(photo(MEMBER_A_PHOTO), { revision: 3 }),
            })
          }
          await memberBRead
          return HttpResponse.json({
            data: myFormProfile(photo(MEMBER_B_PHOTO), { revision: 7 }),
          })
        }),
        http.delete('*/api/v1/wardrobe/silhouette/my-form', ({ request }) => {
          removals.push({
            authorization: request.headers.get('authorization'),
            ifMatch: request.headers.get('if-match'),
          })
          return HttpResponse.json({ data: { ...defaultProfile, revision: 8 } })
        })
      )
      setMobileApplicationUserId('member-a')
      const { onProfileChange } = renderEditor()
      await waitFor(() => screen.getByTestId('silhouette-my-form-remove'))
      expect(screen.getByTestId('silhouette-my-form-image')).toBeInTheDocument()
      expect(onProfileChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ myForm: photo(MEMBER_A_PHOTO) })
      )

      switchToMemberB()

      // Nothing of A's is left while B's own read is still on the wire.
      expect(screen.queryByTestId('silhouette-my-form-ready')).not.toBeInTheDocument()
      expect(screen.queryByTestId('silhouette-my-form-image')).not.toBeInTheDocument()
      expect(screen.queryByTestId('silhouette-my-form-remove')).not.toBeInTheDocument()

      await act(async () => {
        releaseMemberBRead()
        await Promise.resolve()
      })
      await waitFor(() => screen.getByTestId('silhouette-my-form-remove'))
      expect(onProfileChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ revision: 7, myForm: photo(MEMBER_B_PHOTO) })
      )
      fireEvent.click(screen.getByTestId('silhouette-my-form-remove'))

      await waitFor(() => expect(removals).toHaveLength(1))
      expect(removals[0]).toEqual({
        authorization: `Bearer ${MEMBER_B_TOKEN}`,
        ifMatch: '"silhouette:user-b:7"',
      })
    })

    it("4.4-MOB-SIL-32 drops A's poll answer that lands after the switch", async () => {
      let memberAReads = 0
      let releaseMemberAPoll: () => void = () => undefined
      const memberAPoll = new Promise<void>((resolve) => {
        releaseMemberAPoll = resolve
      })
      let pollReached: () => void = () => undefined
      const memberAPollReached = new Promise<void>((resolve) => {
        pollReached = resolve
      })
      serveBothIdentities()
      server.use(
        http.get('*/api/v1/wardrobe/silhouette', async ({ request }) => {
          if (!isMemberA(request)) return HttpResponse.json({ data: defaultProfile })
          memberAReads += 1
          if (memberAReads === 1) {
            return HttpResponse.json({ data: myFormProfile(processingMyForm) })
          }
          // A's poll is on the wire when the account changes, and answers afterwards.
          pollReached()
          await memberAPoll
          return HttpResponse.json({
            data: myFormProfile(photo(MEMBER_A_PHOTO), { revision: 3 }),
          })
        })
      )
      setMobileApplicationUserId('member-a')
      const { onProfileChange } = renderEditor()
      await waitFor(() => screen.getByTestId('silhouette-my-form-processing'))
      await memberAPollReached

      switchToMemberB()
      await waitFor(() =>
        expect(onProfileChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ mode: 'default_mannequin', myForm: null })
        )
      )
      onProfileChange.mockClear()
      await act(async () => {
        releaseMemberAPoll()
        // The held answer resolves through fetch and the response body on macrotasks.
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(onProfileChange).not.toHaveBeenCalled()
      expect(screen.queryByTestId('silhouette-my-form-ready')).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('silhouette-my-form-processing')
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('silhouette-my-form-image')).not.toBeInTheDocument()
    })
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
