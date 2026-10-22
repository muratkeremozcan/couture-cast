import { CommunitySyncState } from '@couture/api-client'
// Learning path Step 27: Widget and notification deep-link handling.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-27-widget-and-notification-deep-link-handling
/* eslint-disable @typescript-eslint/await-thenable */
// Story 3.7 Task 5 step 2 owner: unit-test mobile deep-link hydration, severe weather alert focus, and community card highlight
import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import {
  createCommunityPolledEvent,
  createWeatherAlertPolledEvent,
} from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
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
import type { CommunityFeedItem } from '@couture/api-client/contracts/http'
import TabOneScreen from '@/app/(tabs)/index'
import { CommunityScreen } from '@/src/features/community/community-screen'
import enUS from '@/assets/locales/en-US.json'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'

/** A real 1x1 PNG, so react-native-web's `ImageLoader` resolves without a network hop. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function communityPost(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 'look-42',
    caption: 'Layered wool over a merino base for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
    climateBand: 'temperate_dry',
    imageAccess: {
      url: PIXEL,
      expiresAt: new Date(Date.parse('2026-07-24T18:30:00.000Z')).toISOString(),
    },
    publishedAt: '2026-07-23T12:00:00.000Z',
    createdAt: '2026-07-23T11:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer A1B2', isSelf: false },
    ...overrides,
  }
}

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

let restoreAccessTokenResolver: (() => void) | undefined

describe('Mobile Deep Link Handling (Story 3.7)', () => {
  beforeAll(async () => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
    await initI18n()
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    mockCapture.mockClear()
    mockSetParams.mockClear()
    mockPush.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-24T17:30:00.000Z'))
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    mockParams = {}
    server.use(
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        const input = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        const targets = []
        for (const target of input.targets) {
          const response = await fetch(
            new URL(
              `/api/v1/community/posts/${encodeURIComponent(target.postId)}`,
              request.url
            )
          )
          if (response.status === 404) {
            targets.push({ key: target.key, status: 'unavailable' })
            continue
          }
          if (!response.ok) return new HttpResponse(null, { status: response.status })
          const body = (await response.json()) as { data: CommunityFeedItem }
          targets.push({
            key: target.key,
            status: 'available',
            communityRevision: '0',
            post: {
              ...body.data,
              reactions: {
                counts: { applause: 0, love: 0, inspiration: 0 },
                total: 0,
                viewerReaction: null,
                revision: 0,
                generation: 0,
              },
            },
            comment: null,
            parent: null,
            pageCursor: null,
            parentPageCursor: null,
            threadPosition: null,
          })
        }
        return HttpResponse.json({ data: { targets } })
      }),
      http.get('*/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            createWeatherAlertPolledEvent('alert-777', 'test-user-id'),
            createCommunityPolledEvent('look-42', 'test-user-id'),
          ],
          nextSince: '2026-07-24T17:29:00.000Z',
        })
      ),
      /*
       * The community deep link resolves against the community API now, not the
       * event poll. The poll only ever knew about posts whose `lookbook:new`
       * event was still inside its window, and it could not say whether THIS
       * viewer is allowed to see the post; the API answers 404 for everything
       * they may not. The poll handler above stays for the weather-alert cases.
       */
      http.get('*/api/v1/community/posts/:postId', ({ params }) =>
        params.postId === 'look-42'
          ? HttpResponse.json({ data: communityPost() })
          : HttpResponse.json(
              {
                statusCode: 404,
                message: 'Community post not found.',
                error: 'Not Found',
              },
              { status: 404 }
            )
      )
    )
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    vi.restoreAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('3.7-UNIT-005: Focuses severe weather alert banner on severe_weather push notification', async () => {
    mockParams = {
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-777',
    }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('severe-weather-alert-focused')).toBeTruthy()
    })
    expect(screen.getByText('A severe thunderstorm warning is active.')).toBeTruthy()

    expect(mockCapture).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-777',
      surface: 'mobile',
    })
  })

  it('3.7-UNIT-006: Renders InfoBanner and captures deep_link_invalid on malformed parameters', async () => {
    mockParams = {
      source: 'invalid_source',
      slot: 'bad_slot',
    }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('deep-link-info-banner')).toBeTruthy()
    })

    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        surface: 'mobile',
      })
    )
  })

  it('3.7-UNIT-007: CommunityScreen highlights post card on community notification deep link', async () => {
    mockParams = {
      source: 'notification',
      type: 'community',
      cardId: 'look-42',
    }

    await render(<CommunityScreen />)

    const highlight = await screen.findByTestId('highlighted-community-card-look-42')

    // The card used to be synthesised from the notification payload, badged with
    // the hardcoded, untranslated "Community post #look-42". It is the real post
    // now, with no separate badge, so the raw id must not leak into the render.
    expect(highlight.textContent).not.toContain('Community post #')
    expect(highlight.textContent).not.toContain('#look-42')
    expect(
      screen.getByTestId('community-card-image-look-42').getAttribute('aria-label')
    ).toBe(communityPost().altText)

    expect(mockCapture).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      type: 'community',
      // Story6.5 D8: preserve successful-link analytics without raw target identifiers.
      surface: 'mobile',
    })
    expect(
      mockCapture.mock.calls.filter(([event]) => event === 'deep_link_handled')
    ).toHaveLength(1)
  })

  it('3.7-UNIT-008: CommunityScreen stays a plain tab when it is opened without a deep link', async () => {
    // The community tab is reachable from the tab bar, not only from a
    // notification, so an empty parameter set must not look like a failure.
    await render(<CommunityScreen />)

    expect(screen.getByTestId('community-screen')).toBeTruthy()
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('3.7-UNIT-009: CommunityScreen flags a community link with no card id and lets it be dismissed', async () => {
    mockParams = { source: 'notification', type: 'community' }

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('deep-link-info-banner')).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({ surface: 'mobile' })
    )

    // The banner is advisory; the tab has to remain usable after dismissal.
    fireEvent.click(screen.getByLabelText('Dismiss banner'))
    await waitFor(() => {
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    })
    expect(screen.getByTestId('community-screen')).toBeTruthy()
  })

  it('3.7-UNIT-010: CommunityScreen reports a community card that is no longer in the feed', async () => {
    // The default handler answers 404 for every id but `look-42`, which is the
    // same answer the API gives for a post this viewer may not see: the two are
    // deliberately indistinguishable, so a hidden post cannot be probed for.
    mockParams = { source: 'notification', type: 'community', cardId: 'look-99' }

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'target_unavailable' })
      )
    })
    expect(screen.queryByTestId('highlighted-community-card-look-99')).toBeNull()
  })

  it.each(['recovers', 'exhausts'] as const)(
    '3.7-UNIT-011: CommunityScreen keeps retryable target intent when dependency %s',
    async (outcome) => {
      // D3/D9: a transient failure retains the same notification intent and bounded retries.
      mockParams = { source: 'notification', type: 'community', cardId: 'look-42' }
      let unavailable = true
      let failures = 0
      server.use(
        http.get('*/api/v1/community/posts/:postId', () => {
          if (unavailable) {
            failures++
            return new HttpResponse(null, { status: 500 })
          }
          return HttpResponse.json({ data: communityPost() })
        })
      )
      await render(<CommunityScreen />)
      if (outcome === 'recovers') {
        await waitFor(() => expect(failures).toBeGreaterThan(0))
        unavailable = false
        await screen.findByTestId('highlighted-community-card-look-42')
        expect(mockCapture).toHaveBeenCalledWith('deep_link_handled', {
          source: 'notification',
          type: 'community',
          surface: 'mobile',
        })
      } else {
        await screen.findByText(
          enUS.community.realtime.unavailable,
          {},
          { timeout: 12000 }
        )
        expect(screen.queryByTestId('highlighted-community-card-look-42')).toBeNull()
      }
      expect(mockCapture).not.toHaveBeenCalledWith('deep_link_invalid', expect.anything())
    },
    15000
  )

  it('3.7-UNIT-012: CommunityScreen falls back to catalogue copy for a card with no climate band', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-77' }
    server.use(
      http.get('*/api/v1/community/posts/:postId', () =>
        // `climateBand` is nullable on the published projection, so the card has
        // to read sensibly without one.
        HttpResponse.json({ data: communityPost({ id: 'look-77', climateBand: null }) })
      )
    )

    await render(<CommunityScreen />)

    await screen.findByTestId('highlighted-community-card-look-77')
    // Was the English literal "All-weather look from the community", assembled
    // from a notification payload; it is the card's own band pill now, and every
    // catalogue carries the string.
    expect(screen.getByTestId('community-card-climate-pill-look-77').textContent).toBe(
      enUS.community.band.unclassified
    )
  })
})
