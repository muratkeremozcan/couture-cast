import { userEvent as browserUser } from '@vitest/browser/context'
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn().mockResolvedValue(undefined) }))
// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the mobile community feed screen and its HTTP client.
//
// The network boundary stays REAL and is driven through MSW; `@/src/lib/community` is
// kept live through passthrough spies. Three of the states here are reachable only through a
// rejected request (401, 409 already-reported, 429 with Retry-After), and the first
// draft of this screen rendered `error.message` straight from the SDK, so a 429, a 409
// and a 500 all read as "Response returned an error code". A mocked client proves none
// of that.
//
// Native modules use test doubles; community client spies call the real HTTP path. `src/lib/community.ts` imports `expo-image-picker`,
// `expo-image-manipulator`, `expo-file-system` and `expo-crypto` LAZILY because they
// pull in `expo-modules-core`, which cannot be evaluated in a browser bundle.
//
// Fixture image URLs are `data:` URIs. react-native-web's `Image` really loads the URI
// through `ImageLoader` and renders a second `<img src>` for the context menu, so an
// unreachable host fires the card's `onError`, which asks the screen to refetch the
// feed and puts phantom requests into every request-count assertion in this file.
/*
 * `vitest-browser-react`'s `render` and this repo's `press` helper return plain values;
 * every sibling screen suite awaits them so the call sites read the same way.
 */
/* eslint-disable @typescript-eslint/await-thenable */
import React, { createElement } from 'react'
import { CommunityReactionState } from '@couture/api-client'
import * as communityClient from '@/src/lib/community'
// Passthrough spies observe completed real HTTP promises for discarded responses.
vi.mock('@/src/lib/community', { spy: true })
import { Buffer } from 'buffer'
import type * as ReactNativeModule from 'react-native'
import {
  act,
  configure,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { cleanup, render } from 'vitest-browser-react'
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
import { CLIMATE_BANDS } from '@couture/utils'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  communityBandUnresolvedReasonSchema,
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
  encodeCommunityFeedCursor,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityReactionFeed as CommunityFeed,
  type CommunityReactionFeedItem as CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityPostStatus,
} from '@couture/api-client/contracts/http'

let mockParams: Record<string, string> = {}
const mockSetParams = vi.fn()
const mockPush = vi.fn()
const mockRouter = { setParams: mockSetParams, push: mockPush }

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const mockCapture = vi.fn()
const mockAnalytics = {
  capture: mockCapture,
  getDistinctId: () => 'test-user-id',
  screen: vi.fn(),
}
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => mockAnalytics,
  MobileAnalyticsDiagnosticsPanel: () => null,
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
 * `Platform.OS` is redefined per test because the screen's accessibility-focus
 * restore only runs off web, and react-native-web's own `findNodeHandle` throws
 * unconditionally. Same shape as `wardrobe/capsule-builder-modal.test.tsx`.
 */
// Match the established CommunityCard harness: retain the real RNW Image and
// record its native onError prop, which a DOM error event cannot reach.
const imageEvents = vi.hoisted(() => ({
  errors: new Map<string, () => void>(),
  createElement: null as unknown as typeof React.createElement,
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  function RecordingImage(props: Record<string, unknown>) {
    if (typeof props.testID === 'string' && typeof props.onError === 'function') {
      imageEvents.errors.set(props.testID, props.onError as () => void)
    }
    return imageEvents.createElement(actual.Image as never, props)
  }
  return {
    ...actual,
    Image: RecordingImage,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

imageEvents.createElement = createElement

import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { CommunityScreen } from '@/src/features/community/community-screen'
import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'
import {
  CommunityRequestError,
  communityFailureReason,
  communityRetryAfterSeconds,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  pickCommunityPhoto,
  reportCommunityPostFromMobile,
} from '@/src/lib/community'

const FEED_ROUTE = '*/api/v1/community/feed'
const UPLOAD_URL = 'https://mock-upload.test/upload'

/** A real 1x1 PNG, so `ImageLoader` resolves without touching the network. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SDK_ERROR_MESSAGE = 'Response returned an error code'

const IMAGE_REFERENCE_NOW = Date.parse('2026-10-19T12:00:00.000Z')
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(IMAGE_REFERENCE_NOW)
})

function imageAccess(expiresInMs = 3_600_000) {
  return { url: PIXEL, expiresAt: new Date(Date.now() + expiresInMs).toISOString() }
}

function item(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 'post-a',
    caption: 'Layered wool over a merino base for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
    climateBand: 'temperate_dry',
    imageAccess: imageAccess(),
    publishedAt: '2026-09-05T12:00:00.000Z',
    createdAt: '2026-09-05T11:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer A1B2', isSelf: false },
    ...overrides,
  }
}

function authorState(
  status: CommunityPostStatus,
  overrides: Partial<CommunityAuthorPostState> = {}
): CommunityAuthorPostState {
  return {
    id: `own-${status}`,
    caption: null,
    altText: null,
    climateBand: null,
    imageAccess: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    publishedAt: null,
    status,
    challengeId: null,
    moderationReason: null,
    ...overrides,
  }
}

function feed(overrides: Partial<CommunityFeed> = {}): CommunityFeed {
  return {
    items: [item()],
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    viewerBand: 'temperate_dry',
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: null,
    ...overrides,
  }
}

/**
 * The contract's cursor codec is Node's `Buffer`, and this suite runs in a real
 * browser where there is no `Buffer` at all, so `encodeCommunityFeedCursor` is not
 * callable here without this. Minting is not negotiable: a hand-written literal
 * cannot express the mode-and-band binding the recovery below turns on, and the
 * encoder parses before it encodes, so it is also what makes a future required
 * field a compile error rather than a silently passing test.
 *
 * The one `buffer` package this monorepo resolves to anywhere is 5.7.1, and its
 * `toString` switch has no `'base64url'` case at all -- so this is not a bundling
 * or pre-optimization timing gap that `optimizeDeps.include` would fix, it is a
 * missing feature in the only version available. Patched narrowly, here, rather
 * than in `vitest.config.ts`: nothing else in this browser-mode suite mints a
 * cursor, so nothing else needs it, and reaching for a newer `buffer` dependency
 * for one test file's sake would be a wider change than the gap it closes.
 */
const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
browserGlobal.Buffer ??= Buffer
const supportsBase64Url = (() => {
  try {
    return Buffer.from('a').toString('base64url' as BufferEncoding) === 'YQ'
  } catch {
    // buffer@5.7.1 throws on an encoding it does not recognise rather than
    // returning something wrong, which is exactly the case this check exists
    // to detect.
    return false
  }
})()
if (!supportsBase64Url) {
  const encodeBase64: (encoding: BufferEncoding, ...rest: never[]) => string =
    Buffer.prototype.toString
  Buffer.prototype.toString = function toStringWithBase64Url(
    this: Buffer,
    encoding?: BufferEncoding,
    ...rest: never[]
  ) {
    if (encoding !== 'base64url') {
      return encodeBase64.call(this, encoding as BufferEncoding, ...rest)
    }
    return encodeBase64
      .call(this, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  } as typeof Buffer.prototype.toString
}

function cursor(band: ClimateBand | null, mode: CommunityFeedMode = 'auto') {
  return encodeCommunityFeedCursor({
    publishedAt: '2026-09-05T12:00:00.000Z',
    id: 'post-a',
    mode,
    band,
  })
}

const CHALLENGE = {
  id: 'challenge-autumn',
  slug: 'autumn-layers',
  climateBand: 'temperate_dry' as const,
  title: 'Autumn Layers Challenge',
  body: 'Style your favourite transitional layering pieces for temperate weather.',
  startsAt: '2026-08-31T00:00:00.000Z',
  endsAt: '2026-09-07T00:00:00.000Z',
  timeZone: 'Europe/Istanbul',
}

const feedJson = (overrides: Partial<CommunityFeed> = {}) =>
  HttpResponse.json({ data: feed(overrides) })

const errorEnvelope = (
  status: number,
  message: string,
  headers?: Record<string, string>
) =>
  HttpResponse.json(
    { statusCode: status, message, error: 'Error' },
    { status, ...(headers ? { headers } : {}) }
  )

/** Every feed URL this test file caused, in order. */
let feedUrls: URL[] = []

function serveFeed(respond: (url: URL, index: number) => Response | Promise<Response>) {
  server.use(
    http.get(FEED_ROUTE, ({ request }) => {
      const url = new URL(request.url)
      feedUrls.push(url)
      return respond(url, feedUrls.length - 1)
    })
  )
}

describe('Mobile community screen (Story 6.1)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
    // Every state here is one MSW service-worker round trip away, which can
    // outrun the 1000ms default on a loaded runner.
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    mockParams = {}
    imageEvents.errors.clear()
    feedUrls = []
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
    serveFeed(() => feedJson())
  })

  afterEach(async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    await i18n.changeLanguage('en-US')
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    // A test that publishes leaves one refresh read in flight, and MSW's service
    // worker can dispatch it to a handler a few milliseconds after the unmount
    // aborts it. Settling here keeps that request inside the test that caused it
    // rather than letting it land in the next test's request log.
    await delay(50)
  })

  // --- Feed states ----------------------------------------------------------

  it('6.1-MOB-001 shows loading skeletons first, then the feed', async () => {
    serveFeed(async () => {
      await delay(120)
      return feedJson()
    })

    await render(<CommunityScreen />)

    expect(screen.getAllByTestId('community-feed-skeleton')).toHaveLength(3)

    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryAllByTestId('community-feed-skeleton')).toHaveLength(0)
  })

  it('6.1-MOB-002 renders the localized empty state and its share CTA', async () => {
    serveFeed(() => feedJson({ items: [] }))

    await render(<CommunityScreen />)

    const empty = await screen.findByTestId('community-feed-empty')
    expect(empty.textContent).toContain(enUS.community.feed.emptyTitle)
    expect(empty.textContent).toContain(enUS.community.feed.emptyBody)

    press(screen.getByTestId('community-feed-empty-cta'))
    await screen.findByTestId('community-post-sheet')
  })

  it('6.1-MOB-003 renders the load failure for a 500 and recovers through Retry', async () => {
    serveFeed((_url, index) =>
      index === 0 ? errorEnvelope(500, 'Internal server error.') : feedJson()
    )

    await render(<CommunityScreen />)

    const panel = await screen.findByTestId('community-feed-error')
    expect(panel.textContent).toContain(enUS.community.error.load)
    expect(panel.textContent).not.toContain(enUS.community.error.signedOut)
    // The reason travels and the words do not: never the SDK's own wording.
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)

    press(screen.getByTestId('community-feed-retry'))

    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    expect(feedUrls).toHaveLength(2)
  })

  it('6.1-MOB-004 reads differently for a 401 than for a 500', async () => {
    serveFeed(() => errorEnvelope(401, 'Unauthorized'))

    await render(<CommunityScreen />)

    const panel = await screen.findByTestId('community-feed-error')
    expect(panel.textContent).toContain(enUS.community.error.signedOut)
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it.each(communityBandUnresolvedReasonSchema.options)(
    '6.1-MOB-005 explains an unresolved band for %s',
    async (reason) => {
      serveFeed(() =>
        feedJson({ viewerBand: null, bandResolved: false, bandUnresolvedReason: reason })
      )

      await render(<CommunityScreen />)

      const notice = await screen.findByTestId('community-band-unresolved')
      expect(notice.textContent).toBe(enUS.community.band.unresolved[reason])
    }
  )

  it('6.1-MOB-082 shares its one live region with the invalid deep-link notice', async () => {
    mockParams = { source: 'notification', type: 'community' }

    await render(<CommunityScreen />)

    const banner = await screen.findByTestId('deep-link-info-banner')
    expect(banner.textContent).toContain(enUS.community.deepLink.invalid)
    expect(banner.getAttribute('aria-live')).toBe('polite')
    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({ surface: 'mobile' })
    )

    // The notice is advisory, so the tab has to stay usable once it is dismissed.
    await browserUser.click(screen.getByLabelText('Dismiss banner'))
    await waitFor(() => expect(screen.queryByTestId('deep-link-info-banner')).toBeNull())
    expect(screen.getByTestId('community-screen')).toBeTruthy()
  })

  it('6.1-MOB-094 resolves a deep-linked look from the API and draws it once', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    let postReads = 0
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) => {
        postReads += 1
        return HttpResponse.json({ data: item({ id: params.postId as string }) })
      })
    )

    await render(<CommunityScreen />)

    const highlight = await screen.findByTestId('highlighted-community-card-post-a')
    expect(postReads).toBe(1)

    // A real card rather than a synthetic one: the alt text the author had to
    // confirm and the moderation control are both present, and neither could be on
    // a card built from a `lookbook:new` event, which carries neither.
    expect(
      screen.getByTestId('community-card-image-post-a').getAttribute('aria-label')
    ).toBe(item().altText)
    expect(screen.getByTestId('community-card-report-post-a')).toBeTruthy()

    // The same look is also on the first feed page. It is drawn once, at the top.
    expect(screen.getAllByTestId('community-post-card-post-a')).toHaveLength(1)
    expect(highlight.contains(screen.getByTestId('community-post-card-post-a'))).toBe(
      true
    )

    // No separate visible badge: web's own highlighted card carries none, only a
    // border treatment, so this reuses web's existing announcement key instead of
    // inventing a new one that would have needed translating on a surface this
    // session may not touch.
    //
    // `waitFor`, not a synchronous assertion: `findByTestId` above resolves the
    // moment the highlighted card lands in the DOM, which a real browser can do
    // before the effect that announces it has actually run.
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        enUS.community.feed.announceFocused
      )
    )
  })

  it('6.1-MOB-084 drops a deep-link target that resolves after the tab was left', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-42' }
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        await delay(200)
        return HttpResponse.json({ data: item({ id: 'look-42' }) })
      })
    )

    await render(<CommunityScreen />)
    cleanup()

    // The resolution outlived the screen, so it must neither report a failure nor
    // set state on a component that is gone.
    await delay(400)
    expect(mockCapture).not.toHaveBeenCalled()
  })

  // --- Filtering and paging -------------------------------------------------

  it('6.1-MOB-006 offers auto, all and the six climate bands, every chip enabled', async () => {
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    for (const mode of ['auto', 'all', ...CLIMATE_BANDS]) {
      const chip = screen.getByTestId(`community-filter-chip-${mode}`)
      expect(chip.getAttribute('aria-disabled')).not.toBe('true')
    }

    // `accessibilityState` is native-only and react-native-web drops it, so the
    // active chip is identified here by its non-colour cue. The announced
    // selection itself is asserted in `components/community/community-filter-chips.test.tsx`.
    const autoChip = screen.getByTestId('community-filter-chip-auto')
    expect(autoChip.style.borderWidth).toBe('2px')
    // The resolved band rides on the `auto` chip's own label.
    expect(autoChip.textContent).toBe('Your climate: Temperate and dry')
    expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe('1px')
  })

  it('6.1-MOB-007 sends mode=<band> and drops the held cursor when the filter changes', async () => {
    serveFeed((url) => {
      if (url.searchParams.get('mode') === 'warm_wet') {
        return feedJson({ items: [item({ id: 'post-warm' })], mode: 'warm_wet' })
      }
      return url.searchParams.get('cursor')
        ? feedJson({ items: [item({ id: 'post-b' })], nextCursor: null })
        : feedJson({ nextCursor: 'cursor-auto-2' })
    })

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-b')

    press(screen.getByTestId('community-filter-chip-warm_wet'))
    await screen.findByTestId('community-post-card-post-warm')

    const latest = feedUrls[feedUrls.length - 1]
    expect(latest?.searchParams.get('mode')).toBe('warm_wet')
    // The cursor embeds the mode it was minted under; carrying it across is a 400.
    expect(latest?.searchParams.get('cursor')).toBeNull()
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    expect(screen.queryByTestId('community-post-card-post-b')).toBeNull()
  })

  it('6.1-MOB-008 never lets an abandoned filter overwrite the current one', async () => {
    serveFeed(async (url) => {
      const mode = url.searchParams.get('mode')
      if (mode === 'cold_wet') {
        // The abandoned request outlives the filter it was issued for.
        await delay(300)
        return feedJson({ items: [item({ id: 'post-cold' })], mode: 'cold_wet' })
      }
      if (mode === 'warm_dry') {
        return feedJson({ items: [item({ id: 'post-warm' })], mode: 'warm_dry' })
      }
      return feedJson()
    })

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(screen.getByTestId('community-filter-chip-cold_wet'))
    press(screen.getByTestId('community-filter-chip-warm_dry'))

    await screen.findByTestId('community-post-card-post-warm')
    await delay(400)

    expect(screen.queryByTestId('community-post-card-post-cold')).toBeNull()
    expect(screen.getByTestId('community-post-card-post-warm')).toBeTruthy()
    expect(screen.getByTestId('community-filter-chip-warm_dry').style.borderWidth).toBe(
      '2px'
    )
  })

  it('6.1-MOB-009 pages on the keyset cursor and appends without duplicating', async () => {
    serveFeed((url) =>
      url.searchParams.get('cursor') === 'cursor-page-2'
        ? feedJson({
            // The server may repeat a boundary row; the client must not.
            items: [item({ id: 'post-a' }), item({ id: 'post-b' })],
            nextCursor: null,
          })
        : feedJson({ nextCursor: 'cursor-page-2' })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-b')

    const paged = feedUrls.find((url) => url.searchParams.get('cursor') !== null)
    expect(paged?.searchParams.get('cursor')).toBe('cursor-page-2')
    expect(paged?.searchParams.get('mode')).toBe('auto')
    expect(screen.getAllByTestId('community-post-card-post-a')).toHaveLength(1)
  })

  it('6.1-MOB-079 keeps the feed on screen when the next page fails, and speaks beside it', async () => {
    serveFeed((url) =>
      url.searchParams.get('cursor')
        ? errorEnvelope(500, 'Internal server error.')
        : feedJson({ nextCursor: 'cursor-page-2' })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))

    // A first page that fails owns the screen; a next page that fails keeps what
    // is already there.
    const panel = await screen.findByTestId('community-action-error')
    expect(screen.getByTestId('community-post-card-post-a')).toBeTruthy()
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
    /*
     * The fallback key travels with the failure. It used to be
     * `community.error.withdraw` for EVERY unclassified action failure, so a
     * next-page read that 500'd told the reader "We could not withdraw this
     * look. It is still in the feed." after tapping Load more.
     */
    expect(panel.textContent).toBe(enUS.community.error.load)
    expect(panel.textContent).not.toBe(enUS.community.error.withdraw)
  })

  it('6.1-MOB-089 restarts paging on a rejected cursor and never sends it twice', async () => {
    // Both cursors are real: the band is what changes between them, which is the
    // whole mechanism. Under `auto` the server recomputes the band per request
    // from weather guaranteed fresh for 60 minutes, so a snapshot going stale
    // between two pages of one scroll is enough to invalidate the held cursor.
    const staleCursor = cursor('temperate_dry')
    const freshCursor = cursor('cold_dry')

    serveFeed((url) => {
      const sent = url.searchParams.get('cursor')
      if (sent === staleCursor) {
        return errorEnvelope(400, COMMUNITY_CURSOR_INVALID_MESSAGE)
      }
      if (sent === freshCursor) {
        return feedJson({ items: [item({ id: 'post-page-2' })], nextCursor: null })
      }
      return feedUrls.length === 1
        ? feedJson({ nextCursor: staleCursor })
        : feedJson({ items: [item({ id: 'post-restarted' })], nextCursor: freshCursor })
    })

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-feed-load-more'))

    await screen.findByTestId('community-post-card-post-restarted')

    // Silent recovery. This is normal operation on `auto`, not a fault, and the
    // reader is given no error to act on because there is nothing for them to do.
    expect(screen.queryByTestId('community-action-error')).toBeNull()
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    // Paging restarted, so the page the dead cursor came from is gone.
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-page-2')

    // THE ASSERTION THAT CATCHES THE LOOP. Surfacing an error and stopping there
    // left `nextCursor` holding the dead cursor while `feedState` stayed `ready`,
    // so `onEndReached` at threshold 0.5 re-sent it on every scroll, forever.
    // Counting the sends is what distinguishes a recovery from a retry storm; an
    // assertion that some error appeared would have passed against the defect.
    const staleSends = feedUrls.filter(
      (url) => url.searchParams.get('cursor') === staleCursor
    )
    expect(staleSends).toHaveLength(1)
  })

  it('6.1-MOB-090 shows the arm it is actually being served, not the one it asked for', async () => {
    // Half the beta cohort. The client requests `auto` by default and the server
    // resolves it to the viewer's assigned arm, so an `all` viewer used to see the
    // `auto` chip pressed and labelled "Your climate: ..." over every region.
    serveFeed(() => feedJson({ mode: 'all', experimentVariant: 'all' }))

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe('2px')
    expect(screen.getByTestId('community-filter-chip-auto').style.borderWidth).toBe('1px')
    expect(screen.getByTestId('community-filter-chip-auto').textContent).toBe(
      enUS.community.filters.mode.auto
    )
    // Still one read: the served mode is display state, so adopting it must not
    // send the screen round again.
    expect(feedUrls).toHaveLength(1)
  })

  it('6.1-MOB-091 explains an unresolved band only where it changed what was served', async () => {
    serveFeed((url) =>
      feedJson({
        // A pinned band and `all` are both served exactly as asked whether or not
        // the viewer's own band resolves, so neither has anything to explain.
        mode: (url.searchParams.get('mode') ?? 'auto') as CommunityFeedMode,
        viewerBand: null,
        bandResolved: false,
        bandUnresolvedReason: 'no_location',
      })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-band-unresolved')

    press(screen.getByTestId('community-filter-chip-warm_dry'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
    )

    press(screen.getByTestId('community-filter-chip-all'))
    await waitFor(() =>
      expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe(
        '2px'
      )
    )
    expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
  })

  it('6.1-MOB-092 records a card open with the arm the feed was served in', async () => {
    const opened: { postId: string; body: unknown }[] = []
    serveFeed(() => feedJson({ mode: 'all', experimentVariant: 'all' }))
    server.use(
      http.post(
        '*/api/v1/community/posts/:postId/opened',
        async ({ params, request }) => {
          opened.push({ postId: params.postId as string, body: await request.json() })
          return HttpResponse.json({ tracked: true })
        }
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-open-post-a'))

    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]?.postId).toBe('post-a')
    // Sent rather than re-derived, so the open is attributed to the feed the
    // viewer actually saw. `isSelf` is absent because the server decides it: the
    // gate counts non-self opens and this client never compares ids.
    expect(opened[0]?.body).toEqual({ experimentVariant: 'all' })
  })

  it('6.1-MOB-093 keeps a failed card open away from the reader', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/opened', () =>
        errorEnvelope(500, 'Internal server error.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-open-post-a'))

    // Measurement only. A dropped open costs a data point; interrupting someone
    // reading the feed to say so costs more.
    await delay(100)
    expect(screen.queryByTestId('community-action-error')).toBeNull()
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-080 gives accessibility focus back to the card that opened the dialog', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(55)

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))
    await screen.findByTestId('community-report-modal')

    press(screen.getByTestId('cancel-report-button'))

    // react-native-web's Modal restores focus itself; on a native surface the
    // screen has to hand it back to the invoking card explicitly.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(55)
    )
  })

  // --- Author states --------------------------------------------------------

  it('6.2-MOB-001 explains a stable screening code in words, never as the raw code', async () => {
    serveFeed(() =>
      feedJson({
        authorStates: [
          authorState('flagged', { moderationReason: 'text_policy_match' }),
          authorState('review_failed', {
            moderationReason: 'inference_timeout, low_confidence',
          }),
        ],
      })
    )

    await render(<CommunityScreen />)

    await screen.findByTestId('community-author-states')
    expect(
      screen.getByTestId('community-author-state-reason-own-flagged').textContent
    ).toBe(enUS.community.moderationReason.language)
    // A joined list reads as one sentence per category, in schema order.
    expect(
      screen.getByTestId('community-author-state-reason-own-review_failed').textContent
    ).toBe(
      `${enUS.community.moderationReason.photoUnconfirmed} ${enUS.community.moderationReason.incomplete}`
    )
  })

  it('6.2b-MOB-001 tells the author to upload again when the stored photo failed verification', async () => {
    // Story 6.2b review (RF12): the worker persists the validation code it
    // caught, and the five upload failures reached the author raw.
    serveFeed(() =>
      feedJson({
        authorStates: [
          authorState('review_failed', { moderationReason: 'IMAGE_DECODE_FAILED' }),
        ],
      })
    )

    await render(<CommunityScreen />)

    const section = await screen.findByTestId('community-author-states')
    expect(
      screen.getByTestId('community-author-state-reason-own-review_failed').textContent
    ).toBe(enUS.community.moderationReason.upload)
    expect(section.textContent).not.toContain('IMAGE_DECODE_FAILED')
  })

  it('6.1-MOB-010 renders author states in their own section, never in the grid', async () => {
    const explained = [
      'flagged',
      'review_failed',
      'withdrawn',
      'consent_suspended',
    ] as const
    serveFeed(() =>
      feedJson({
        authorStates: [
          ...explained.map((status) =>
            authorState(status, { moderationReason: `${status} reason` })
          ),
          authorState('pending_review'),
        ],
      })
    )

    await render(<CommunityScreen />)

    const section = await screen.findByTestId('community-author-states')
    expect(section.textContent).toContain(enUS.community.feed.yourPostsTitle)

    for (const status of explained) {
      const id = `own-${status}`
      expect(screen.getByTestId(`community-author-state-status-${id}`).textContent).toBe(
        enUS.community.status[status]
      )
      expect(
        screen.getByTestId(`community-author-state-explanation-${id}`).textContent
      ).toBe(enUS.community.removed[status])
      expect(screen.getByTestId(`community-author-state-reason-${id}`).textContent).toBe(
        `Reason: ${status} reason`
      )
      // `items` is published rows only; an author state never joins the grid.
      expect(screen.queryByTestId(`community-post-card-${id}`)).toBeNull()
    }

    expect(
      screen.getByTestId('community-author-state-status-own-pending_review').textContent
    ).toBe(enUS.community.status.pending_review)
    expect(
      screen.queryByTestId('community-author-state-explanation-own-pending_review')
    ).toBeNull()
    expect(
      screen.queryByTestId('community-author-state-reason-own-pending_review')
    ).toBeNull()
  })

  // --- Report ---------------------------------------------------------------

  it('6.1-MOB-011 offers Withdraw on own looks and Report on everyone else’s', async () => {
    serveFeed(() =>
      feedJson({
        items: [
          item(),
          item({ id: 'post-self', author: { displayName: 'You', isSelf: true } }),
        ],
      })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-self')

    expect(screen.getByTestId('community-card-report-post-a')).toBeTruthy()
    expect(screen.queryByTestId('community-card-withdraw-post-a')).toBeNull()
    expect(screen.getByTestId('community-card-withdraw-post-self')).toBeTruthy()
    expect(screen.queryByTestId('community-card-report-post-self')).toBeNull()
  })

  it('6.1-MOB-012 submits a report and settles the control into Reported and disabled', async () => {
    let body: unknown = null
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-spam'))
    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: 'Reposted stock photography.' },
    })
    press(screen.getByTestId('submit-report-button'))

    await waitFor(() =>
      expect(body).toEqual({ reason: 'spam', details: 'Reposted stock photography.' })
    )
    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())

    const control = screen.getByTestId('community-card-report-post-a')
    expect(control.textContent).toBe(enUS.community.card.reported)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.report.success
    )
  })

  /**
   * A duplicate report of the SAME reason answers 200: `community.repository.ts`
   * replays the stored row and its P2002 race resolves the same way. The settled
   * control is what makes the second tap impossible; the client carried an
   * `already_reported` reason until the constant behind it turned out to be thrown by
   * nothing.
   */
  it('6.1-MOB-013 settles the control on a replayed report so a second tap is impossible', async () => {
    let reportCalls = 0
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () => {
        reportCalls += 1
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-harassment'))
    press(screen.getByTestId('submit-report-button'))

    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())

    const control = screen.getByTestId('community-card-report-post-a')
    expect(control.textContent).toBe(enUS.community.card.reported)
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.report.success
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)

    press(control)
    expect(screen.queryByTestId('community-report-modal')).toBeNull()
    expect(reportCalls).toBe(1)
  })

  it('6.1-MOB-072 says why a self-report was refused, from the 403 the service sends', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(403, COMMUNITY_SELF_REPORT_MESSAGE)
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-spam'))
    press(screen.getByTestId('submit-report-button'))

    // The refusal is a ForbiddenException, so reading it as a conflict left this
    // string unreachable and the reader saw the generic report failure instead.
    expect((await screen.findByTestId('report-error-message')).textContent).toBe(
      enUS.community.error.selfReport
    )
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-014 renders the plain rate-limit copy for a 429 with no Retry-After', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(429, 'Too many reports.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-other'))
    press(screen.getByTestId('submit-report-button'))

    const message = await screen.findByTestId('report-error-message')
    expect(message.textContent).toBe(enUS.community.error.rateLimited)
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-015 folds the Retry-After time into the rate-limit copy', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () =>
        errorEnvelope(429, 'Too many reports.', { 'Retry-After': '900' })
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))

    await screen.findByTestId('community-report-modal')
    press(screen.getByTestId('report-reason-violence'))
    press(screen.getByTestId('submit-report-button'))

    const message = await screen.findByTestId('report-error-message')
    const [prefix] = enUS.community.error.rateLimitedUntil.split('{{time}}')
    // Asserted as a prefix plus a clock time rather than an exact string: the
    // wall-clock minute can roll over between the render and this assertion.
    expect(message.textContent?.startsWith(prefix ?? '')).toBe(true)
    expect(message.textContent).toMatch(/\d{1,2}:\d{2}/)
    expect(message.textContent).not.toBe(enUS.community.error.rateLimited)
  })

  // --- Withdraw -------------------------------------------------------------

  it('6.1-MOB-016 withdraws a look, then re-reads the feed rather than guessing', async () => {
    let withdrawnPostId: string | null = null
    serveFeed((_url, index) =>
      index === 0
        ? feedJson({
            items: [
              item({ id: 'post-self', author: { displayName: 'You', isSelf: true } }),
            ],
          })
        : feedJson({ items: [], authorStates: [authorState('withdrawn')] })
    )
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', ({ params }) => {
        withdrawnPostId = params.postId as string
        return HttpResponse.json({ tracked: true })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-withdraw-post-self'))

    await waitFor(() => expect(withdrawnPostId).toBe('post-self'))
    await screen.findByTestId('community-author-state-own-withdrawn')
    expect(screen.queryByTestId('community-post-card-post-self')).toBeNull()
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.removed.withdrawn
    )
    expect(feedUrls).toHaveLength(2)
  })

  it('6.1-MOB-017 says a withdraw failed and leaves the look in the feed', async () => {
    serveFeed(() =>
      feedJson({
        items: [item({ id: 'post-self', author: { displayName: 'You', isSelf: true } })],
      })
    )
    server.use(
      http.post('*/api/v1/community/posts/:postId/withdraw', () =>
        errorEnvelope(500, 'Internal server error.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-withdraw-post-self'))

    const panel = await screen.findByTestId('community-action-error')
    expect(panel.textContent).toBe(enUS.community.error.withdraw)
    // The success notice must not fire on a failure, and the look stays put.
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    expect(screen.getByTestId('community-post-card-post-self')).toBeTruthy()
    expect(feedUrls).toHaveLength(1)
  })

  // --- Compose --------------------------------------------------------------

  it('6.1-MOB-018 publishes a flat body with confirmed alt text on one idempotency key', async () => {
    const suggestion = 'A layered outfit photographed against a plain wall.'
    const seen: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/community/posts/allocate', async ({ request }) => {
        seen.allocateBody = await request.json()
        seen.allocateKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: {
            postId: 'post-new-42',
            uploadSessionId: 'session-42',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'token-42',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            altTextSuggestion: suggestion,
            altTextSuggestionLocale: 'en-US',
          },
        })
      }),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        seen.publishBody = await request.json()
        seen.publishKey = request.headers.get('idempotency-key')
        return HttpResponse.json({
          data: item({
            id: 'post-new-42',
            status: 'pending_review',
            publishedAt: null,
            author: { displayName: 'You', isSelf: true },
          }),
        })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')

    // The suggestion is the SERVER's, landed in a field the author can edit.
    const altInput = screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input')
    await waitFor(() => expect(altInput.value).toBe(suggestion))

    const publishButton = screen.getByTestId('community-publish-button')
    expect(publishButton.getAttribute('aria-disabled')).toBe('true')

    const captionInput = screen.getByTestId('community-caption-input')
    fireEvent.change(captionInput, { target: { value: 'Look at https://bad-link.com' } })
    expect((await screen.findByTestId('community-caption-error')).textContent).toBe(
      enUS.community.validation.captionUrl
    )

    fireEvent.change(captionInput, { target: { value: 'Ask me at me@example.xyz' } })
    await waitFor(() =>
      expect(screen.getByTestId('community-caption-error').textContent).toBe(
        enUS.community.validation.captionEmail
      )
    )

    fireEvent.change(captionInput, { target: { value: 'Clean aesthetic daily style' } })
    await waitFor(() =>
      expect(screen.queryByTestId('community-caption-error')).toBeNull()
    )

    expect(publishButton.getAttribute('aria-disabled')).toBe('true')
    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(publishButton.getAttribute('aria-disabled')).not.toBe('true')
    )

    press(publishButton)

    await waitFor(() => expect(seen.publishBody).toBeTruthy())
    expect(seen.publishBody).toEqual({
      postId: 'post-new-42',
      uploadSessionId: 'session-42',
      altText: suggestion,
      altTextConfirmed: true,
      caption: 'Clean aesthetic daily style',
      locale: 'en-US',
    })
    expect(seen.allocateBody).toEqual({
      locale: 'en-US',
      contentType: 'image/jpeg',
      byteSize: 4,
      sha256: '0'.repeat(64),
      widthPx: 1200,
      heightPx: 1200,
    })
    expect(seen.allocateKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    // One key per attempt, so a retry replays the session instead of allocating a second.
    expect(seen.publishKey).toBe(seen.allocateKey)

    await waitFor(() => expect(screen.queryByTestId('community-post-sheet')).toBeNull())
    expect(screen.getByTestId('deep-link-info-banner').textContent).toContain(
      enUS.community.compose.success
    )
  })

  it('6.1-MOB-019 aborts the publish when the byte upload fails', async () => {
    let publishCalls = 0
    server.use(
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 500 })),
      http.post('*/api/v1/community/posts/publish', () => {
        publishCalls += 1
        return HttpResponse.json({ data: item() })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))

    const error = await screen.findByTestId('community-publish-error')
    expect(error.textContent).toBe(enUS.community.error.upload)
    // Never fall through to publish against bytes that never landed.
    expect(publishCalls).toBe(0)
    expect(
      screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('6.1-MOB-020 screens the caption and alt text in the reader’s own locale', async () => {
    await i18n.changeLanguage('fr-FR')
    const seen: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/community/posts/allocate', async ({ request }) => {
        seen.allocateBody = await request.json()
        return HttpResponse.json({
          data: {
            postId: 'post-fr',
            uploadSessionId: 'session-fr',
            uploadUrl: UPLOAD_URL,
            uploadToken: 'token-fr',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            altTextSuggestion: 'Un manteau de laine sur une maille crème.',
            altTextSuggestionLocale: 'fr-FR',
          },
        })
      }),
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        seen.publishBody = await request.json()
        return HttpResponse.json({ data: item({ id: 'post-fr' }) })
      })
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-new-post-button'))
    await screen.findByTestId('community-post-sheet')

    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')
    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input').value
      ).toContain('manteau')
    )

    press(screen.getByTestId('community-confirm-alt-text'))
    await waitFor(() =>
      expect(
        screen.getByTestId('community-publish-button').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    press(screen.getByTestId('community-publish-button'))

    await waitFor(() => expect(seen.publishBody).toBeTruthy())
    // Hardcoding 'en-US' here screened every non-English caption as English.
    expect(seen.allocateBody).toMatchObject({ locale: 'fr-FR' })
    expect(seen.publishBody).toMatchObject({ locale: 'fr-FR' })
  })

  it('6.1-MOB-021 opts a look into the weekly challenge from the banner CTA', async () => {
    let publishBody: unknown = null
    serveFeed(() => feedJson({ activeChallenge: CHALLENGE }))
    server.use(
      http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
      http.post('*/api/v1/community/posts/publish', async ({ request }) => {
        publishBody = await request.json()
        return HttpResponse.json({ data: item({ id: 'post-challenge' }) })
      })
    )

    await render(<CommunityScreen />)

    const banner = await screen.findByTestId('community-challenge-banner')
    expect(banner.textContent).toContain(CHALLENGE.title)
    press(screen.getByTestId('community-challenge-cta'))

    await screen.findByTestId('community-post-sheet')
    press(screen.getByTestId('community-pick-image-button'))
    await screen.findByTestId('community-post-preview-image')
    const altInput = screen.getByTestId<HTMLTextAreaElement>('community-alt-text-input')
    await waitFor(() => expect(altInput.value.length).toBeGreaterThan(0))

    // Opening from the banner CTA opts the look in by default.
    const toggle = screen.getByTestId('community-post-challenge-toggle')
    expect(toggle.textContent).toContain('✓')
    expect(toggle.textContent).toContain(CHALLENGE.title)

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

  // --- Image expiry ---------------------------------------------------------

  it('6.1-MOB-022 bounds the signed-URL refetch at the expiry boundary and then says the image is unavailable', async () => {
    const expiresAt = IMAGE_REFERENCE_NOW + 60_000
    let expireImage: (() => void) | undefined
    const schedule = globalThis.setTimeout.bind(globalThis)
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, ms, ...args: unknown[]) => {
        if (ms === 60_000 && typeof callback === 'function') {
          // Capture only the image deadline. Transport, React and retry backoff
          // retain their real timers, so no service-worker I/O is frozen.
          expireImage = () => callback(...args)
        }
        return schedule(callback, ms, ...args)
      })
    serveFeed(() =>
      HttpResponse.json({
        data: feed({
          items: [
            item({
              imageAccess: { url: PIXEL, expiresAt: new Date(expiresAt).toISOString() },
            }),
          ],
        }),
      })
    )
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('community-post-card-post-a')
      await waitFor(() => expect(expireImage).toBeTypeOf('function'))
      expect(feedUrls).toHaveLength(1)
      expect(screen.queryByTestId('community-card-image-unavailable-post-a')).toBeNull()
      // Move exactly to the captured expiry deadline and fire its real callback.
      await act(async () => {
        vi.mocked(Date.now).mockReturnValue(expiresAt)
        expireImage!()
        await Promise.resolve()
      })
      await screen.findByTestId('community-card-image-unavailable-post-a', undefined, {
        timeout: 10_000,
      })
      expect(screen.getByTestId('community-card-image-retry-post-a')).toBeTruthy()
      expect(
        screen.getByTestId('community-card-image-unavailable-post-a').textContent
      ).toContain(enUS.community.card.imageUnavailable)
      expect(feedUrls).toHaveLength(3)
      expect(Date.now()).toBe(expiresAt)
    } finally {
      timer.mockRestore()
      vi.mocked(Date.now).mockReturnValue(IMAGE_REFERENCE_NOW)
    }
  }, 20_000)
  it('6.3-MOB-001 adds, replaces and retracts with independently focusable labeled controls', async () => {
    let summary: CommunityReactionSummary = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    }
    const requests: SetCommunityReactionInput[] = []
    serveFeed(() => {
      const reactionItem = { ...item(), reactions: summary }
      return HttpResponse.json({ data: feed({ items: [reactionItem] }) })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        const intent = (await request.json()) as SetCommunityReactionInput
        requests.push(intent)
        summary = {
          counts: {
            applause: intent.selection === 'applause' ? 1 : 0,
            love: intent.selection === 'love' ? 1 : 0,
            inspiration: 0,
          },
          total: intent.selection === null ? 0 : 1,
          viewerReaction: intent.selection,
          revision: summary.revision + 1,
          generation: summary.generation + 1,
        }
        return HttpResponse.json({ data: summary })
      })
    )
    await render(<CommunityScreen />)
    const applause = await screen.findByRole('button', { name: 'Applaud, 0' })
    await browserUser.click(applause)
    await waitFor(() => expect(applause.getAttribute('aria-pressed')).toBe('true'))
    const love = screen.getByRole('button', { name: 'Love, 0' })
    await browserUser.click(love)
    await waitFor(() => expect(love.getAttribute('aria-pressed')).toBe('true'))
    await browserUser.click(love)
    await waitFor(() => expect(love.getAttribute('aria-pressed')).toBe('false'))
    expect(requests.map((request) => request.selection)).toEqual([
      'applause',
      'love',
      null,
    ])
    expect(requests.map((request) => request.baseRevision)).toEqual([0, 1, 2])
  })
  function raceDeferred() {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }
  function racePalette() {
    const controls = screen.getByTestId('community-reactions-post-a')
    return {
      buttons: within(controls)
        .getAllByRole('button')
        .map((button) => ({
          label: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed'),
        })),
      total: screen.getByTestId('community-reaction-total-post-a').textContent,
    }
  }
  const confirmedPalette = {
    buttons: [
      { label: 'Applaud, 1', pressed: 'true' },
      { label: 'Love, 0', pressed: 'false' },
      { label: 'Inspired, 0', pressed: 'false' },
    ],
    total: '1 reaction',
  }
  const raceZero: CommunityReactionSummary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    revision: 0,
    generation: 0,
    viewerReaction: null,
  }
  const raceOne: CommunityReactionSummary = {
    counts: { applause: 1, love: 0, inspiration: 0 },
    total: 1,
    revision: 1,
    generation: 1,
    viewerReaction: 'applause',
  }
  it('6.3-MOB delayed detail cannot overwrite confirmed feed mutation', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    const gate = raceDeferred()
    let detailSent = false
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        detailSent = true
        await gate.promise
        return HttpResponse.json({
          data: {
            ...item(),
            caption: 'Older native detail completed.',
            reactions: raceZero,
          },
        })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: raceOne })
      )
    )
    try {
      await render(<CommunityScreen />)
      const button = await screen.findByRole('button', { name: 'Applaud, 0' })
      await waitFor(() => expect(detailSent).toBe(true))
      await browserUser.click(button)
      await screen.findByRole('button', { name: 'Applaud, 1' })
      gate.release()
      await screen.findByText('Older native detail completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB delayed detail cannot resurrect a mutation 404', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    const gate = raceDeferred()
    const read = vi.spyOn(CommunityReactionState.prototype, 'read')
    let detailSent = false
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        detailSent = true
        await gate.promise
        return HttpResponse.json({
          data: {
            ...item(),
            caption: 'Fenced native detail completed.',
            reactions: raceZero,
          },
        })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        errorEnvelope(404, 'Community post not found.')
      )
    )
    try {
      await render(<CommunityScreen />)
      const button = await screen.findByRole('button', { name: 'Applaud, 0' })
      await waitFor(() => expect(detailSent).toBe(true))
      await browserUser.click(button)
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      gate.release()
      // A fenced detail intentionally creates no UI. Observe its arrival at
      // the real coordinator and flush React before the negative assertion.
      await waitFor(() =>
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ caption: 'Fenced native detail completed.' }),
          expect.any(Number)
        )
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      expect(screen.queryByTestId('highlighted-community-card-post-a')).toBeNull()
      expect(screen.queryByText('Fenced native detail completed.')).toBeNull()
    } finally {
      gate.release()
      read.mockRestore()
    }
  })
  it('6.3-MOB refreshed feed summary updates highlighted deep-link copy', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    serveFeed((_url, index) =>
      HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [{ ...item(), reactions: index ? raceOne : raceZero }],
        }),
      })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', () =>
        HttpResponse.json({ data: { ...item(), reactions: raceZero } })
      )
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('highlighted-community-card-post-a')
    await browserUser.click(screen.getByTestId('community-filter-chip-all'))
    await waitFor(() => expect(feedUrls).toHaveLength(2))
    await screen.findByRole('button', { name: 'Applaud, 1' })
    expect(racePalette()).toEqual(confirmedPalette)
  })
  it('6.3-MOB filter unmount retains accepted in-flight mutation result', async () => {
    const gate = raceDeferred()
    const feedGate = raceDeferred()
    let sent = false
    serveFeed(async (_url, index) => {
      if (index) await feedGate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [
            {
              ...item(),
              caption: index ? 'Remounted native feed completed.' : item().caption,
              reactions: raceZero,
            },
          ],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async () => {
        sent = true
        await gate.promise
        return HttpResponse.json({ data: raceOne })
      })
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(sent).toBe(true))
      const mutation = vi.mocked(communityClient.setCommunityReactionFromMobile).mock
        .results[0]!.value
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      // There are no mounted reaction controls during this filter load. Await
      // the real client promise and flush its coordinator continuation first.
      await act(async () => {
        gate.release()
        await mutation
      })
      feedGate.release()
      await screen.findByText('Remounted native feed completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
      feedGate.release()
    }
  })
  it('6.3-MOB-021 retries a failed native PUT with the exact original payload', async () => {
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    const requests: SetCommunityReactionInput[] = []
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        requests.push((await request.json()) as SetCommunityReactionInput)
        return requests.length === 1
          ? HttpResponse.error()
          : HttpResponse.json({ data: raceOne })
      })
    )
    await render(<CommunityScreen />)
    await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
    await browserUser.click(await screen.findByRole('button', { name: 'Retry reaction' }))
    await screen.findByRole('button', { name: 'Applaud, 1' })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      screen.getByRole('button', { name: 'Applaud, 1' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('6.3-MOB-022 keeps confirmed counts when an older feed arrives after a mutation', async () => {
    const gate = raceDeferred()
    serveFeed(async (_url, index) => {
      if (index) await gate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [
            {
              ...item(),
              caption: index ? 'Older native feed completed.' : item().caption,
              reactions: raceZero,
            },
          ],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: raceOne })
      )
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await screen.findByRole('button', { name: 'Applaud, 1' })
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() => expect(feedUrls).toHaveLength(2))
      gate.release()
      await screen.findByText('Older native feed completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-023 wraps controls on narrow cards with large text and counts', async () => {
    serveFeed(() =>
      HttpResponse.json({
        data: feed({
          items: [
            {
              ...item(),
              reactions: {
                ...raceZero,
                counts: { applause: 999999, love: 999999, inspiration: 999999 },
                total: 2999997,
              },
            },
          ],
        }),
      })
    )
    await render(<CommunityScreen />)
    const controls = await screen.findByTestId('community-reactions-post-a')
    controls.style.width = '260px'
    controls.querySelectorAll<HTMLElement>('[role="button"]').forEach((button) => {
      button.style.fontSize = '32px'
      button.querySelectorAll<HTMLElement>('*').forEach((child) => {
        child.style.fontSize = '32px'
      })
    })
    const buttons = Array.from(controls.querySelectorAll<HTMLElement>('[role="button"]'))
    expect(buttons).toHaveLength(3)
    expect(buttons[2]!.getBoundingClientRect().top).toBeGreaterThan(
      buttons[0]!.getBoundingClientRect().top
    )
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.right).toBeLessThanOrEqual(controls.getBoundingClientRect().right)
    }
  })
  it('6.3-MOB-024 revalidates highlighted visibility on an image-triggered refresh', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    let hidden = false
    let detailReads = 0
    serveFeed(() => HttpResponse.json({ data: feed({ items: [] }) }))
    server.use(
      http.get('*/api/v1/community/posts/:postId', () => {
        detailReads += 1
        return hidden
          ? errorEnvelope(404, 'Community post not found.')
          : HttpResponse.json({
              data: { ...item(), reactions: raceZero },
            })
      })
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('highlighted-community-card-post-a')
    hidden = true
    act(() => {
      imageEvents.errors.get('community-card-image-post-a')!()
    })
    await waitFor(() => expect(detailReads).toBeGreaterThan(1))
    await waitFor(() =>
      expect(screen.queryByTestId('highlighted-community-card-post-a')).toBeNull()
    )
  })

  it('6.3-MOB-027 ignores refresh metadata after a filter change during detail revalidation', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    const gate = raceDeferred()
    let reads = 0
    serveFeed((url, index) =>
      HttpResponse.json({
        data: feed({
          mode: url.searchParams.get('mode') === 'all' ? 'all' : 'auto',
          items: [],
          nextCursor:
            index === 0 || url.searchParams.has('cursor')
              ? null
              : url.searchParams.get('mode') === 'all'
                ? 'current-filter-cursor'
                : 'stale-refresh-cursor',
        }),
      })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        reads += 1
        if (reads > 1) {
          await gate.promise
        }
        return HttpResponse.json({
          data: { ...item(), reactions: raceZero },
        })
      })
    )
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('highlighted-community-card-post-a')
      act(() => {
        imageEvents.errors.get('community-card-image-post-a')!()
      })
      await waitFor(() => expect(reads).toBe(2))
      const staleDetail = vi.mocked(communityClient.getCommunityPostFromMobile).mock
        .results[1]!.value
      // Attach before changing the filter, whose abort may reject this promise.
      const staleSettled = Promise.allSettled([staleDetail])
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() =>
        expect(
          screen.getByTestId('community-filter-chip-all').getAttribute('aria-pressed')
        ).toBe('true')
      )
      // The superseded request may already be aborted, so it has no visible
      // completion. Await the real client's settlement and flush React.
      await act(async () => {
        gate.release()
        await staleSettled
      })
      expect(
        screen.getByTestId('community-filter-chip-all').getAttribute('aria-pressed')
      ).toBe('true')
      await waitFor(() =>
        expect(
          feedUrls.some(
            (url) => url.searchParams.get('cursor') === 'current-filter-cursor'
          )
        ).toBe(true)
      )
      expect(
        feedUrls.some((url) => url.searchParams.get('cursor') === 'stale-refresh-cursor')
      ).toBe(false)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-025 an older feed cannot resurrect a post after a mutation 404', async () => {
    const gate = raceDeferred()
    const first = { ...item(), reactions: raceZero }
    serveFeed(async (_url, index) => {
      if (index) await gate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: index
            ? [
                first,
                {
                  ...first,
                  id: 'native-feed-sentinel',
                  caption: 'Fenced native feed completed.',
                },
              ]
            : [first],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        errorEnvelope(404, 'Community post not found.')
      )
    )
    try {
      await render(<CommunityScreen />)
      // Keep an independently mounted highlighted copy while the list remounts for filtering.
      mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
      server.use(
        http.get('*/api/v1/community/posts/:postId', () =>
          HttpResponse.json({ data: first })
        )
      )
      await browserUser.click(await screen.findByTestId('community-filter-chip-all'))
      await screen.findByTestId('highlighted-community-card-post-a')
      await waitFor(() => expect(feedUrls).toHaveLength(2))
      await browserUser.click(screen.getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      gate.release()
      await screen.findByText('Fenced native feed completed.')
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-026 shares pending ownership when detail replaces the feed card', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'post-a' }
    const detail = raceDeferred()
    const mutation = raceDeferred()
    const requests: SetCommunityReactionInput[] = []
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        await detail.promise
        return HttpResponse.json({ data: { ...item(), reactions: raceZero } })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        requests.push((await request.json()) as SetCommunityReactionInput)
        await mutation.promise
        return HttpResponse.json({ data: raceOne })
      })
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      detail.release()
      await screen.findByTestId('highlighted-community-card-post-a')
      expect(
        screen.getByRole('button', { name: 'Love, 0' }).getAttribute('aria-disabled')
      ).toBe('true')
      await browserUser.click(screen.getByRole('button', { name: 'Love, 0' }), {
        force: true,
      })
      expect(requests).toHaveLength(1)
      mutation.release()
      expect(
        (await screen.findByRole('button', { name: 'Applaud, 1' })).getAttribute(
          'aria-pressed'
        )
      ).toBe('true')
    } finally {
      detail.release()
      mutation.release()
    }
  })
})

/**
 * The client wrapper's own contract. Every one of these reasons reaches the screen as a
 * different translated string, and the mapping from an HTTP outcome onto a
 * `CommunityFailureReason` is where the SDK's untranslated wording used to leak.
 */
describe('mobile community client (Story 6.1)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  async function feedReason(response: Response): Promise<string> {
    server.use(http.get(FEED_ROUTE, () => response))
    try {
      await getCommunityFeedFromMobile({ mode: 'auto' })
    } catch (error: unknown) {
      return communityFailureReason(error)
    }
    throw new Error('expected the feed read to reject')
  }

  it('6.1-MOB-023 refuses to call the API with no session', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    let called = false
    server.use(
      http.get(FEED_ROUTE, () => {
        called = true
        return HttpResponse.json({ data: feed() })
      })
    )

    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      reason: 'signed_out',
    })
    expect(called).toBe(false)
  })

  it.each([
    // `community.service.ts` answers this 400 whenever a cursor no longer matches
    // the mode or the resolved band it was minted under; the screen restarts
    // paging on it, which it can only do if it arrives as its own reason.
    [400, COMMUNITY_CURSOR_INVALID_MESSAGE, 'cursor_invalid'],
    [400, 'Some other bad request.', 'unknown'],
    [401, 'Unauthorized', 'signed_out'],
    [403, COMMUNITY_AGE_GATE_DENIED_MESSAGE, 'age_gate'],
    // The service refuses a self-report with a ForbiddenException, so this
    // belongs to 403 and not to 409; classifying it as a conflict left
    // `community.error.selfReport` unreachable in production.
    [403, COMMUNITY_SELF_REPORT_MESSAGE, 'self_report'],
    [403, 'Forbidden for another reason.', 'unknown'],
    [404, 'Community post not found.', 'not_found'],
    [409, COMMUNITY_REPORT_REASON_CHANGED_MESSAGE, 'reason_changed'],
    // A message the client does not recognise falls back to generic translated
    // copy rather than surfacing the server's untranslated English.
    [409, 'Some other conflict.', 'unknown'],
    [429, 'Slow down.', 'rate_limited'],
    [503, COMMUNITY_FEED_DISABLED_MESSAGE, 'disabled'],
    // A published row whose object cannot be signed. The service answers this on
    // the single-post read and on publish, and it shares its status with the
    // rollout kill switch, so the two are told apart by message alone.
    [503, COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE, 'media_unavailable'],
    [503, 'Down for maintenance.', 'unknown'],
    [500, 'Internal server error.', 'unknown'],
  ])('6.1-MOB-024 classifies HTTP %s "%s" as %s', async (status, message, reason) => {
    expect(await feedReason(errorEnvelope(status, message))).toBe(reason)
  })

  it('6.1-MOB-025 falls back to its own wording when the error body carries no message', async () => {
    server.use(
      http.get(FEED_ROUTE, () => new HttpResponse('<html>502</html>', { status: 502 }))
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      reason: 'unknown',
      message: 'Unable to load the community feed.',
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        HttpResponse.json({ statusCode: 502, error: 'Bad Gateway' }, { status: 502 })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      message: 'Unable to load the community feed.',
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        HttpResponse.json({ statusCode: 502, message: '   ' }, { status: 502 })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      message: 'Unable to load the community feed.',
    })
  })

  it('6.1-MOB-026 keeps Retry-After only when it parses as delta-seconds', async () => {
    server.use(
      http.get(FEED_ROUTE, () =>
        errorEnvelope(429, 'Slow down.', { 'Retry-After': '120' })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      retryAfterSeconds: 120,
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        errorEnvelope(429, 'Slow down.', {
          'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT',
        })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      retryAfterSeconds: undefined,
    })
    expect(communityRetryAfterSeconds(new Error('not ours'))).toBeUndefined()
    expect(communityFailureReason(new Error('not ours'))).toBe('unknown')
  })

  it('6.1-MOB-027 reads one post and reports 404 for anything the caller cannot see', async () => {
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) =>
        params.postId === 'post-a'
          ? HttpResponse.json({ data: item() })
          : errorEnvelope(404, 'Community post not found.')
      )
    )

    await expect(getCommunityPostFromMobile('post-a')).resolves.toMatchObject({
      id: 'post-a',
    })
    await expect(getCommunityPostFromMobile('post-z')).rejects.toMatchObject({
      reason: 'not_found',
    })
  })

  it('6.1-MOB-028 surfaces a transport failure as an unknown reason', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () => HttpResponse.error())
    )

    await expect(reportCommunityPostFromMobile('post-a', 'spam')).rejects.toBeInstanceOf(
      CommunityRequestError
    )
  })

  it('6.1-MOB-029 classifies a denied or failed photo picker rather than leaking a native error', async () => {
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'permission_denied',
    })

    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchImageLibraryAsync.mockRejectedValue(new Error('picker exploded'))
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'picker_failed',
      message: 'picker exploded',
    })

    // A native module can reject with something that is not an Error at all.
    imagePicker.launchImageLibraryAsync.mockRejectedValue('exploded')
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'picker_failed',
      message: 'Image picker failed to open.',
    })

    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    })
    await expect(pickCommunityPhoto()).resolves.toBeNull()

    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.jpg', width: 900, height: 1200 }],
    })
    await expect(pickCommunityPhoto()).resolves.toEqual({
      uri: 'file:///photo.jpg',
      width: 900,
      height: 1200,
    })
  })
})
