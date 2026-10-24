// Story 6.7b owner: the sponsored "Shop this look" CTA on the community card and
// the Home teaser, end to end through the real click boundary. The click is
// served by MSW, so a 404, a 5xx and a dropped connection each reach the
// component exactly as the device would see them; only the in-app browser and
// the analytics client are doubles. Every activation is a real pointer click
// (Playwright, hit-tested at the element's centre), so a control laid over the
// Shop row would take the tap and fail the test.
import React, { createElement } from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
  type CommunitySponsoredFeedItem,
  type CommunitySponsorship,
} from '@couture/api-client/contracts/http'
import type { SpotlightTeaserValue } from '@couture/api-client'

const { openBrowserAsyncMock, captureMock, pressableProps, reactRef } = vi.hoisted(
  () => ({
    openBrowserAsyncMock: vi.fn(),
    captureMock: vi.fn(),
    pressableProps: new Map<string, Record<string, unknown>>(),
    // Filled in from this file's React below: importing `react` inside a mock
    // factory loads a second copy and every hook then reads a null dispatcher.
    reactRef: { createElement: null as unknown as typeof createElement },
  })
)

vi.mock('expo-web-browser', () => ({ openBrowserAsync: openBrowserAsyncMock }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
  useFocusEffect: (await import('../../src/test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: captureMock,
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
}))
// `accessibilityHint` and `accessibilityState` are native-only props that
// react-native-web never writes to the DOM, so they are asserted where they are
// handed over.
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const RealPressable = actual.Pressable
  function RecordingPressable(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') pressableProps.set(props.testID, props)
    return reactRef.createElement(RealPressable as never, props)
  }
  return {
    ...actual,
    Pressable: RecordingPressable,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
  }
})

reactRef.createElement = createElement

import { AccessibilityInfo } from 'react-native'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { mockAffiliateRedirectUrl } from '@/src/test-utils/msw/handlers'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { SponsoredCtaImpressions } from '@/src/features/community/sponsored-cta-impressions'
import { HomeSpotlightTeaser } from '@/components/home/home-spotlight-teaser'
import { CommunityCard } from './community-card'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SPONSORSHIP: CommunitySponsorship = {
  partnerId: 'atelier-north',
  partnerDisplayName: 'Atelier North',
  offerId: 'offer-coat',
  offerTitle: 'Wool overcoat',
}

function item(
  overrides: Partial<CommunitySponsoredFeedItem> = {}
): CommunitySponsoredFeedItem {
  return {
    id: 'post-a',
    caption: 'Layered wool for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit.',
    climateBand: 'temperate_wet',
    imageAccess: { url: PIXEL, expiresAt: '2099-01-01T00:00:00.000Z' },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    sponsorship: SPONSORSHIP,
    ...overrides,
  }
}

function teaserValue(sponsorship?: CommunitySponsorship): SpotlightTeaserValue {
  const base = item({ sponsorship })
  return {
    memberId: 'member-1',
    item: { ...base, rank: 1 },
    level: 'city',
    label: 'Lisbon',
    completedAt: Date.now(),
  }
}

function card(
  props: Partial<React.ComponentProps<typeof CommunityCard>> = {},
  focused = true
) {
  return (
    <SponsoredCtaImpressions focused={focused}>
      <CommunityCard item={item()} onReport={vi.fn()} onWithdraw={vi.fn()} {...props} />
    </SponsoredCtaImpressions>
  )
}

function teaser(value: SpotlightTeaserValue, focused = true) {
  return (
    <SponsoredCtaImpressions focused={focused}>
      <HomeSpotlightTeaser
        value={value}
        onOpen={vi.fn()}
        onImageError={vi.fn()}
        active={false}
      />
    </SponsoredCtaImpressions>
  )
}

/** Records every click request body and answers with `respond`. */
function serveClicks(respond: () => Response | Promise<Response>) {
  const bodies: unknown[] = []
  server.use(
    http.post('*/api/v1/commerce/affiliate/clicks', async ({ request }) => {
      bodies.push(await request.json())
      return respond()
    })
  )
  return bodies
}

const minted = () =>
  HttpResponse.json({ data: { redirectUrl: mockAffiliateRedirectUrl } }, { status: 201 })

const shownEvents = () =>
  captureMock.mock.calls.filter(([event]) => event === 'affiliate_cta_shown')

describe('sponsored community CTA (Story 6.7b)', () => {
  let restoreAccessToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    restoreAccessToken = setMobileAccessTokenResolver(() => 'session-token')
    openBrowserAsyncMock.mockReset()
    openBrowserAsyncMock.mockResolvedValue({ type: 'dismiss' })
    captureMock.mockReset()
    pressableProps.clear()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
  })

  afterEach(() => {
    restoreAccessToken?.()
    restoreAccessToken = undefined
  })

  describe('community card', () => {
    it('6.7b-MOB-010 mints a community_feed click for the post, then opens the in-app browser', async () => {
      const bodies = serveClicks(minted)
      render(card())

      await userEvent.click(screen.getByTestId('community-card-shop-post-a'))

      await waitFor(() =>
        expect(openBrowserAsyncMock).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
      )
      expect(bodies).toEqual([
        { offerId: 'offer-coat', recommendationId: 'post-a', surface: 'community_feed' },
      ])
      expect(screen.getByTestId('community-card-shop-post-a').textContent).toBe(
        'Shop this look at Atelier North'
      )
    })

    it('6.7b-MOB-011 reports community_spotlight from a spotlight card', async () => {
      const bodies = serveClicks(minted)
      render(card({ shopSurface: 'community_spotlight' }))

      await userEvent.click(screen.getByTestId('community-card-shop-post-a'))

      await waitFor(() => expect(openBrowserAsyncMock).toHaveBeenCalledTimes(1))
      expect(bodies).toEqual([
        {
          offerId: 'offer-coat',
          recommendationId: 'post-a',
          surface: 'community_spotlight',
        },
      ])
    })

    it.each([
      [
        'a 404 because the link ended after the read',
        () =>
          HttpResponse.json(
            {
              statusCode: 404,
              message: COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
              error: 'Not Found',
            },
            { status: 404 }
          ),
      ],
      ['a 5xx', () => new HttpResponse(null, { status: 503 })],
      ['a network failure', () => HttpResponse.error()],
    ])(
      '6.7b-MOB-012 shows the localized error on %s, keeps focus and retries',
      async (_case, failure) => {
        let fail = true
        const bodies = serveClicks(() => (fail ? failure() : minted()))
        render(card())
        const button = screen.getByTestId('community-card-shop-post-a')
        button.focus()

        await userEvent.click(button)

        const error = await screen.findByTestId('community-card-shop-error-post-a')
        expect(error.textContent).toBe(
          'Unable to open the partner site. Please try again.'
        )
        expect(openBrowserAsyncMock).not.toHaveBeenCalled()
        // The same element, still focused: nothing moved focus to the error.
        expect(screen.getByTestId('community-card-shop-post-a')).toBe(button)
        expect(document.activeElement).toBe(button)
        expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
        expect(
          vi
            .mocked(AccessibilityInfo.announceForAccessibility)
            .mock.calls.filter(([text]) => text === error.textContent)
        ).toHaveLength(1)

        fail = false
        await userEvent.click(button)
        await waitFor(() =>
          expect(openBrowserAsyncMock).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
        )
        expect(bodies).toHaveLength(2)
        await waitFor(() =>
          expect(screen.queryByTestId('community-card-shop-error-post-a')).toBeNull()
        )
      }
    )

    it('6.7b-MOB-013 announces loading once and mints once for a double tap', async () => {
      let release: (() => void) | undefined
      const bodies = serveClicks(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(minted())
          })
      )
      render(card())
      const button = screen.getByTestId('community-card-shop-post-a')

      await userEvent.dblClick(button)

      await waitFor(() => expect(button.textContent).toBe('Opening partner site'))
      // Busy, the name is the loading state alone; the browser suffix returns
      // with the idle label.
      expect(button.getAttribute('aria-label')).toBe('Opening partner site')
      expect(
        pressableProps.get('community-card-shop-post-a')?.accessibilityState
      ).toEqual({ busy: true })
      expect(
        vi
          .mocked(AccessibilityInfo.announceForAccessibility)
          .mock.calls.filter(([text]) => text === 'Opening partner site')
      ).toHaveLength(1)
      await waitFor(() => expect(release).toBeDefined())
      act(() => release?.())
      await waitFor(() => expect(openBrowserAsyncMock).toHaveBeenCalledTimes(1))
      expect(bodies).toHaveLength(1)
    })

    it('6.7b-MOB-014 keeps the CTA outside the open target and says it opens a browser', () => {
      render(card())
      const open = screen.getByTestId('community-card-open-post-a')
      const button = screen.getByTestId('community-card-shop-post-a')

      expect(open.contains(button)).toBe(false)
      expect(button.contains(open)).toBe(false)
      expect(screen.getByTestId('community-post-card-post-a').contains(button)).toBe(true)
      expect(button.getAttribute('role')).toBe('button')
      // In the announced name, so a reader with hints switched off still hears
      // it, and on screen for everyone else.
      expect(button.getAttribute('aria-label')).toBe(
        'Shop this look at Atelier North. Opens in an in-app browser'
      )
      expect(pressableProps.get('community-card-shop-post-a')?.accessibilityHint).toBe(
        undefined
      )
      const opens = screen.getByTestId('community-card-shop-opens-post-a')
      expect(opens.textContent).toBe('Opens in an in-app browser')
      expect(button.contains(opens)).toBe(false)
      const { minHeight, minWidth } = getComputedStyle(button)
      expect(minHeight).toBe('44px')
      expect(minWidth).toBe('44px')
    })

    it('6.7b-MOB-015 records one strict shown event per block per visit', () => {
      const { rerender, unmount } = render(card())
      expect(shownEvents()).toEqual([
        [
          'affiliate_cta_shown',
          {
            partner_id: 'atelier-north',
            offer_id: 'offer-coat',
            surface: 'community_feed',
            locale_region: 'US',
          },
        ],
      ])

      // A re-render, and a second copy of the same block (the deep-link card
      // above the feed), stay one impression.
      rerender(
        <SponsoredCtaImpressions focused>
          <CommunityCard item={item()} onReport={vi.fn()} onWithdraw={vi.fn()} />
          <CommunityCard item={item()} onReport={vi.fn()} onWithdraw={vi.fn()} />
        </SponsoredCtaImpressions>
      )
      expect(shownEvents()).toHaveLength(1)

      // Leaving the screen reports nothing; coming back is a new visit.
      rerender(card({}, false))
      expect(shownEvents()).toHaveLength(1)
      rerender(card({}, true))
      expect(shownEvents()).toHaveLength(2)
      unmount()
    })

    it('6.7b-MOB-017 a block that arrived while the screen was left counts once on return', () => {
      const offerB = { ...SPONSORSHIP, offerId: 'offer-b' }
      const { rerender } = render(card())
      // Left the screen; a read finished meanwhile with a different offer.
      rerender(card({ item: item({ sponsorship: offerB }) }, false))
      expect(shownEvents()).toHaveLength(1)

      rerender(card({ item: item({ sponsorship: offerB }) }, true))

      expect(
        shownEvents().map(
          ([, properties]) => (properties as { offer_id: string }).offer_id
        )
      ).toEqual(['offer-coat', 'offer-b'])
    })

    it('6.7b-MOB-016 renders no CTA and records nothing without a block', () => {
      render(card({ item: item({ sponsorship: undefined }) }))

      expect(screen.getByTestId('community-card-author-post-a')).toBeInTheDocument()
      expect(screen.queryByTestId('community-card-shop-post-a')).toBeNull()
      expect(screen.queryByTestId('community-card-partnered-post-a')).toBeNull()
      expect(shownEvents()).toEqual([])
    })
  })

  describe('Home teaser', () => {
    it('6.7b-MOB-020 discloses the partner and offers the CTA beside the link', () => {
      render(teaser(teaserValue(SPONSORSHIP)))
      const link = screen.getByTestId('home-spotlight-teaser-link')
      const partnered = screen.getByTestId('home-spotlight-teaser-partnered')
      const button = screen.getByTestId('home-spotlight-teaser-shop')

      expect(partnered.textContent).toBe('Partnered')
      // The link carries the disclosure; the visible pill is not announced again.
      expect(partnered.getAttribute('aria-label')).toBeNull()
      expect(partnered.getAttribute('role')).toBeNull()
      expect(
        Array.from(partnered.querySelectorAll('*')).every(
          (node) => node.closest('[aria-hidden="true"]') !== null
        )
      ).toBe(true)
      expect(link.getAttribute('aria-label')).toBe(
        'Standout look in Lisbon by Ana, 0 reactions. Opens the City Spotlight. Partnered with Atelier North'
      )
      expect(link.contains(button)).toBe(false)
      expect(link.contains(partnered)).toBe(false)
      expect(button.getAttribute('aria-label')).toBe(
        'Shop this look at Atelier North. Opens in an in-app browser'
      )
      expect(screen.getByTestId('home-spotlight-teaser-shop-opens').textContent).toBe(
        'Opens in an in-app browser'
      )
    })

    it('6.7b-MOB-024 records one strict home_teaser shown event for the sponsored teaser', () => {
      render(teaser(teaserValue(SPONSORSHIP)))

      expect(shownEvents()).toEqual([
        [
          'affiliate_cta_shown',
          {
            partner_id: 'atelier-north',
            offer_id: 'offer-coat',
            surface: 'home_teaser',
            locale_region: 'US',
          },
        ],
      ])
    })

    it('6.7b-MOB-025 a click on the teaser CTA mints home_teaser, then opens the in-app browser', async () => {
      const bodies = serveClicks(minted)
      render(teaser(teaserValue(SPONSORSHIP)))

      await userEvent.click(screen.getByTestId('home-spotlight-teaser-shop'))

      await waitFor(() =>
        expect(openBrowserAsyncMock).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
      )
      expect(bodies).toEqual([
        { offerId: 'offer-coat', recommendationId: 'post-a', surface: 'home_teaser' },
      ])
    })

    it('6.7b-MOB-021 shows the error under the teaser CTA and keeps focus', async () => {
      serveClicks(() => new HttpResponse(null, { status: 500 }))
      render(teaser(teaserValue(SPONSORSHIP)))
      const button = screen.getByTestId('home-spotlight-teaser-shop')
      button.focus()

      await userEvent.click(button)

      expect(
        (await screen.findByTestId('home-spotlight-teaser-shop-error')).textContent
      ).toBe('Unable to open the partner site. Please try again.')
      expect(document.activeElement).toBe(button)
    })

    it('6.7b-MOB-023 names the busy teaser CTA by its loading state alone, then restores the browser suffix', async () => {
      let release: (() => void) | undefined
      serveClicks(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new HttpResponse(null, { status: 500 }))
          })
      )
      render(teaser(teaserValue(SPONSORSHIP)))
      const button = screen.getByTestId('home-spotlight-teaser-shop')

      await userEvent.click(button)

      await waitFor(() => expect(button.textContent).toBe('Opening partner site'))
      expect(button.getAttribute('aria-label')).toBe('Opening partner site')
      await waitFor(() => expect(release).toBeDefined())
      act(() => release?.())
      await screen.findByTestId('home-spotlight-teaser-shop-error')
      // The error state keeps the idle name with the suffix.
      expect(button.getAttribute('aria-label')).toBe(
        'Shop this look at Atelier North. Opens in an in-app browser'
      )
    })

    it('6.7b-MOB-022 leaves an unsponsored teaser as it was', () => {
      render(teaser(teaserValue()))

      const link = screen.getByTestId('home-spotlight-teaser-link')
      expect(link.getAttribute('aria-label')).not.toMatch(/Partnered/)
      expect(screen.queryByTestId('home-spotlight-teaser-partnered')).toBeNull()
      expect(screen.queryByTestId('home-spotlight-teaser-shop')).toBeNull()
      expect(shownEvents()).toEqual([])
    })
  })
})
