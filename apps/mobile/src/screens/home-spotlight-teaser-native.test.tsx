/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7: the Home teaser's native focus path and its render isolation. The
// focus cases run as iOS, where focus moves through a native handle. React
// Native reports no screen-reader focus, so a native build learns where the OS
// put accessibility focus from the local observer module, faked here; Expo Go
// carries no such module, and that path is covered too.
import type { ComponentProps } from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import type * as OutfitCardModule from '@/components/hero/outfit-recommendation-card'
import type { AccessibilityFocusListener } from '@/modules/accessibility-focus'
import { act, configure, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

const routerPush = vi.hoisted(() => vi.fn())
const heroCardRenders = vi.hoisted(() => ({ count: 0 }))
/** The OS side of the accessibility-focus observer: a test reports where focus is. */
const osFocus = vi.hoisted(() => ({
  available: true,
  listeners: new Set<AccessibilityFocusListener>(),
  report(tags: number[]) {
    for (const listener of [...this.listeners]) listener({ tags })
  },
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/lib/community', { spy: true })
vi.mock('@/modules/accessibility-focus', () => ({
  observeAccessibilityFocus: (listener: AccessibilityFocusListener) => {
    if (!osFocus.available) return null
    osFocus.listeners.add(listener)
    return () => {
      osFocus.listeners.delete(listener)
    }
  },
}))
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
  settledIdentity,
  settledRead,
  spotlightItem,
  teaserNodes,
} from '@/src/test-utils/home-teaser'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { communityCommentsSessionFromMobile } from '@/src/lib/community'
import { SPOTLIGHT_TEASER_READ_FLOOR_MS } from '@couture/api-client'
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
    handleOf: (node: unknown) => {
      if (!nodes.includes(node)) nodes.push(node)
      return 500 + nodes.indexOf(node)
    },
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

/** The OS puts accessibility focus on `handle`, as VoiceOver reports it. */
function osFocusLandsOn(...tags: number[]) {
  act(() => osFocus.report(tags))
}

async function frames(count: number) {
  for (let frame = 0; frame < count; frame += 1)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
}

/** "Moves nothing" waits several frames: a move queued a frame or two out still shows. */
const settleFrames = () => frames(5)

async function shownTeaser() {
  const { answer, reads } = deferSpotlightReads()
  recordOpens()
  setMobileApplicationUserId('member-1')
  await renderHome()
  await answer(0, cityPage())
  const link = await screen.findByTestId('home-spotlight-teaser-link')
  return { link, answer, reads }
}

/** Activates the teaser, leaves Home and comes back, as a tab press or back does. */
async function activateAndReturn(link: HTMLElement) {
  await userEvent.click(link)
  act(() => screenFocus.set(false))
  act(() => screenFocus.set(true))
  await frames(1)
}

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})
beforeEach(async () => {
  vi.clearAllMocks()
  screenFocus.reset()
  osFocus.available = true
  osFocus.listeners.clear()
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
    const { link } = await shownTeaser()
    const { handleOf, domOf } = iosFocusHandles()
    await activateAndReturn(link)

    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    expect(domOf(focusCalls()[0]!)).toBe(link)
    expect(focusCalls()).toEqual([handleOf(link)])
    await screen.findByTestId('home-spotlight-teaser-focus-requested-link-1')
    // Only the OS report confirms the move.
    expect(screen.queryByTestId('home-spotlight-teaser-focused-link-1')).toBeNull()
    osFocusLandsOn(handleOf(link))
    await screen.findByTestId('home-spotlight-teaser-focused-link-1')

    // Consumed: the next refocus moves nothing.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await settleFrames()
    expect(focusCalls()).toHaveLength(1)
  })

  it('6.7-MOB-031 a return with the teaser gone focuses the scroll view natively, once', async () => {
    const { link } = await shownTeaser()
    const { domOf, handleOf } = iosFocusHandles()
    await userEvent.click(link)
    act(() => screenFocus.set(false))
    signOut()
    act(() => screenFocus.set(true))

    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    const scrollView = screen.getByTestId('hero-experience-scrollview')
    expect(domOf(focusCalls()[0]!)).toBe(scrollView)
    await screen.findByTestId('home-spotlight-teaser-focus-requested-scroll-view-1')
    // VoiceOver lands on an element inside the scroll view, which reports it as an ancestor.
    osFocusLandsOn(4242, focusCalls()[0]!)
    await screen.findByTestId('home-spotlight-teaser-focused-scroll-view-1')
    expect(handleOf(link)).not.toBe(focusCalls()[0])
  })

  it('6.7-MOB-032 a teaser the OS still reports focused when it leaves hands focus to the scroll view, however long it held it', async () => {
    const { link } = await shownTeaser()
    const { domOf, handleOf } = iosFocusHandles()
    await activateAndReturn(link)
    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    osFocusLandsOn(handleOf(link))

    // Long past any window a timer could have used.
    const later = Date.now() + 11 * 60_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    signOut()
    await waitFor(() => expect(focusCalls()).toHaveLength(2))
    expect(domOf(focusCalls()[1]!)).toBe(screen.getByTestId('hero-experience-scrollview'))
    await settleFrames()
    expect(focusCalls()).toHaveLength(2)
  })

  it('6.7-MOB-033 a member who swiped away right after the return keeps their focus when the teaser leaves', async () => {
    const { link } = await shownTeaser()
    const { handleOf } = iosFocusHandles()
    await activateAndReturn(link)
    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    osFocusLandsOn(handleOf(link))

    // A swipe within the first second puts VoiceOver on another control.
    osFocusLandsOn(777)
    signOut()
    await settleFrames()
    expect(teaserNodes()).toEqual([])
    expect(focusCalls()).toHaveLength(1)
  })

  it('6.7-MOB-034 a teaser reached by swiping, then removed, hands focus to the scroll view', async () => {
    const { link } = await shownTeaser()
    const { domOf, handleOf } = iosFocusHandles()
    osFocusLandsOn(handleOf(link))
    signOut()
    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    expect(domOf(focusCalls()[0]!)).toBe(screen.getByTestId('hero-experience-scrollview'))
  })

  it('6.7-MOB-046 without the observer (Expo Go) the return still focuses the link, nothing is confirmed and a removal moves nothing', async () => {
    osFocus.available = false
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level)
    )
    const { link } = await shownTeaser()
    const { handleOf } = iosFocusHandles()
    await activateAndReturn(link)
    await waitFor(() => expect(focusCalls()).toEqual([handleOf(link)]))
    await screen.findByTestId('home-spotlight-teaser-focus-requested-link-1')

    signOut()
    await settleFrames()
    expect(teaserNodes()).toEqual([])
    expect(focusCalls()).toHaveLength(1)
    expect(
      document.querySelector('[data-testid^="home-spotlight-teaser-focused-"]')
    ).toBeNull()
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })

  it('6.7-MOB-047 a re-read that fails between the return and its focus frame sends focus to the scroll view, once', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { link, answer, reads } = await shownTeaser()
    const { domOf } = iosFocusHandles()
    await userEvent.click(link)
    act(() => screenFocus.set(false))
    now += SPOTLIGHT_TEASER_READ_FLOOR_MS + 1_000

    // Hold every animation frame, so the return focus waits while the re-read fails.
    const held: FrameRequestCallback[] = []
    const frame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => held.push(callback))
    act(() => screenFocus.set(true))
    await waitFor(() => expect(reads).toHaveLength(2))
    await answer(1, { status: 500, body: { error: 'unavailable' } })
    await settledRead(1)
    expect(teaserNodes()).toEqual([])
    expect(focusCalls()).toEqual([])

    frame.mockRestore()
    act(() => {
      for (const callback of held.splice(0)) callback(performance.now())
    })
    await waitFor(() => expect(focusCalls()).toHaveLength(1))
    expect(domOf(focusCalls()[0]!)).toBe(screen.getByTestId('hero-experience-scrollview'))
    await settleFrames()
    expect(focusCalls()).toHaveLength(1)
  })
})

/** Waits until the hero card has rendered the same count for several frames. */
async function stableHeroRenders(): Promise<number> {
  let last = -1
  let steady = 0
  for (let frame = 0; frame < 300 && steady < 5; frame += 1) {
    await frames(1)
    steady = heroCardRenders.count === last ? steady + 1 : 0
    last = heroCardRenders.count
  }
  expect(steady).toBe(5)
  return last
}

describe('6.7 mobile Home teaser render isolation', () => {
  it('6.7-MOB-035 teaser reads, identity-driven teaser updates and focus changes never re-render the hero card', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await screen.findByTestId('outfit-recommendation-card')
    const settledRenders = await stableHeroRenders()

    await answer(0, cityPage(spotlightItem('look-1')))
    await screen.findByTestId('home-spotlight-teaser-image-loaded')
    await settledRead(0)
    // Home focus changes drive the teaser lifecycle only.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await settleFrames()
    expect(heroCardRenders.count).toBe(settledRenders)

    // An identity change re-renders Home for the hero's own sake. Hold the
    // teaser's member resolution, so the teaser's own updates come after it.
    let resolveMember!: (member: string | null) => void
    vi.mocked(communityCommentsSessionFromMobile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMember = resolve
        })
    )
    act(() => setMobileApplicationUserId('member-2'))
    expect(teaserNodes()).toEqual([])
    const afterIdentity = await stableHeroRenders()

    act(() => resolveMember('member-2'))
    await settledIdentity()
    await answer(1, cityPage(spotlightItem('look-member-2')))
    await settledRead(1)
    await screen.findByTestId('home-spotlight-teaser-image-loaded')
    await settleFrames()
    expect(heroCardRenders.count).toBe(afterIdentity)
  })
})
