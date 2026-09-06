// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the compose sheet.
//
// The network boundary stays REAL and is driven through MSW: the sheet's job is to
// turn a three-step publish (allocate, raw-byte PUT, publish) and its failures into
// rendered states, and a stubbed client would leave the failure half unproven. Only
// the four native modules `src/lib/community.ts` imports lazily are mocked.
import React, { createElement, useState } from 'react'
import { run as runAxe } from 'axe-core'
import type * as ReactNativeModule from 'react-native'
import { delay, http, HttpResponse } from 'msw'
import {
  configure,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const imagePicker = vi.hoisted(() => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-picker', () => imagePicker)

const imageManipulator = vi.hoisted(() => ({ manipulateAsync: vi.fn() }))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: imageManipulator.manipulateAsync,
  SaveFormat: { JPEG: 'jpeg' },
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
}))

/**
 * `accessibilityState` is a NATIVE-only prop that react-native-web does not forward,
 * so the confirmation checkbox's checked state cannot be read off the DOM. The
 * recorder renders the REAL `TouchableOpacity`.
 */
const touchableSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
  createElement: null as unknown as typeof createElement,
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const RealTouchable = actual.TouchableOpacity
  function RecordingTouchable(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      touchableSpy.props.set(props.testID, props)
    }
    return touchableSpy.createElement(RealTouchable as never, props)
  }
  return {
    ...actual,
    // `Platform.OS` is redefined per test because the sheet's focus move only
    // runs off web, and react-native-web's own `findNodeHandle` throws
    // unconditionally. Same shape as `wardrobe/capsule-builder-modal.test.tsx`.
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
    TouchableOpacity: RecordingTouchable,
  }
})

touchableSpy.createElement = createElement

import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import {
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  type EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { CommunityRequestError } from '@/src/lib/community'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'
import {
  CommunityPostSheet,
  communityErrorTranslation,
  useResolvedCommunityLocale,
} from './community-post-sheet'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const UPLOAD_URL = 'https://mock-upload.test/upload'
const SUGGESTION = 'A layered outfit photographed against a plain wall.'
const SDK_ERROR_MESSAGE = 'Response returned an error code'

const CHALLENGE: EmbeddedCommunityChallenge = {
  id: 'challenge-autumn',
  slug: 'autumn-layers',
  climateBand: 'temperate_dry',
  title: 'Autumn Layers Challenge',
  body: 'Style your favourite transitional layering pieces for temperate weather.',
  startsAt: '2026-08-31T00:00:00.000Z',
  endsAt: '2026-09-07T00:00:00.000Z',
  timeZone: 'Europe/Istanbul',
}

const publishedItem = {
  id: 'post-new-42',
  caption: null,
  altText: SUGGESTION,
  climateBand: 'temperate_dry' as const,
  imageAccess: {
    url: 'https://storage.test/post-new-42.jpg',
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
  publishedAt: null,
  createdAt: '2026-09-05T12:00:00.000Z',
  status: 'pending_review' as const,
  challengeId: null,
  author: { displayName: 'You', isSelf: true },
}

function allocateSession(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      postId: 'post-new-42',
      uploadSessionId: 'session-42',
      uploadUrl: UPLOAD_URL,
      uploadToken: 'token-42',
      requiredHeaders: { 'content-type': 'image/jpeg' },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      altTextSuggestion: SUGGESTION,
      altTextSuggestionLocale: 'en-US',
      ...overrides,
    },
  }
}

const errorEnvelope = (
  status: number,
  message: string,
  headers?: Record<string, string>
) =>
  HttpResponse.json(
    { statusCode: status, message, error: 'Error' },
    { status, ...(headers ? { headers } : {}) }
  )

function renderSheet(
  props: Partial<React.ComponentProps<typeof CommunityPostSheet>> = {}
) {
  const onClose = vi.fn()
  const onPublished = vi.fn()
  const utils = render(
    <CommunityPostSheet visible onClose={onClose} onPublished={onPublished} {...props} />
  )
  return { ...utils, onClose, onPublished }
}

/** A real button outside the sheet, so focus has somewhere to be restored to. */
function SheetHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Share
      </button>
      <CommunityPostSheet
        visible={open}
        onClose={() => setOpen(false)}
        onPublished={vi.fn()}
      />
    </>
  )
}

async function pickAndAllocate() {
  press(screen.getByTestId('community-pick-image-button'))
  await screen.findByTestId('community-post-preview-image')
  await waitFor(() =>
    expect(
      screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
    ).toBe(SUGGESTION)
  )
}

describe('CommunityPostSheet (Story 6.1)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
    // The three-step publish is three MSW service-worker round trips, which can
    // outrun the 1000ms default on a loaded runner.
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    touchableSpy.props.clear()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///community-photo.jpg', width: 1200, height: 1200 }],
    })
    imageManipulator.manipulateAsync.mockResolvedValue({
      uri: 'file:///prepared.jpg',
      width: 1200,
      height: 1200,
    })
    server.use(
      http.post('*/api/v1/community/posts/allocate', () =>
        HttpResponse.json(allocateSession())
      ),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', () =>
        HttpResponse.json({ data: publishedItem })
      )
    )
  })

  afterEach(async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    await i18n.changeLanguage('en-US')
  })

  it('6.1-MOB-075 moves accessibility focus into the sheet on a native surface', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(73)

    renderSheet()

    // Focus containment starts by moving the reader in; react-native-web's own
    // trap does this on web, so the explicit move is native-only.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(73)
    )
  })

  it('6.1-MOB-076 says why an allocate was refused instead of leaking the SDK wording', async () => {
    server.use(
      http.post('*/api/v1/community/posts/allocate', () =>
        errorEnvelope(503, COMMUNITY_FEED_DISABLED_MESSAGE)
      )
    )
    renderSheet()

    press(screen.getByTestId('community-pick-image-button'))

    expect((await screen.findByTestId('community-publish-error')).textContent).toBe(
      enUS.community.error.disabled
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-077 abandons an in-flight upload quietly when the sheet is closed', async () => {
    server.use(
      http.post('*/api/v1/community/posts/allocate', async () => {
        await delay(250)
        return HttpResponse.json(allocateSession())
      })
    )
    const { onClose } = renderSheet()

    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-publish-status')

    press(screen.getByTestId('community-post-sheet-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // The abandoned request must not come back to complain, or to fill in a
    // suggestion for a sheet the author already left.
    await delay(400)
    expect(screen.queryByTestId('community-publish-error')).toBeNull()
    expect(
      screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
    ).toBe('')
  })

  it('6.1-MOB-078 abandons an in-flight publish quietly when the sheet is closed', async () => {
    server.use(
      http.post('*/api/v1/community/posts/publish', async () => {
        await delay(250)
        return HttpResponse.json({ data: publishedItem })
      })
    )
    const { onClose, onPublished } = renderSheet()

    await pickAndAllocate()
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))
    await screen.findByTestId('community-publish-status')

    press(screen.getByTestId('community-post-sheet-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    await delay(400)
    expect(onPublished).not.toHaveBeenCalled()
    expect(screen.queryByTestId('community-publish-error')).toBeNull()
  })

  it('6.1-MOB-060 announces itself as a modal dialog, contains focus and gives it back', async () => {
    render(<SheetHarness />)

    const opener = screen.getByTestId('opener')
    opener.focus()
    fireEvent.click(opener)

    const sheet = await screen.findByTestId('community-post-sheet')
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(sheet.getAttribute('role')).toBe('dialog'))
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true))

    press(screen.getByTestId('community-post-sheet-close'))

    await waitFor(() => expect(screen.queryByTestId('community-post-sheet')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('6.1-MOB-061 keeps publish dead until a confirmed description exists, and says why', async () => {
    renderSheet()

    const publish = screen.getByTestId('community-publish-button')
    expect(publish.getAttribute('aria-disabled')).toBe('true')
    /*
     * The reason the control is dead is spoken, never implied by dimming alone,
     * and it names the ACTUAL blocker. With no photo chosen yet that is the photo,
     * not the alt-text confirmation the hint used to recite whatever was wrong.
     */
    expect(touchableSpy.props.get('community-publish-button')).toMatchObject({
      accessibilityHint: enUS.community.validation.photoRequired,
    })
    expect(screen.getByTestId('community-pick-image-button')).toBeInTheDocument()

    await pickAndAllocate()
    expect(
      screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
    ).toBe('true')
    expect(touchableSpy.props.get('community-publish-button')?.accessibilityHint).toBe(
      enUS.community.validation.altConfirmRequired
    )
    expect(touchableSpy.props.get('community-confirm-alt-text')).toMatchObject({
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: false },
    })

    press(screen.getByTestId('community-confirm-alt-text'))

    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    expect(touchableSpy.props.get('community-confirm-alt-text')).toMatchObject({
      accessibilityState: { checked: true },
    })
    expect(touchableSpy.props.get('community-publish-button')?.accessibilityHint).toBe(
      undefined
    )

    // An emptied description closes the gate again.
    fireEvent.change(screen.getByTestId('community-alt-text-input'), {
      target: { value: '   ' },
    })
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).toBe('true')
    )
  })

  it('6.1-MOB-062 validates the caption against the contract and counts its characters', async () => {
    renderSheet()

    const caption = screen.getByTestId('community-caption-input')
    fireEvent.change(caption, { target: { value: 'Shop it at www.example.com' } })
    expect((await screen.findByTestId('community-caption-error')).textContent).toBe(
      enUS.community.validation.captionUrl
    )

    fireEvent.change(caption, { target: { value: 'Write to me@example.xyz' } })
    await waitFor(() =>
      expect(screen.getByTestId('community-caption-error').textContent).toBe(
        enUS.community.validation.captionEmail
      )
    )

    fireEvent.change(caption, { target: { value: 'a'.repeat(281) } })
    await waitFor(() =>
      expect(screen.getByTestId('community-caption-error').textContent).toBe(
        enUS.community.validation.captionTooLong
      )
    )
    expect(screen.getByTestId('community-caption-count').textContent).toBe(
      '281 of 280 characters'
    )

    fireEvent.change(caption, { target: { value: 'Merino under a waxed shell' } })
    await waitFor(() =>
      expect(screen.queryByTestId('community-caption-error')).toBeNull()
    )
  })

  it('6.1-MOB-063 leaves the sheet untouched when the picker is cancelled', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    })
    let allocateCalls = 0
    server.use(
      http.post('*/api/v1/community/posts/allocate', () => {
        allocateCalls += 1
        return HttpResponse.json(allocateSession())
      })
    )
    renderSheet()

    press(screen.getByTestId('community-pick-image-button'))

    await waitFor(() =>
      expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1)
    )
    await waitFor(() =>
      expect(screen.queryByTestId('community-publish-status')).toBeNull()
    )
    expect(allocateCalls).toBe(0)
    expect(screen.queryByTestId('community-post-preview-image')).toBeNull()
    expect(screen.queryByTestId('community-publish-error')).toBeNull()
  })

  it('6.1-MOB-064 renders the translated copy when photo permission is denied', async () => {
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    renderSheet()

    press(screen.getByTestId('community-pick-image-button'))

    const error = await screen.findByTestId('community-publish-error')
    expect(error.textContent).toBe(enUS.community.validation.permissionDenied)
    expect(error.getAttribute('role')).toBe('alert')
  })

  it('6.1-MOB-065 refuses an image below the minimum edge before it allocates anything', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tiny.jpg', width: 200, height: 900 }],
    })
    let allocateCalls = 0
    server.use(
      http.post('*/api/v1/community/posts/allocate', () => {
        allocateCalls += 1
        return HttpResponse.json(allocateSession())
      })
    )
    renderSheet()

    press(screen.getByTestId('community-pick-image-button'))

    expect((await screen.findByTestId('community-publish-error')).textContent).toBe(
      enUS.community.validation.imageTooSmall
    )
    expect(imageManipulator.manipulateAsync).not.toHaveBeenCalled()
    expect(allocateCalls).toBe(0)
  })

  it('6.1-MOB-066 narrates uploading, then screening and publishing', async () => {
    server.use(
      http.post('*/api/v1/community/posts/allocate', async () => {
        await delay(150)
        return HttpResponse.json(allocateSession())
      }),
      http.post('*/api/v1/community/posts/publish', async () => {
        await delay(150)
        return HttpResponse.json({ data: publishedItem })
      })
    )
    const { onPublished } = renderSheet()

    press(screen.getByTestId('community-pick-image-button'))
    expect((await screen.findByTestId('community-publish-status')).textContent).toContain(
      enUS.community.compose.uploading
    )

    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
      ).toBe(SUGGESTION)
    )
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    expect((await screen.findByTestId('community-publish-status')).textContent).toContain(
      enUS.community.compose.publishing
    )
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1))
    expect(onPublished).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'post-new-42' })
    )
  })

  it('6.1-MOB-067 maps a publish 429 onto the rate-limit copy, never the SDK wording', async () => {
    server.use(
      http.post('*/api/v1/community/posts/publish', () =>
        errorEnvelope(429, 'Daily post limit reached.')
      )
    )
    const { onPublished } = renderSheet()

    await pickAndAllocate()
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    expect((await screen.findByTestId('community-publish-error')).textContent).toBe(
      enUS.community.error.rateLimited
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
    expect(onPublished).not.toHaveBeenCalled()
  })

  it('6.1-MOB-095 tells a publish outage apart from the community kill switch', async () => {
    server.use(
      http.post('*/api/v1/community/posts/publish', () =>
        errorEnvelope(503, COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)
      )
    )
    renderSheet()

    await pickAndAllocate()
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    // `publishPost` answers 503 when the object it just checked can no longer be
    // signed, and the rollout kill switch answers 503 too, so message is the only
    // thing that separates them. Both used to collapse into the generic publish
    // failure, which told the author nothing about waiting.
    expect((await screen.findByTestId('community-publish-error')).textContent).toBe(
      enUS.community.error.mediaUnavailable
    )
    expect(screen.getByTestId('community-publish-error').textContent).not.toBe(
      enUS.community.error.disabled
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-068 opts into the weekly challenge, and can opt back out', async () => {
    let publishBody: unknown = null
    server.use(
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        publishBody = await request.json()
        return HttpResponse.json({ data: publishedItem })
      })
    )
    renderSheet({ challenge: CHALLENGE, defaultChallengeOptIn: true })

    const toggle = screen.getByTestId('community-post-challenge-toggle')
    expect(toggle.textContent).toContain(CHALLENGE.title)
    press(toggle)
    expect(screen.getByTestId('community-post-challenge-toggle').textContent).toContain(
      enUS.community.compose.challengeNone
    )
    press(screen.getByTestId('community-post-challenge-toggle'))

    await pickAndAllocate()
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    await waitFor(() => expect(publishBody).toBeTruthy())
    expect(publishBody).toMatchObject({ challengeId: CHALLENGE.id })
  })

  it('6.1-MOB-069 maps every failure reason onto a catalogue key, never onto a message', () => {
    const cases: [string, string][] = [
      ['signed_out', 'community.error.signedOut'],
      ['age_gate', 'community.error.ageGate'],
      ['not_found', 'community.error.notFound'],
      ['reason_changed', 'community.error.reasonChanged'],
      ['self_report', 'community.error.selfReport'],
      ['disabled', 'community.error.disabled'],
      ['media_unavailable', 'community.error.mediaUnavailable'],
      ['upload_failed', 'community.error.upload'],
      ['permission_denied', 'community.validation.permissionDenied'],
      ['picker_failed', 'community.validation.pickerFailed'],
      ['image_too_small', 'community.validation.imageTooSmall'],
    ]
    for (const [reason, key] of cases) {
      expect(
        communityErrorTranslation(
          new CommunityRequestError(
            reason as ConstructorParameters<typeof CommunityRequestError>[0],
            'Response returned an error code'
          ),
          'community.error.publish',
          'en-US'
        )
      ).toEqual({ key })
      expect(i18n.t(key)).not.toBe(key)
    }

    expect(
      communityErrorTranslation(new Error('anything'), 'community.error.publish', 'en-US')
    ).toEqual({ key: 'community.error.publish' })
    expect(
      communityErrorTranslation(
        new CommunityRequestError('rate_limited', 'slow down'),
        'community.error.publish',
        'en-US'
      )
    ).toEqual({ key: 'community.error.rateLimited' })

    const withTime = communityErrorTranslation(
      new CommunityRequestError('rate_limited', 'slow down', 900),
      'community.error.publish',
      'en-US'
    )
    expect(withTime.key).toBe('community.error.rateLimitedUntil')
    expect(withTime.options?.time).toMatch(/\d{1,2}:\d{2}/)
  })

  it('6.1-MOB-070 narrows the live language to a locale the screener accepts', () => {
    expect(renderHook(() => useResolvedCommunityLocale('fr-FR')).result.current).toBe(
      'fr-FR'
    )
    // An unsupported tag must not be sent to a multilingual screener as-is.
    expect(renderHook(() => useResolvedCommunityLocale('xx-YY')).result.current).toBe(
      'en-US'
    )
  })

  it('6.1-MOB-071 has no axe violations', async () => {
    renderSheet({ challenge: CHALLENGE })
    const sheet = screen.getByTestId('community-post-sheet')
    // react-native-web promotes `role="dialog"` only once the open animation ends,
    // so scanning earlier reports RNW's transient markup rather than this sheet's.
    await waitFor(() => expect(sheet.getAttribute('role')).toBe('dialog'))

    const results = await runAxe(document.body, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })

    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])

    /*
     * The regression this guards, same shape as the report modal's radios: React
     * Native's `accessibilityState` object never reaches the web DOM, so both
     * `role="checkbox"` rows rendered with no `aria-checked` and axe failed
     * `aria-required-attr` under WCAG 4.1.2. Asserting the attribute directly means
     * dropping the `aria-checked` prop fails here by name.
     */
    expect(
      Array.from(document.querySelectorAll('[role="checkbox"]'), (node) =>
        node.getAttribute('aria-checked')
      )
    ).toEqual(['false', 'false'])
  })
})
