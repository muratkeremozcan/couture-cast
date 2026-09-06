// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the mobile community feed screen and its HTTP client.
//
// The network boundary stays REAL and is driven through MSW; `@/src/lib/community` is
// deliberately not mocked. Three of the states here are reachable only through a
// rejected request (401, 409 already-reported, 429 with Retry-After), and the first
// draft of this screen rendered `error.message` straight from the SDK, so a 429, a 409
// and a 500 all read as "Response returned an error code". A mocked client proves none
// of that.
//
// Only native modules are mocked. `src/lib/community.ts` imports `expo-image-picker`,
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
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { configure, fireEvent, screen, waitFor } from '@testing-library/react'
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
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  communityBandUnresolvedReasonSchema,
  type CommunityAuthorPostState,
  type CommunityFeed,
  type CommunityFeedItem,
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
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

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
    fireEvent.click(screen.getByLabelText('Dismiss banner'))
    await waitFor(() => expect(screen.queryByTestId('deep-link-info-banner')).toBeNull())
    expect(screen.getByTestId('community-screen')).toBeTruthy()
  })

  it('6.1-MOB-084 drops a deep-link target that resolves after the tab was left', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-42' }
    server.use(
      http.get('*/api/v1/events/poll', async () => {
        await delay(200)
        return HttpResponse.json({ events: [], nextSince: '2026-09-05T12:00:00.000Z' })
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

  it('6.1-MOB-022 bounds the signed-URL refetch and then says the image is unavailable', async () => {
    // Every response carries an already-expired URL, which is what turned the
    // first draft's expiry effect into an unbounded refetch loop.
    serveFeed(() =>
      HttpResponse.json({
        data: feed({ items: [item({ imageAccess: imageAccess(-1000) })] }),
      })
    )

    await render(<CommunityScreen />)

    await screen.findByTestId('community-post-card-post-a')
    const afterFirstPage = feedUrls.length

    await screen.findByTestId('community-card-image-unavailable-post-a', undefined, {
      timeout: 10_000,
    })
    expect(screen.getByTestId('community-card-image-retry-post-a')).toBeTruthy()
    expect(
      screen.getByTestId('community-card-image-unavailable-post-a').textContent
    ).toContain(enUS.community.card.imageUnavailable)

    // Exactly the capped two refreshes, and then it stops: the first draft's
    // effect re-armed on every refetch and refreshed forever.
    expect(feedUrls.length - afterFirstPage).toBe(2)
    const settled = feedUrls.length
    await delay(500)
    expect(feedUrls).toHaveLength(settled)
  }, 20_000)
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
