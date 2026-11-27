// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 builder tests: 7.7-NAT-002, 7.7-NAT-003, 7.7-NAT-016 and the Home half of
// 7.7-NAT-004.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// Home shows the gate's placeholder until the ritual read (which carries the weather) settles:
// the member sample never shows first (D2), the stale and alert banners arrive with the body
// (D4), and a refresh with the outfit on screen never returns to the loading state (D5).
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import React from 'react'
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
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

const ritualCache = vi.hoisted(() => ({
  cached: null as null | { data: unknown; timestamp: number },
  // Every landed ritual read and every swap writes the cache once: an answer that changes
  // nothing on screen is awaited by its write.
  saves: 0,
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
  // A plain import: `vi.importActual` loads a second copy of the double, whose `screenFocus`
  // the test's own import never drives.
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    withoutShopThisLook: actual.withoutShopThisLook,
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: () => Promise.resolve(ritualCache.cached),
    saveRitualCache: () => {
      ritualCache.saves += 1
      return Promise.resolve(undefined)
    },
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: () => Promise.resolve(undefined),
  }
})

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { formatTemperature } from '@/components/hero/weather-header'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { userEvent } from 'vitest/browser'

/**
 * Ritual answers the test releases by hand, in request order. Every answer still held when the
 * test ends, a failed one included, is released then, so no request outlives its test.
 */
function heldRitualAnswers() {
  const releases: ((response: Response) => void)[] = []
  onTestFinished(() => {
    for (const release of releases) release(new HttpResponse(null, { status: 503 }))
  })
  server.use(
    http.get(
      '*/api/v1/ritual',
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve)
        })
    )
  )
  return {
    requests: () => releases.length,
    release: async (index: number, response: Response) => {
      await waitFor(() => expect(releases.length).toBeGreaterThan(index))
      await act(async () => {
        releases[index]!(response)
        await Promise.resolve()
      })
    },
  }
}

const emptyOutfitRitual = {
  ...mockRitualResponse,
  data: {
    ...mockRitualResponse.data,
    outfits: mockRitualResponse.data.outfits.map((outfit) => ({
      ...outfit,
      garmentIds: [],
    })),
  },
}

const alertRitual = {
  ...mockRitualResponse,
  data: {
    ...mockRitualResponse.data,
    weather: {
      ...mockRitualResponse.data.weather,
      alerts: [
        {
          event: 'Severe Wind Advisory',
          description: 'High winds expected up to 50mph.',
          start: '2026-07-22T00:00:00.000Z',
          end: '2026-07-22T06:00:00.000Z',
          severity: 'high',
        },
      ],
    },
  },
}

function renderHome() {
  return render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )
}

/** Home under the root status bar, the floating slot a refresh failure reports in. */
function renderHomeWithStatusBar() {
  return render(
    <SaveFeedbackProvider>
      <AccessibilityAnnouncerProvider>
        <TabOneScreen />
      </AccessibilityAnnouncerProvider>
    </SaveFeedbackProvider>
  )
}

/** A tab switch away from Home and back: the tab stays mounted, only its focus changes. */
function leaveAndReturn() {
  act(() => screenFocus.set(false))
  act(() => screenFocus.set(true))
}

const warmerRitual = {
  ...mockRitualResponse,
  data: {
    ...mockRitualResponse.data,
    weather: {
      ...mockRitualResponse.data.weather,
      current: {
        ...mockRitualResponse.data.weather.current,
        temperature: mockRitualResponse.data.weather.current.temperature + 7,
      },
    },
  },
}

/** The same ritual answered for another saved location. */
const otherLocationRitual = {
  ...mockRitualResponse,
  data: {
    ...mockRitualResponse.data,
    weather: { ...mockRitualResponse.data.weather, locationKey: 'other-location-key' },
  },
}

/**
 * Pins the clock the ritual's day is read from (the fixture's zone is America/Los_Angeles, UTC-7
 * in July). Only `Date` is faked, and it keeps moving with real time from there, so anything
 * timed by `Date.now()` still runs; timers and animation frames stay real.
 */
function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(iso))
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

/** Swaps the morning outfit's trench coat for the leather jacket in the garment swap modal. */
async function swapTrenchForLeatherJacket() {
  fireEvent.click(screen.getByTestId('garment-tile-classic-trench-coat'))
  fireEvent.click(await screen.findByTestId('swap-option-leather-jacket'))
  await waitFor(() =>
    expect(screen.getByTestId('garment-tile-leather-jacket')).toBeVisible()
  )
  expect(screen.queryByTestId('garment-tile-classic-trench-coat')).toBeNull()
  await waitFor(() => expect(screen.queryByTestId('garment-swap-modal')).toBeNull())
}

const placeholder = () => screen.queryByTestId('screen-placeholder')
const homeGate = () => screen.getByTestId('screen-gate')

describe('Home screen gate (native)', () => {
  let restore: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })

  beforeEach(async () => {
    ritualCache.cached = null
    ritualCache.saves = 0
    restore = setMobileAccessTokenResolver(() => 'member-token')
    setMobileApplicationUserId('gate-member')
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restore?.()
    setMobileApplicationUserId(null)
    screenFocus.reset()
  })

  it('7.7-NAT-002 shows the placeholder, never the member sample, until the ritual and weather read settles', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()

    await waitFor(() => expect(ritual.requests()).toBe(1))
    expect(placeholder()).toBeVisible()
    expect(homeGate()).not.toHaveAttribute('data-ready')
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
    expect(screen.queryByTestId('home-signed-out-welcome')).toBeNull()

    await ritual.release(0, HttpResponse.json(mockRitualResponse))

    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())
    expect(placeholder()).toBeNull()
    expect(homeGate()).toHaveAttribute('data-ready', 'true')
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
  })

  it('7.7-NAT-002 shows the member sample only once the ritual settled without a usable outfit', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()

    await waitFor(() => expect(ritual.requests()).toBe(1))
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()

    await ritual.release(0, HttpResponse.json(emptyOutfitRitual))

    await waitFor(() => expect(screen.getByTestId('member-sample-outfit')).toBeVisible())
    expect(placeholder()).toBeNull()
  })

  // CodeRabbit r1: the settled ritual belongs to one member visit. The same member back after a
  // sign-out waits for their new ritual read like a first load.
  it('7.7-NAT-010 the same member back after a sign-out sees the placeholder, never the sample, until the new ritual settles', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())

    // Sign out: the device has no token and no member.
    const signOut = setMobileAccessTokenResolver(() => undefined)
    act(() => setMobileApplicationUserId(null))
    await waitFor(() =>
      expect(screen.getByTestId('home-signed-out-welcome')).toBeVisible()
    )

    // The same member signs back in; their new ritual read is held.
    signOut()
    act(() => setMobileApplicationUserId('gate-member'))
    await waitFor(() => expect(ritual.requests()).toBe(2))

    expect(placeholder()).toBeVisible()
    expect(homeGate()).not.toHaveAttribute('data-ready')
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()

    await ritual.release(1, HttpResponse.json(mockRitualResponse))

    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())
    expect(placeholder()).toBeNull()
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
  })

  it('7.7-NAT-004 the weather alert banner arrives with the body, never above a shown outfit', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()

    await waitFor(() => expect(ritual.requests()).toBe(1))
    expect(screen.queryByTestId('weather-alert-banner')).toBeNull()

    await ritual.release(0, HttpResponse.json(alertRitual))

    await waitFor(() => expect(screen.getByTestId('weather-alert-banner')).toBeVisible())
    // Same commit: the banner and the weather it sits above appear together.
    expect(screen.getByTestId('weather-header')).toBeVisible()
    expect(placeholder()).toBeNull()
  })

  it('7.7-NAT-004 the stale banner arrives with the cached outfit, behind the placeholder until then', async () => {
    ritualCache.cached = {
      data: mockRitualResponse,
      // Older than the 15-minute freshness window, so the network is asked first.
      timestamp: Date.now() - 20 * 60 * 1000,
    }
    const ritual = heldRitualAnswers()
    await renderHome()

    await waitFor(() => expect(ritual.requests()).toBe(1))
    expect(placeholder()).toBeVisible()
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull()

    await ritual.release(0, new HttpResponse(null, { status: 503 }))

    await waitFor(() => expect(screen.getByTestId('stale-cache-banner')).toBeVisible())
    expect(screen.getByTestId('weather-header')).toBeVisible()
    expect(placeholder()).toBeNull()
  })

  it('7.7-NAT-003 a refresh with the outfit on screen keeps it in place, with no loading state', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())
    const header = screen.getByTestId('weather-header')

    // A locale change reads the ritual again while the outfit stays on screen.
    await act(async () => {
      await i18n.changeLanguage('fr-FR')
    })
    await waitFor(() => expect(ritual.requests()).toBe(2))

    expect(placeholder()).toBeNull()
    expect(screen.queryByTestId('weather-header-skeleton')).toBeNull()
    expect(screen.queryByTestId('outfit-recommendation-card-skeleton')).toBeNull()
    // The same mounted header keeps the first answer's reading, in the new locale's unit
    // (fr-FR reads Celsius, so the en-US text it showed before cannot match).
    expect(screen.getByTestId('weather-header')).toBe(header)
    expect(header).toBeVisible()
    expect(screen.getByTestId('current-temperature').textContent).toBe(
      formatTemperature(mockRitualResponse.data.weather.current.temperature)
    )

    // A refresh that fails keeps the outfit and inserts no banner above it.
    await ritual.release(1, new HttpResponse(null, { status: 503 }))
    // A kept outfit has no event to wait for: give the failed answer a few turns to land.
    await act(async () => {
      for (let turn = 0; turn < 5; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByTestId('weather-header')).toBeVisible()
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull()
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
  })
  it('7.7-NAT-003 a return to Home re-reads the ritual in place, with the outfit and scroll kept', async () => {
    const ritual = heldRitualAnswers()
    await renderHome()
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())
    const scrollView = screen.getByTestId('hero-experience-scrollview')
    const temperature = screen.getByTestId('current-temperature').textContent

    // Leaving reads nothing; the return does.
    act(() => screenFocus.set(false))
    expect(ritual.requests()).toBe(1)
    act(() => screenFocus.set(true))
    await waitFor(() => expect(ritual.requests()).toBe(2))

    // While the read runs: the same mounted scroll view (so its offset), the outfit, and no
    // placeholder or skeleton.
    expect(screen.getByTestId('hero-experience-scrollview')).toBe(scrollView)
    expect(placeholder()).toBeNull()
    expect(screen.queryByTestId('weather-header-skeleton')).toBeNull()
    expect(screen.queryByTestId('outfit-recommendation-card-skeleton')).toBeNull()
    expect(screen.getByTestId('current-temperature').textContent).toBe(temperature)

    // The answer replaces the outfit in place.
    await ritual.release(1, HttpResponse.json(warmerRitual))
    await waitFor(() =>
      expect(screen.getByTestId('current-temperature').textContent).not.toBe(temperature)
    )
    expect(screen.getByTestId('hero-experience-scrollview')).toBe(scrollView)
    expect(placeholder()).toBeNull()
  })

  it('7.7-NAT-004 a failed refresh keeps the outfit and reports in the status bar, with Retry', async () => {
    const ritual = heldRitualAnswers()
    await renderHomeWithStatusBar()
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() => expect(screen.getByTestId('weather-header')).toBeVisible())
    const header = screen.getByTestId('weather-header')
    const headerTop = header.getBoundingClientRect().top

    leaveAndReturn()
    await ritual.release(1, new HttpResponse(null, { status: 503 }))

    const bar = await screen.findByTestId('status-feedback-bar')
    expect(bar).toHaveTextContent(i18n.t('hero.load_error'))
    // Nothing was inserted above the outfit: the header did not move, and no inline banner.
    expect(screen.getByTestId('weather-header')).toBe(header)
    expect(header.getBoundingClientRect().top).toBe(headerTop)
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull()

    await userEvent.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() => expect(ritual.requests()).toBe(3))
  })

  // CodeRabbit r2: a member's swap stays for the ritual it was made on, the same location and
  // day. A return read that began before the swap and lands after it keeps it too.
  it('7.7-NAT-016 a swap stays through return reads for the same ritual, one begun before it included', async () => {
    // 09:00 in Los Angeles: past the 08:00 rollover, so every read here is tomorrow's ritual.
    pinClock('2026-07-22T16:00:00.000Z')
    const ritual = heldRitualAnswers()
    await renderHome()
    fireEvent.click(await screen.findByTestId('today-primary-action'))
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() =>
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toBeVisible()
    )
    const temperature = screen.getByTestId('current-temperature').textContent

    leaveAndReturn()
    await waitFor(() => expect(ritual.requests()).toBe(2))
    await swapTrenchForLeatherJacket()

    // The read begun before the swap lands with new weather and the server's unswapped outfit.
    await ritual.release(1, HttpResponse.json(warmerRitual))
    await waitFor(() =>
      expect(screen.getByTestId('current-temperature').textContent).not.toBe(temperature)
    )
    expect(screen.getByTestId('garment-tile-leather-jacket')).toBeVisible()
    expect(screen.queryByTestId('garment-tile-classic-trench-coat')).toBeNull()

    // Two hours later, same day: a read begun after the swap keeps it as well.
    vi.setSystemTime(new Date('2026-07-22T18:00:00.000Z'))
    leaveAndReturn()
    await ritual.release(2, HttpResponse.json(mockRitualResponse))
    await waitFor(() =>
      expect(screen.getByTestId('current-temperature').textContent).toBe(temperature)
    )
    expect(screen.getByTestId('garment-tile-leather-jacket')).toBeVisible()
    expect(screen.queryByTestId('garment-tile-classic-trench-coat')).toBeNull()
  })

  // CodeRabbit r3: an unchanged answer across the 08:00 rollover is the next day's ritual. A
  // swap made after it belongs to that day and survives the next same-day read.
  it('7.7-NAT-016 a swap made after an unchanged read across 08:00 stays through the next read that day', async () => {
    // 07:30 in Los Angeles: before the 08:00 rollover, so the first ritual is today's.
    pinClock('2026-07-22T14:30:00.000Z')
    const ritual = heldRitualAnswers()
    await renderHome()
    fireEvent.click(await screen.findByTestId('today-primary-action'))
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() =>
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toBeVisible()
    )

    await waitFor(() => expect(ritualCache.saves).toBe(1))

    // 08:30: the same payload comes back, now as tomorrow's ritual. Nothing on screen changes,
    // so the swap waits for the read's cache write.
    vi.setSystemTime(new Date('2026-07-22T15:30:00.000Z'))
    leaveAndReturn()
    await ritual.release(1, HttpResponse.json(mockRitualResponse))
    await waitFor(() => expect(ritualCache.saves).toBe(2))
    await swapTrenchForLeatherJacket()

    // 10:30, the same day: a read with new weather keeps the swap.
    vi.setSystemTime(new Date('2026-07-22T17:30:00.000Z'))
    const temperature = screen.getByTestId('current-temperature').textContent
    leaveAndReturn()
    await ritual.release(2, HttpResponse.json(warmerRitual))
    await waitFor(() =>
      expect(screen.getByTestId('current-temperature').textContent).not.toBe(temperature)
    )
    expect(screen.getByTestId('garment-tile-leather-jacket')).toBeVisible()
    expect(screen.queryByTestId('garment-tile-classic-trench-coat')).toBeNull()
  })

  it('7.7-NAT-016 a return read for another day or another location replaces the swap', async () => {
    // 07:30 in Los Angeles: before the 08:00 rollover, so the first ritual is today's.
    pinClock('2026-07-22T14:30:00.000Z')
    const ritual = heldRitualAnswers()
    await renderHome()
    fireEvent.click(await screen.findByTestId('today-primary-action'))
    await ritual.release(0, HttpResponse.json(mockRitualResponse))
    await waitFor(() =>
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toBeVisible()
    )
    await swapTrenchForLeatherJacket()

    // 08:30: the ritual rolled to tomorrow, so the swap made on today's goes.
    vi.setSystemTime(new Date('2026-07-22T15:30:00.000Z'))
    leaveAndReturn()
    await ritual.release(1, HttpResponse.json(mockRitualResponse))
    await waitFor(() =>
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toBeVisible()
    )
    expect(screen.queryByTestId('garment-tile-leather-jacket')).toBeNull()

    // A swap on tomorrow's ritual, then a read for another saved location: the swap goes.
    await swapTrenchForLeatherJacket()
    leaveAndReturn()
    await ritual.release(2, HttpResponse.json(otherLocationRitual))
    await waitFor(() =>
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toBeVisible()
    )
    expect(screen.queryByTestId('garment-tile-leather-jacket')).toBeNull()
  })
})
