// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7: the Home spotlight teaser on mobile. Reads are deferred through MSW
// so each test decides when a read settles; absence is asserted only after the
// read or the member resolution it depends on has settled, and time-driven rows
// use fake timers.
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import { act, configure, screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { AppState, type AppStateStatus } from 'react-native'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { http, HttpResponse } from 'msw'
import { COMMUNITY_FEED_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import {
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SPOTLIGHT_TEASER_READ_FLOOR_MS,
  SPOTLIGHT_TEASER_REREAD_MS,
} from '@couture/api-client'
import { IMAGE_LOAD_TIMEOUT_MS } from '@/components/community/community-card'

const routerPush = vi.hoisted(() => vi.fn())
const capture = vi.hoisted(() => vi.fn())
const openBrowserAsync = vi.hoisted(() => vi.fn())

// These browser UI cases own their bearer fixture; rootless native auth is signed out.
vi.mock('@/src/lib/native-session', () => ({
  resolveNativeSessionToken: () => Promise.resolve(undefined),
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-web-browser', () => ({ openBrowserAsync }))
// Story 6.7b: the device storage modules, recorded so a test can prove no
// sponsorship block is ever persisted.
vi.mock('expo-file-system/legacy', async () => {
  const { nativeStorageMocks } = await import('../test-utils/persisted-writes.js')
  return nativeStorageMocks.legacyFileSystem
})
vi.mock('expo-secure-store', async () => {
  const { nativeStorageMocks } = await import('../test-utils/persisted-writes.js')
  return nativeStorageMocks.secureStore
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// Passthrough spies: reads stay on the real HTTP boundary, and the wrapper's own
// promises tell a test when a read has settled.
vi.mock('@/src/lib/community', { spy: true })
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture,
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    withoutShopThisLook: actual.withoutShopThisLook,
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: vi.fn().mockResolvedValue(null),
    saveRitualCache: vi.fn().mockResolvedValue(undefined),
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: vi.fn().mockResolvedValue(undefined),
  }
})

import { screenFocus } from '@/src/test-utils/focus-effect'
import {
  expectNoSponsorshipPersisted,
  recordPersistedWrites,
} from '@/src/test-utils/persisted-writes'
import { saveRitualCache } from '@/src/lib/ritual-cache'
import { failOnConsoleWarn } from '@/src/test-utils/console-guard'
import { server } from '@/src/test-utils/msw/server'
import {
  mockAffiliateRedirectUrl,
  mockRitualResponse,
} from '@/src/test-utils/msw/handlers'
import { noLocationResponse } from '@/src/test-utils/locations'
import {
  advance,
  cityPage,
  deferSpotlightReads,
  expectNothingAfterHero,
  expectOccupiesNoLayout,
  follows,
  recordOpens,
  renderHome,
  serveTeaserImages,
  settledIdentity,
  settledRead,
  showTeaser,
  spotlightItem,
  teaserNodes,
  teaserReadCalls,
  teaserReadSignal,
  untilFrame,
  type Answer,
} from '@/src/test-utils/home-teaser'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import i18n, { initI18n } from '@/src/lib/i18n'
import { getCommunitySpotlightFromMobile } from '@/src/lib/community'

/** The bearer the app holds; undefined is a signed-out or not yet restored session. */
let token: string | undefined | Promise<string | undefined>
let restoreToken: (() => void) | undefined

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})
beforeEach(async () => {
  vi.clearAllMocks()
  screenFocus.reset()
  token = 'session-token'
  restoreToken = setMobileAccessTokenResolver(() => token)
  setMobileApplicationUserId(null)
  await i18n.changeLanguage('en-US')
  server.use(http.get('*/api/v1/ritual', () => HttpResponse.json(mockRitualResponse)))
  serveTeaserImages()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restoreToken?.()
  setMobileApplicationUserId(null)
})

// The teaser's image-loaded marker (MOB-001) and focus markers (MOB-010,
// MOB-011) render here, and a marker that passes `pointerEvents` as a prop warns
// on react-native-web.
failOnConsoleWarn()

describe('6.7 mobile Home spotlight teaser', () => {
  it('6.7-MOB-001 shows the area label, decorative image, author and reaction count after the hero', async () => {
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    expect(reads[0]!.url.searchParams.get('limit')).toBe('1')
    expect(reads[0]!.url.searchParams.get('surface')).toBe('home_teaser')
    expect(reads[0]!.authorization).toBe('Bearer session-token')
    expect(screen.getByTestId('home-spotlight-teaser-heading').textContent).toBe(
      'Standout look in Lisbon'
    )
    expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Ana')
    expect(screen.getByTestId('home-spotlight-teaser-reactions').textContent).toBe(
      '3 reactions'
    )
    expect(link.getAttribute('role')).toBe('link')
    expect(link.getAttribute('aria-label')).toBe(
      'Standout look in Lisbon by Ana, 3 reactions. Opens the City Spotlight.'
    )
    // One focusable control; the image is decorative and outside the tree.
    expect(
      screen.getByTestId('home-spotlight-teaser').querySelectorAll('[tabindex="0"]')
    ).toHaveLength(1)
    const image = screen.getByTestId('home-spotlight-teaser-image')
    expect(image.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Private caption')
    await screen.findByTestId('home-spotlight-teaser-image-loaded')
    // It follows the hero conditional in focus order.
    expect(follows(screen.getByTestId('outfit-recommendation-card'), link)).toBe(true)
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })

  it('6.7-MOB-002 the author rule names the viewer You', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage(
        spotlightItem('look-self', { author: { displayName: 'Me', isSelf: true } })
      )
    )
    expect((await screen.findByTestId('home-spotlight-teaser-author')).textContent).toBe(
      'You'
    )
  })

  it('6.7-MOB-003 a blank author name uses the card fallback and one reaction is singular', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage(
        spotlightItem('look-blank', {
          author: { displayName: '   ', isSelf: false },
          reactions: {
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            viewerReaction: null,
            revision: 1,
            generation: 1,
          },
        })
      )
    )
    expect((await screen.findByTestId('home-spotlight-teaser-author')).textContent).toBe(
      'Style explorer'
    )
    expect(screen.getByTestId('home-spotlight-teaser-reactions').textContent).toBe(
      '1 reaction'
    )
  })

  it.each([
    [
      'level none',
      {
        status: 200,
        body: { data: { level: 'none', label: null, items: [], nextCursor: null } },
      },
    ],
    [
      'no items',
      {
        status: 200,
        body: { data: { level: 'city', label: 'Lisbon', items: [], nextCursor: null } },
      },
    ],
    [
      'the disabled 403',
      {
        status: 403,
        body: {
          statusCode: 403,
          code: 'denied',
          message: COMMUNITY_FEED_DISABLED_MESSAGE,
        },
      },
    ],
    [
      'the disabled 503',
      {
        status: 503,
        body: { statusCode: 503, message: COMMUNITY_FEED_DISABLED_MESSAGE },
      },
    ],
    [
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
    ['a network error', 'network-error'],
  ] as const)(
    '6.7-MOB-004 %s renders nothing, reads once and leaves Home exactly as without the teaser',
    async (_name, refusal) => {
      const { reads, answer } = deferSpotlightReads()
      setMobileApplicationUserId('member-1')
      await renderHome()
      await screen.findByTestId('outfit-recommendation-card')
      // Reference: the same Home while the teaser read is still out.
      await waitFor(() => expect(reads).toHaveLength(1))
      const expected = screen.getByTestId('hero-experience-scrollview').innerHTML
      await answer(0, refusal as Answer)
      await settledRead(0)
      expect(teaserNodes()).toEqual([])
      expect(screen.getByTestId('hero-experience-scrollview').innerHTML).toBe(expected)
      // The pending state is no reference for "no space": check that nothing at
      // all follows the hero.
      expectNothingAfterHero('outfit-recommendation-card')
      // A refusal starts no retry, in the wrapper or in the lifecycle.
      expect(reads).toHaveLength(1)
      expect(teaserReadCalls()).toBe(1)
    }
  )

  it('6.7-MOB-005 follows the hero while it is loading, failed or without a location', async () => {
    const { answer } = deferSpotlightReads()
    // Loading: the ritual never answers, the teaser still shows. The held
    // request is released when the test ends, so it holds no connection after.
    let releaseRitual!: () => void
    const ritualHeld = new Promise<void>((resolve) => {
      releaseRitual = resolve
    })
    onTestFinished(() => releaseRitual())
    server.use(
      http.get('*/api/v1/ritual', async () => {
        await ritualHeld
        return HttpResponse.error()
      })
    )
    setMobileApplicationUserId('member-1')
    const loading = await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    expect(follows(screen.getByTestId('outfit-recommendation-card-skeleton'), link)).toBe(
      true
    )
    await loading.unmount()

    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
      )
    )
    const failed = await renderHome()
    await answer(1, cityPage())
    const afterError = await screen.findByTestId('home-spotlight-teaser-link')
    expect(follows(await screen.findByTestId('hero-error-state'), afterError)).toBe(true)
    await failed.unmount()

    server.use(http.get('*/api/v1/ritual', noLocationResponse))
    await renderHome()
    await answer(2, cityPage())
    const afterNoLocation = await screen.findByTestId('home-spotlight-teaser-link')
    expect(
      follows(await screen.findByTestId('hero-no-location-state'), afterNoLocation)
    ).toBe(true)
  })

  it('6.7-MOB-006 a cold start reads nothing until the member resolves, then reads at once', async () => {
    const { reads, answer } = deferSpotlightReads()
    // Before the stored session is restored there is no bearer and no member.
    token = undefined
    await renderHome()
    await settledIdentity()
    expect(teaserReadCalls()).toBe(0)
    token = 'restored-token'
    act(() => setMobileApplicationUserId('member-1'))
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    expect(reads).toHaveLength(1)
  })

  it('6.7-MOB-007 an identity change clears the teaser and drops the late response', async () => {
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage(spotlightItem('look-member-1')))
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => setMobileApplicationUserId('member-2'))
    expect(teaserNodes()).toEqual([])
    // The new member reads at once, inside the previous member's 60-second floor.
    await waitFor(() => expect(reads).toHaveLength(2))
    act(() => setMobileApplicationUserId('member-3'))
    expect(teaserReadSignal(1)?.aborted).toBe(true)
    await waitFor(() => expect(reads).toHaveLength(3))
    // Member 2's response lands after the change and is dropped.
    await answer(1, cityPage(spotlightItem('look-member-2')))
    await settledRead(1)
    expect(teaserNodes()).toEqual([])
    await answer(2, cityPage(spotlightItem('look-member-3')))
    await screen.findByTestId('home-spotlight-teaser-link')

    // Sign-out: the session and its bearer are gone.
    token = undefined
    act(() => setMobileApplicationUserId(null))
    expect(teaserNodes()).toEqual([])
    await settledIdentity()
    expect(teaserReadCalls()).toBe(3)
  })

  it('6.7-MOB-018 the previous member is gone while the next identity is still resolving', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage(spotlightItem('look-member-1')))
    await screen.findByTestId('home-spotlight-teaser-link')
    // A re-read for member 1 is in flight.
    act(() => screenFocus.set(false))
    now += SPOTLIGHT_TEASER_READ_FLOOR_MS
    act(() => screenFocus.set(true))
    await waitFor(() => expect(reads).toHaveLength(2))

    // The session changes principal; the new bearer is still being verified.
    let releaseToken!: (value: string | undefined) => void
    token = new Promise((resolve) => {
      releaseToken = resolve
    })
    act(() => setMobileApplicationUserId(null))
    expect(teaserNodes()).toEqual([])
    expect(teaserReadSignal(1)?.aborted).toBe(true)
    // Member 1's re-read answers inside the gap and never renders.
    await answer(1, cityPage(spotlightItem('late-member-1')))
    await settledRead(1)
    expect(teaserNodes()).toEqual([])
    releaseToken(undefined)
    await settledIdentity()
    expect(teaserNodes()).toEqual([])
    expect(teaserReadCalls()).toBe(2)
  })

  it('6.7-MOB-008 an image that fails to load removes the teaser', async () => {
    const { answer } = deferSpotlightReads()
    server.use(http.get('*/teaser/:file', () => new HttpResponse(null, { status: 404 })))
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    await waitFor(() => expect(teaserNodes()).toEqual([]))
    await screen.findByTestId('outfit-recommendation-card')
    expectNothingAfterHero('outfit-recommendation-card')
  })

  it('6.7-MOB-009 each activation posts the home_teaser open and pushes a fresh focus token', async () => {
    const { answer } = deferSpotlightReads()
    const opens = recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    await userEvent.click(link)
    await userEvent.click(link)
    await waitFor(() => expect(opens).toHaveLength(2))
    expect(opens[0]).toEqual({
      postId: 'look-1',
      body: { surface: 'home_teaser', rank: 1, level: 'city' },
    })
    expect(routerPush).toHaveBeenCalledTimes(2)
    const [first, second] = routerPush.mock.calls.map(
      ([target]) => target as { pathname: string; params: Record<string, string> }
    )
    expect(first).toEqual({
      pathname: '/community',
      params: {
        source: 'app',
        type: 'community',
        cardId: 'look-1',
        focus: 'spotlight',
        focusToken: expect.any(String) as string,
      },
    })
    expect(second!.params.focusToken).not.toBe(first!.params.focusToken)
    // No caption, name, media or coordinates travel with the open.
    expect(JSON.stringify(opens)).not.toMatch(/caption|Ana|teaser\/|latitude/)
  })

  it('6.7-MOB-010 returning to Home focuses the teaser link once per activation', async () => {
    const { answer } = deferSpotlightReads()
    recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    await userEvent.click(link)
    act(() => screenFocus.set(false))
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => screenFocus.set(true))
    await waitFor(() => expect(document.activeElement).toBe(link))
    expectOccupiesNoLayout(
      await screen.findByTestId('home-spotlight-teaser-focused-link-1')
    )

    // The return is consumed: a later refocus moves nothing.
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    // Several frames: a focus move scheduled a frame or two out still shows.
    for (let frame = 0; frame < 5; frame += 1)
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    expect(document.activeElement).not.toBe(link)
    expect(screen.queryByTestId('home-spotlight-teaser-focused-link-2')).toBeNull()
  })

  it('6.7-MOB-011 a return with the teaser gone lands on the Home scroll view', async () => {
    const { answer } = deferSpotlightReads()
    recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await userEvent.click(await screen.findByTestId('home-spotlight-teaser-link'))
    act(() => screenFocus.set(false))
    // Signing out while away removes the teaser.
    token = undefined
    act(() => setMobileApplicationUserId(null))
    act(() => screenFocus.set(true))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('hero-experience-scrollview')
      )
    )
    // The automation marker is all that is left of the teaser, and it reserves
    // no space after the hero.
    expectOccupiesNoLayout(
      await screen.findByTestId('home-spotlight-teaser-focused-scroll-view-1')
    )
  })

  it('6.7-MOB-012 a teaser that leaves while it holds keyboard focus hands focus to the scroll view', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    act(() => link.focus())
    expect(document.activeElement).toBe(link)
    act(() => setMobileApplicationUserId('member-2'))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('hero-experience-scrollview')
      )
    )
  })

  it('6.7-MOB-013 a quick return inside 60 seconds reads nothing; a later return re-reads', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => screenFocus.set(false))
    now += SPOTLIGHT_TEASER_READ_FLOOR_MS - 1
    // A trigger starts its read synchronously, so the count is final here.
    act(() => screenFocus.set(true))
    expect(teaserReadCalls()).toBe(1)
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeTruthy()

    act(() => screenFocus.set(false))
    now += 1
    act(() => screenFocus.set(true))
    expect(teaserReadCalls()).toBe(2)
    await waitFor(() => expect(reads).toHaveLength(2))
    // The current value stays on screen while the re-read is in flight.
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeTruthy()
    await answer(
      1,
      cityPage(spotlightItem('look-2', { author: { displayName: 'Bea', isSelf: false } }))
    )
    await waitFor(() =>
      expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Bea')
    )
  })

  it('6.7-MOB-017 returning to the foreground re-reads only when the last attempt is older than 60 seconds', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const listeners: ((state: AppStateStatus) => void)[] = []
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void)
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>
    })
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    const emit = (state: AppStateStatus) =>
      act(() => {
        for (const listener of listeners) listener(state)
      })

    emit('background')
    now += 30_000
    emit('active')
    expect(teaserReadCalls()).toBe(1)
    emit('background')
    now += 31_000
    emit('active')
    expect(teaserReadCalls()).toBe(2)
  })

  it('6.7b-MOB-062 a foreground return is not a new visit: the sponsored teaser counts once', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = []
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void)
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>
    })
    const emit = (state: AppStateStatus) =>
      act(() => {
        for (const listener of listeners) listener(state)
      })
    // The hero records its own impression; only the teaser's counts here.
    const shown = () =>
      capture.mock.calls.filter(
        ([event, properties]) =>
          event === 'affiliate_cta_shown' &&
          (properties as { surface?: string }).surface === 'home_teaser'
      )
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage({
        ...spotlightItem('look-1'),
        sponsorship: {
          partnerId: 'atelier-north',
          partnerDisplayName: 'Atelier North',
          offerId: 'offer-coat',
          offerTitle: 'Wool overcoat',
        },
      } as ReturnType<typeof spotlightItem>)
    )
    await screen.findByTestId('home-spotlight-teaser-shop')
    await waitFor(() => expect(shown()).toHaveLength(1))

    // The CTA's in-app browser, or any app switch, backgrounds the app.
    emit('background')
    emit('active')
    await untilFrame(() => true)
    await screen.findByTestId('home-spotlight-teaser-shop')
    expect(shown()).toHaveLength(1)

    // Leaving Home and coming back is a new visit.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await waitFor(() => expect(shown()).toHaveLength(2))
    expect(shown()[1]![1]).toEqual({
      partner_id: 'atelier-north',
      offer_id: 'offer-coat',
      surface: 'home_teaser',
      locale_region: 'US',
    })
  })

  it('6.7b-MOB-068 persists no block from the sponsored teaser, before or after its CTA', async () => {
    // Structural guard: Home caches the ritual (without its own CTA block) and
    // nothing else, so the teaser's block never outlives its live read.
    const writes = recordPersistedWrites()
    const sponsorship = {
      partnerId: 'atelier-north',
      partnerDisplayName: 'Atelier North',
      offerId: 'offer-coat',
      offerTitle: 'Wool overcoat',
    }
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage({ ...spotlightItem('look-1'), sponsorship } as ReturnType<
        typeof spotlightItem
      >)
    )
    await userEvent.click(await screen.findByTestId('home-spotlight-teaser-shop'))
    await waitFor(() =>
      expect(openBrowserAsync).toHaveBeenCalledWith(mockAffiliateRedirectUrl)
    )
    // The hero's own ritual cache write went through, so Home did persist.
    await waitFor(() => expect(saveRitualCache).toHaveBeenCalled())

    expectNoSponsorshipPersisted(
      [
        ...writes(),
        ...vi.mocked(saveRitualCache).mock.calls.map((call) => JSON.stringify(call)),
      ],
      sponsorship
    )
  })

  it('6.7-MOB-019 a 429 Retry-After removes the teaser and defers the next read until it passes', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    act(() => screenFocus.set(false))
    now += SPOTLIGHT_TEASER_READ_FLOOR_MS
    act(() => screenFocus.set(true))
    await answer(1, {
      status: 429,
      headers: { 'Retry-After': '90' },
      body: { statusCode: 429, message: 'Too many spotlight reads.' },
    })
    await settledRead(1)
    expect(teaserNodes()).toEqual([])

    act(() => screenFocus.set(false))
    now += 89_000
    act(() => screenFocus.set(true))
    expect(teaserReadCalls()).toBe(2)
    act(() => screenFocus.set(false))
    now += 1_000
    act(() => screenFocus.set(true))
    expect(teaserReadCalls()).toBe(3)
  })
})

describe('6.7 mobile Home spotlight teaser timers', () => {
  const start = Date.parse('2026-10-23T12:00:00.000Z')

  function fakeClock() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(start)
  }

  it('6.7-MOB-014 re-reads 4 minutes after the last attempt and keeps the value while it is in flight', async () => {
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    // The faked clock has not moved: the read started and completed at `start`.
    expect(Date.now()).toBe(start)

    await advance(SPOTLIGHT_TEASER_REREAD_MS - 1)
    expect(teaserReadCalls()).toBe(1)
    await advance(1)
    expect(teaserReadCalls()).toBe(2)
    await untilFrame(() => reads.length === 2)
    expect(reads[1]!.url.searchParams.get('surface')).toBe('home_teaser')
    // The re-read is in flight: the current value stays until it settles.
    await advance(5_000)
    expect(teaserNodes().length).toBeGreaterThan(0)
    // A different rank-1 entry replaces the content in place.
    reads[1]!.resolve({
      status: 200,
      body: {
        data: cityPage(
          spotlightItem('look-2', { author: { displayName: 'Bea', isSelf: false } })
        ),
      },
    })
    await untilFrame(
      () =>
        document.querySelector('[data-testid="home-spotlight-teaser-author"]')
          ?.textContent === 'Bea'
    )
  })

  it('6.7-MOB-016 expires 5 minutes after the read when no re-read succeeds', async () => {
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    // Away from Home nothing re-reads, so only expiry can end the value.
    act(() => screenFocus.set(false))
    await advance(SPOTLIGHT_TEASER_EXPIRY_MS - 1)
    expect(teaserNodes().length).toBeGreaterThan(0)
    await advance(1)
    await untilFrame(() => teaserNodes().length === 0)
    expect(teaserReadCalls()).toBe(1)
    // Coming back reads again: the last attempt is older than 60 seconds.
    act(() => screenFocus.set(true))
    expect(teaserReadCalls()).toBe(2)
  })

  it.each([
    [
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
    [
      'a contention 503 with a one-second retry hint',
      {
        status: 503,
        body: {
          statusCode: 503,
          code: 'unavailable',
          retryAfterSeconds: 1,
          message: 'Community is temporarily unavailable.',
        },
      },
    ],
  ] as const)(
    '6.7-MOB-015 %s on the re-read removes the teaser at once and reads nothing more on its own',
    async (_name, failure) => {
      const { reads } = deferSpotlightReads()
      fakeClock()
      setMobileApplicationUserId('member-1')
      await renderHome()
      await showTeaser(reads)
      await advance(SPOTLIGHT_TEASER_REREAD_MS)
      await untilFrame(() => reads.length === 2)
      reads[1]!.resolve(failure)
      await untilFrame(() => teaserNodes().length === 0)
      // Past the advertised retry, the floor and three re-read periods: one
      // transport attempt per lifecycle read, and no timed retry after a failure.
      await advance(2_000)
      await advance(SPOTLIGHT_TEASER_REREAD_MS * 3)
      expect(teaserReadCalls()).toBe(2)
      expect(reads).toHaveLength(2)
    }
  )

  it('6.7b-MOB-067 a sponsored teaser whose re-read fails leaves with its CTA and records no second impression', async () => {
    // Nothing on the device keeps a community payload: once the live read fails,
    // there is no earlier copy for the Shop control to render from.
    const shown = () =>
      capture.mock.calls.filter(
        ([event, properties]) =>
          event === 'affiliate_cta_shown' &&
          (properties as { surface?: string }).surface === 'home_teaser'
      )
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(
      reads,
      cityPage({
        ...spotlightItem('look-1'),
        sponsorship: {
          partnerId: 'atelier-north',
          partnerDisplayName: 'Atelier North',
          offerId: 'offer-coat',
          offerTitle: 'Wool overcoat',
        },
      } as ReturnType<typeof spotlightItem>)
    )
    expect(screen.getByTestId('home-spotlight-teaser-shop')).toBeTruthy()
    await untilFrame(() => shown().length === 1)

    await advance(SPOTLIGHT_TEASER_REREAD_MS)
    await untilFrame(() => reads.length === 2)
    // The device went offline: the re-read never reaches the server.
    reads[1]!.resolve('network-error')

    await untilFrame(() => teaserNodes().length === 0)
    expect(screen.queryByTestId('home-spotlight-teaser-shop')).toBeNull()
    expect(screen.queryByTestId('home-spotlight-teaser-partnered')).toBeNull()
    expect(shown()).toHaveLength(1)
  })

  it('6.7-MOB-036 a re-read that never answers times out at the client and removes the teaser', async () => {
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    await advance(SPOTLIGHT_TEASER_REREAD_MS)
    await untilFrame(() => reads.length === 2)
    let settled = false
    void (
      vi.mocked(getCommunitySpotlightFromMobile).mock.results[1]!
        .value as Promise<unknown>
    ).then(
      () => (settled = true),
      () => (settled = true)
    )
    // Just inside the wrapper's 15-second request deadline the value is still shown.
    await advance(15_000 - 1)
    expect(settled).toBe(false)
    expect(teaserNodes().length).toBeGreaterThan(0)
    await advance(1)
    await untilFrame(() => settled)
    await untilFrame(() => teaserNodes().length === 0)
    expect(teaserReadCalls()).toBe(2)
  })

  it('6.7-MOB-054 the image deadline counts only while Home is active: time in the background never removes the teaser', async () => {
    let releaseImage!: () => void
    const imageHeld = new Promise<void>((resolve) => {
      releaseImage = resolve
    })
    onTestFinished(() => releaseImage())
    server.use(
      http.get('*/teaser/:file', async () => {
        await imageHeld
        return HttpResponse.error()
      })
    )
    const listeners: ((state: AppStateStatus) => void)[] = []
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void)
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>
    })
    const emit = (state: AppStateStatus) =>
      act(() => {
        for (const listener of listeners) listener(state)
      })
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await untilFrame(() => reads.length === 1)
    reads[0]!.resolve({ status: 200, body: { data: cityPage() } })
    await untilFrame(
      () => document.querySelector('[data-testid="home-spotlight-teaser-link"]') !== null
    )

    // Backgrounded almost at once, and away well past the deadline but inside the
    // read floor, so coming back starts no read.
    await advance(1_000)
    emit('background')
    await advance(40_000)
    expect(teaserNodes().length).toBeGreaterThan(0)

    // Back in the foreground the image gets a whole deadline of its own.
    emit('active')
    await advance(IMAGE_LOAD_TIMEOUT_MS - 1)
    expect(teaserNodes().length).toBeGreaterThan(0)
    await advance(1)
    await untilFrame(() => teaserNodes().length === 0)
    expect(teaserReadCalls()).toBe(1)
  })

  it('6.7-MOB-039 an image that settles neither way within 15 seconds removes the teaser', async () => {
    // The image host never answers: no onLoad, no onError. Released at the end so
    // the held request outlives nothing.
    let releaseImage!: () => void
    const imageHeld = new Promise<void>((resolve) => {
      releaseImage = resolve
    })
    onTestFinished(() => releaseImage())
    server.use(
      http.get('*/teaser/:file', async () => {
        await imageHeld
        return HttpResponse.error()
      })
    )
    const { reads } = deferSpotlightReads()
    fakeClock()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await untilFrame(() => reads.length === 1)
    reads[0]!.resolve({ status: 200, body: { data: cityPage() } })
    await untilFrame(
      () => document.querySelector('[data-testid="home-spotlight-teaser-link"]') !== null
    )
    await advance(IMAGE_LOAD_TIMEOUT_MS - 1)
    expect(teaserNodes().length).toBeGreaterThan(0)
    expect(screen.queryByTestId('home-spotlight-teaser-image-loaded')).toBeNull()
    await advance(1)
    await untilFrame(() => teaserNodes().length === 0)
    expect(teaserReadCalls()).toBe(1)
  })

  it.each([
    [
      'the disabled 403',
      {
        status: 403,
        body: {
          statusCode: 403,
          code: 'denied',
          message: COMMUNITY_FEED_DISABLED_MESSAGE,
        },
      },
    ],
    [
      'the disabled 503',
      {
        status: 503,
        body: { statusCode: 503, message: COMMUNITY_FEED_DISABLED_MESSAGE },
      },
    ],
    [
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
  ] as const)(
    '6.7-MOB-040 %s on the first read starts no retry loop while Home stays shown',
    async (_name, refusal) => {
      const { reads } = deferSpotlightReads()
      fakeClock()
      setMobileApplicationUserId('member-1')
      await renderHome()
      await untilFrame(() => reads.length === 1)
      reads[0]!.resolve(refusal)
      // Settled at the wrapper's own promise; waitFor would ride the faked clock.
      let settled = false
      void (
        vi.mocked(getCommunitySpotlightFromMobile).mock.results[0]!
          .value as Promise<unknown>
      ).then(
        () => (settled = true),
        () => (settled = true)
      )
      await untilFrame(() => settled)
      // Two re-read periods with Home in focus: no timed retry, no wrapper retry.
      await advance(SPOTLIGHT_TEASER_REREAD_MS * 2)
      expect(teaserReadCalls()).toBe(1)
      expect(reads).toHaveLength(1)
      expect(teaserNodes()).toEqual([])
    }
  )
})
