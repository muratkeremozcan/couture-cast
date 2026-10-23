/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7: the Home teaser's native focus path and its render isolation. The
// focus cases run as iOS, where focus moves through a native handle and a screen
// reader reports no focus or blur event, so only the return window may hand
// focus to the scroll view.
import type { ComponentProps } from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import type * as OutfitCardModule from '@/components/hero/outfit-recommendation-card'
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

const routerPush = vi.hoisted(() => vi.fn())
const heroCardRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/lib/community', { spy: true })
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})
// Counts hero card renders, so a teaser update that re-renders the hero shows.
vi.mock('@/components/hero/outfit-recommendation-card', async (importOriginal) => {
  const actual = await importOriginal<typeof OutfitCardModule>()
  const { createElement } = await import('react')
  function CountingOutfitRecommendationCard(
    props: ComponentProps<typeof actual.OutfitRecommendationCard>
  ) {
    heroCardRenders.count += 1
    return createElement(actual.OutfitRecommendationCard, props)
  }
  return { ...actual, OutfitRecommendationCard: CountingOutfitRecommendationCard }
})
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
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

import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import {
  cityPage,
  deferSpotlightReads,
  recordOpens,
  renderHome,
  serveTeaserImages,
  settledRead,
  spotlightItem,
} from '@/src/test-utils/home-teaser'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { TEASER_RETURN_FOCUS_HOLD_MS } from '@/src/features/home/use-home-spotlight-teaser'
import i18n, { initI18n } from '@/src/lib/i18n'

let restoreToken: (() => void) | undefined
let token: string | undefined

/** Signs out: the bearer and the member are gone, and nothing reads again. */
function signOut() {
  token = undefined
  act(() => setMobileApplicationUserId(null))
}

/** iOS focus plumbing: every node handed to findNodeHandle gets a stable handle. */
function iosFocusHandles() {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  const nodes: unknown[] = []
  vi.mocked(findNodeHandle).mockImplementation((node: unknown) => {
    if (!nodes.includes(node)) nodes.push(node)
    return 500 + nodes.indexOf(node)
  })
  return {
    handleOf: (node: unknown) => 500 + nodes.indexOf(node),
    /** The DOM node behind a native focus target, a host element or a scroll view. */
    domOf: (handle: number): unknown => {
      const node = nodes[handle - 500] as
        | { getScrollableNode?: () => unknown }
        | undefined
      return node?.getScrollableNode ? node.getScrollableNode() : node
    },
  }
}

function focusCalls(): number[] {
  return vi
    .mocked(AccessibilityInfo.setAccessibilityFocus)
    .mock.calls.map(([handle]) => handle)
}

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

async function shownTeaser() {
  const { answer } = deferSpotlightReads()
  recordOpens()
  setMobileApplicationUserId('member-1')
  await renderHome()
  await answer(0, cityPage())
  return screen.findByTestId('home-spotlight-teaser-link')
}

/** Activates the teaser, leaves Home and comes back, as a tab press or back does. */
async function activateAndReturn(link: HTMLElement) {
  fireEvent.click(link)
  act(() => screenFocus.set(false))
  act(() => screenFocus.set(true))
  await nextFrame()
}

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})
beforeEach(async () => {
  vi.clearAllMocks()
  screenFocus.reset()
  heroCardRenders.count = 0
  token = 'session-token'
  restoreToken = setMobileAccessTokenResolver(() => token)
  setMobileApplicationUserId(null)
  await i18n.changeLanguage('en-US')
  server.use(http.get('*/api/v1/ritual', () => HttpResponse.json(mockRitualResponse)))
  serveTeaserImages()
})
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  vi.restoreAllMocks()
  restoreToken?.()
  setMobileApplicationUserId(null)
})

describe('6.7 mobile Home teaser native focus', () => {
  it('6.7-MOB-030 a return moves native accessibility focus to the teaser link exactly once', async () => {
    const link = await shownTeaser()
    const { handleOf, domOf } = iosFocusHandles()
    await activateAndReturn(link)

    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    expect(domOf(focusCalls()[0]!)).toBe(link)
    expect(focusCalls()).toEqual([handleOf(link)])
    await screen.findByTestId('home-spotlight-teaser-focused-link-1')

    // Consumed: the next refocus moves nothing.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await nextFrame()
    expect(focusCalls()).toHaveLength(1)
  })

  it('6.7-MOB-031 a return with the teaser gone focuses the scroll view natively, once', async () => {
    const link = await shownTeaser()
    const { domOf } = iosFocusHandles()
    fireEvent.click(link)
    act(() => screenFocus.set(false))
    signOut()
    act(() => screenFocus.set(true))
    await nextFrame()

    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    expect(domOf(focusCalls()[0]!)).toBe(screen.getByTestId('hero-experience-scrollview'))
    await screen.findByTestId('home-spotlight-teaser-focused-scroll-view-1')
  })

  it('6.7-MOB-032 a teaser that leaves inside the return window hands focus to the scroll view', async () => {
    const link = await shownTeaser()
    const { domOf } = iosFocusHandles()
    await activateAndReturn(link)
    await waitFor(() => expect(focusCalls()).toHaveLength(1))

    signOut()
    await nextFrame()
    await waitFor(() => expect(focusCalls()).toHaveLength(2))
    expect(domOf(focusCalls()[1]!)).toBe(screen.getByTestId('hero-experience-scrollview'))
  })

  it('6.7-MOB-033 past the return window a leaving teaser steals no focus', async () => {
    const link = await shownTeaser()
    iosFocusHandles()
    await activateAndReturn(link)
    await waitFor(() => expect(focusCalls()).toHaveLength(1))

    // The member swiped on; no screen reader reports it. The window has closed.
    const closed = Date.now() + TEASER_RETURN_FOCUS_HOLD_MS
    vi.spyOn(Date, 'now').mockReturnValue(closed)
    signOut()
    await nextFrame()
    await nextFrame()
    expect(focusCalls()).toHaveLength(1)
  })

  it('6.7-MOB-034 a teaser reached by swiping, then removed, moves no focus', async () => {
    await shownTeaser()
    iosFocusHandles()
    signOut()
    await nextFrame()
    await nextFrame()
    expect(focusCalls()).toEqual([])
  })
})

describe('6.7 mobile Home teaser render isolation', () => {
  it('6.7-MOB-035 teaser reads and identity-driven teaser updates never re-render the hero card', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await screen.findByTestId('outfit-recommendation-card')
    await waitFor(() => expect(heroCardRenders.count).toBeGreaterThan(0))
    const settledRenders = heroCardRenders.count

    await answer(0, cityPage(spotlightItem('look-1')))
    await screen.findByTestId('home-spotlight-teaser-image-loaded')
    await settledRead(0)
    // Home focus changes drive the teaser lifecycle only.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await nextFrame()
    expect(heroCardRenders.count).toBe(settledRenders)
  })
})
