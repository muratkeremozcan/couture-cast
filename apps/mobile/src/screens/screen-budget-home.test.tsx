// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-001, 005, 009 (native Today within the screen budget
// under the empty, populated and guardian-pending members) and 7.10-NAT-013..015 (no Today
// control whose only effect is analytics, pressed one by one in a fresh render). Today is drawn
// under the header app/(tabs)/_layout.tsx declares for Home, About button included, read from
// the layout itself through a `Tabs` double.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11: Today opens inside the 360 x 640 fold with no setup above the outfit.
// Learning path Step 70: Calm Today with one primary job.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-70-calm-today-with-one-primary-job
// Test design: _bmad-output/test-artifacts/test-design-7-13-calm-today-one-primary-job.md.
// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import {
  type CapturedTabLayout,
  WithTabHeader,
  expectNativeMeasureFloors,
  expectNativeWithinBudget,
  measureNativeScreen,
  nativeAnalyticsOnly,
  nativeProbeErrors,
  probeNativeScreen,
  setBudgetViewport,
  tabHeader,
} from '@/src/test-utils/screen-budget'
import React, { type ReactElement, type ReactNode } from 'react'
import { act, configure, render, screen, waitFor, within } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

// One router double for both `useRouter()` and the `router` singleton, so every navigation a
// press makes (the teaser, the sample's Add and city actions) lands in one count.
const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
}))
const webBrowser = vi.hoisted(() => ({ openBrowserAsync: vi.fn() }))
// What the tab layout hands its navigator, so Today's header is the one the layout declares.
const tabLayout = vi.hoisted(
  (): CapturedTabLayout => ({ screenOptions: {}, screens: new Map() })
)

vi.mock('expo-router', async () => {
  const { cloneElement } = await import('react')
  const Tabs = ({
    screenOptions,
    children,
  }: {
    screenOptions: Record<string, unknown>
    children?: ReactNode
  }) => {
    tabLayout.screenOptions = screenOptions
    return children
  }
  Tabs.Screen = (props: { name: string; options?: Record<string, unknown> }) => {
    tabLayout.screens.set(props.name, props)
    return null
  }
  return {
    Tabs,
    // expo-router's web Link with `asChild`: the child gets the href and the link role, and its
    // press cancels the anchor's own navigation and routes in-app (here: the router double).
    Link: ({ href, children }: { href: string; children: ReactElement }) =>
      cloneElement(children as ReactElement<Record<string, unknown>>, {
        href,
        role: 'link',
        onPress: (event?: { preventDefault?: () => void }) => {
          event?.preventDefault?.()
          routerMock.push(href)
        },
      }),
    router: routerMock,
    useLocalSearchParams: () => ({}),
    useRouter: () => routerMock,
    useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
  }
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// AppTopBar and the tab layout import the icon font, whose native module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
// The shop link opens the in-app browser: recorded as an outside call, never opened.
vi.mock('expo-web-browser', () => webBrowser)
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)
// No device cache: every render (each probe press included) reads the fixture's ritual afresh.
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    withoutShopThisLook: actual.withoutShopThisLook,
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: () => Promise.resolve(null),
    saveRitualCache: () => Promise.resolve(undefined),
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: () => Promise.resolve(undefined),
  }
})

import { Linking } from 'react-native'
import TabLayout from '@/app/(tabs)/_layout'
import TabOneScreen from '@/app/(tabs)/index'
import { screenBudget } from '@couture/utils'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AppThemeProvider } from '@/src/theme/theme-context'
import {
  WithFoldScene,
  chromeBefore,
  expectFirstContentInFold,
  foldBand,
  setFoldViewport,
} from '@/src/test-utils/fold-band'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { server } from '@/src/test-utils/msw/server'
import { http, HttpResponse } from 'msw'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { press } from '@/src/test-utils/press'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import {
  hasSavedLocation,
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'

const MEMBER = 'budget-member'
/** Home's trailing header control (app/(tabs)/_layout.tsx): the About link to /modal. */
const ABOUT = 'header-info-modal'

const AUDITS: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.10-NAT-001', 'empty'],
  ['7.10-NAT-005', 'populated'],
  ['7.10-NAT-009', 'guardian-pending'],
]
const PROBES: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.10-NAT-013', 'empty'],
  ['7.10-NAT-014', 'populated'],
  ['7.10-NAT-015', 'guardian-pending'],
]

/** Reads the navigator options and each tab's options off the production tab layout. */
function captureTabLayout() {
  tabLayout.screens.clear()
  render(
    <AppThemeProvider>
      <TabLayout />
    </AppThemeProvider>
  ).unmount()
  if (!tabLayout.screens.has('index'))
    throw new Error('the tab layout declared no Home tab')
}

const FOLD_CASES: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.11-NAT-010', 'empty'],
  ['7.11-NAT-010', 'populated'],
  ['7.11-NAT-040', 'guardian-pending'],
]

function expectBelow(upper: HTMLElement, lower: HTMLElement) {
  expect(
    lower.getBoundingClientRect().top,
    `${lower.dataset.testid} follows ${upper.dataset.testid}`
  ).toBeGreaterThanOrEqual(upper.getBoundingClientRect().bottom - 1)
}

function serveTodayForecast(differs: boolean, usableOutfitCount = 3) {
  const firstHour = Date.parse('2026-07-25T07:00:00.000Z')
  vi.setSystemTime(new Date(firstHour + 9 * 3_600_000))
  const basis = mockRitualResponse.data.weather.hourly[0]!
  server.use(
    http.get('*/api/v1/ritual', () =>
      HttpResponse.json({
        data: {
          ...mockRitualResponse.data,
          outfits: mockRitualResponse.data.outfits.map((outfit, index) =>
            index < usableOutfitCount
              ? outfit
              : { ...outfit, garmentIds: [], displayGarments: [] }
          ),
          weather: {
            ...mockRitualResponse.data.weather,
            fetchedAt: new Date(firstHour).toISOString(),
            hourly: Array.from({ length: 48 }, (_, hour) => {
              const localHour = hour % 24
              const temperature = differs
                ? localHour < 11
                  ? 11
                  : localHour < 17
                    ? 25
                    : 16
                : 21
              return {
                ...basis,
                forecastAt: new Date(firstHour + hour * 3_600_000).toISOString(),
                temperature,
                feelsLike: temperature,
              }
            }),
          },
        },
      })
    )
  )
}

/** Today as the tab layout draws it: under the Home tab header, inside the root providers. */
function renderToday(Frame: typeof WithTabHeader | typeof WithFoldScene = WithTabHeader) {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <Frame header={tabHeader(tabLayout, 'index')}>
            <TabOneScreen />
          </Frame>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open and the body it gates has landed: the outfit for a member with a city,
 * the labeled sample for one without. The Spotlight teaser reads on its own after the gate, so a
 * member with a saved location waits for its image too; without one the Spotlight serves no
 * level, as production does, and the teaser renders nothing.
 */
async function todaySettled(
  fixture: ScreenBudgetMode,
  hasForecast = hasSavedLocation(fixture)
) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  await waitFor(() =>
    expect(
      screen.getByTestId(hasForecast ? 'today-primary-action' : 'home-set-city')
    ).toBeVisible()
  )
  await waitFor(() =>
    expect(
      screen.getByTestId(
        hasSavedLocation(fixture) ? 'home-closet-strip' : 'home-add-garment'
      )
    ).toBeVisible()
  )
  if (hasSavedLocation(fixture))
    await waitFor(() =>
      expect(screen.getByTestId('home-spotlight-teaser-image-loaded')).toBeTruthy()
    )
}

describe('Screen budget: native Today', () => {
  let restoreToken: (() => void) | undefined
  let openUrl: MockInstance<typeof Linking.openURL>

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
    await i18n.changeLanguage('en-US')
    captureTabLayout()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    await setBudgetViewport()
    restoreToken = setMobileAccessTokenResolver(() => 'member-token')
    setMobileApplicationUserId(MEMBER)
    // A press that opens a URL is an effect; the page itself never navigates away.
    openUrl = vi.spyOn(Linking, 'openURL').mockResolvedValue(true)
    webBrowser.openBrowserAsync.mockResolvedValue({ type: 'cancel' })
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    screenFocus.reset()
    vi.useRealTimers()
  })

  it.each(['loaded', 'failed'] as const)(
    '[P0] [7.14-PIC-001/004/005] native reserves the outfit when an image is %s',
    async (outcome) => {
      await setFoldViewport()
      serveScreenBudgetFixture('populated', MEMBER)
      const url = `${window.location.origin}/__today-test/private-top-${outcome}.png`
      let release = () => undefined as void
      const imageGate = new Promise<void>((resolve) => {
        release = resolve
      })
      let requested = false
      const photo = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        ),
        (byte) => byte.charCodeAt(0)
      )
      server.use(
        http.get(url, async () => {
          requested = true
          await imageGate
          if (outcome === 'failed') return HttpResponse.error()
          return HttpResponse.arrayBuffer(photo.buffer, {
            headers: { 'content-type': 'image/png' },
          })
        }),
        http.get('*/api/v1/ritual', () =>
          HttpResponse.json({
            data: {
              ...mockRitualResponse.data,
              outfits: mockRitualResponse.data.outfits.map((outfit) => ({
                ...outfit,
                garmentIds: ['member-top', 'default-bottom', 'default-shoes'],
                displayGarments: [
                  {
                    id: 'member-top',
                    category: 'top',
                    imageAccess: {
                      url,
                      expiresAt: new Date(Date.now() + 900_000).toISOString(),
                    },
                  },
                ],
              })),
            },
          })
        )
      )

      const bounds = (elements: HTMLElement[]) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height }
        })
      let before: ReturnType<typeof bounds>
      let tracked: HTMLElement[]
      try {
        renderToday(WithFoldScene)
        await todaySettled('populated')
        const picture = await screen.findByTestId('today-outfit-picture')
        const slots = within(picture).getAllByRole('button')
        expect(slots).toHaveLength(3)
        await waitFor(() => expect(requested).toBe(true))
        expect(screen.getByTestId('today-outfit-catalog-0')).toBeVisible()
        expect(screen.getByTestId('today-outfit-catalog-1')).toBeVisible()
        expect(screen.getByTestId('today-outfit-catalog-2')).toBeVisible()
        const slotBounds = bounds(slots)
        for (const { width, height } of slotBounds) {
          expect(width).toBeGreaterThanOrEqual(44)
          expect(height).toBeGreaterThanOrEqual(44)
        }
        const [first, second, third] = slotBounds
        expect(second!.x - (first!.x + first!.width)).toBeGreaterThanOrEqual(8)
        expect(third!.x - (second!.x + second!.width)).toBeGreaterThanOrEqual(8)
        tracked = [picture, ...slots, screen.getByTestId('today-primary-action')]
        before = bounds(tracked)
        expect((await measureNativeScreen('today')).stats.tileTargets).toBe(3)
      } finally {
        release()
      }
      if (outcome === 'loaded') {
        expect(await screen.findByTestId('today-outfit-photo-0')).toBeVisible()
        expect(screen.queryByTestId('today-outfit-catalog-0')).toBeNull()
      } else {
        await waitFor(() =>
          expect(
            screen.getByTestId('today-outfit-slot-0').querySelector('img')
          ).toBeNull()
        )
        expect(screen.getByTestId('today-outfit-catalog-0')).toBeVisible()
      }
      expect(bounds(tracked)).toEqual(before)
    },
    30_000
  )

  it.each(['view', 'undo'] as const)(
    '[7.14-PIC-002/005] a guardian-pending member wears a catalog outfit, retries safely and can %s the save',
    async (action) => {
      serveScreenBudgetFixture('guardian-pending', MEMBER)
      const { store, handlers } = createSavedLooksMswHandlers()
      const keys: (string | null)[] = []
      store.onPost = (request) => {
        keys.push(request.headers.get('idempotency-key'))
      }
      store.nextPostError = () =>
        keys.length === 1
          ? HttpResponse.json(
              { message: 'Save temporarily unavailable' },
              { status: 503 }
            )
          : null
      server.use(
        ...handlers,
        http.get('*/api/v1/wardrobe/garments', () =>
          HttpResponse.json({
            data: (['top', 'bottom', 'shoes'] as const).map((category) =>
              createReadyGarmentFixture({
                id: `pending-${category}`,
                category,
                imageAccess: null,
              })
            ),
          })
        ),
        http.get('*/api/v1/ritual', () =>
          HttpResponse.json({
            data: {
              ...mockRitualResponse.data,
              outfits: mockRitualResponse.data.outfits.map((outfit) => ({
                ...outfit,
                garmentIds: ['default-top', 'default-shoes'],
                displayGarments: [],
                recommendationActionsAvailable: false,
              })),
            },
          })
        )
      )
      renderToday()
      expect(await screen.findByTestId('today-outfit-catalog-0')).toBeVisible()
      expect(screen.getByTestId('today-outfit-catalog-1')).toBeVisible()
      expect(screen.getByTestId('today-outfit-picture').querySelector('img')).toBeNull()
      press(screen.getByTestId('today-outfit-details'))
      expect(screen.getByTestId('outfit-comfort-notes')).toBeVisible()
      expect(screen.queryByTestId('shop-this-look-block')).toBeNull()
      expect(screen.queryByTestId('outfit-share-card-open')).toBeNull()
      press(screen.getByTestId('today-outfit-details'))

      press(screen.getByTestId('today-primary-action'))
      press(await screen.findByTestId('status-bar-action-retry'))
      const feedbackAction = await screen.findByTestId(`status-bar-action-${action}`)
      expect(keys).toHaveLength(2)
      expect(keys[0]).toBeTruthy()
      expect(keys[1]).toBe(keys[0])
      expect(store.items).toHaveLength(1)
      const look = store.items[0]!
      expect(look.wornOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(look.composition.map(({ category, kind }) => [category, kind])).toEqual([
        ['top', 'catalog'],
        ['shoes', 'catalog'],
      ])
      routerMock.push.mockClear()
      press(feedbackAction)
      if (action === 'view') {
        expect(routerMock.push).toHaveBeenCalledExactlyOnceWith({
          pathname: '/saved-look/[savedLookId]',
          params: { savedLookId: look.id },
        })
      } else {
        await waitFor(() => expect(store.items).toHaveLength(0))
      }
    },
    30_000
  )

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native today (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderToday()
      await todaySettled(fixture)

      const measurement = await measureNativeScreen('today')
      expectNativeMeasureFloors(measurement, 'today')
      expect(screen.queryByTestId(ABOUT)).toBeNull()
      expect(measurement.targetsAboveFold.map((target) => target.key)).not.toContain(
        ABOUT
      )
      expect(measurement.todayHeight).toBeLessThanOrEqual(1688)
      expectNativeWithinBudget('today', fixture, measurement)
    }, 30_000)
  }

  for (const [id, fixture] of FOLD_CASES) {
    it(`[P0] [${id}] [7.13-NAT-001] ${fixture}: Today opens on its outfit at 360 x 640`, async () => {
      await setFoldViewport()
      serveScreenBudgetFixture(fixture, MEMBER)
      renderToday(WithFoldScene)
      await todaySettled(fixture)

      expect(screen.getByTestId('app-top-bar')).toHaveTextContent(i18n.t('tabs.today'))
      const first = screen.getByTestId('today-first-content')
      const located = hasSavedLocation(fixture)
      const card = within(first).getByTestId(
        located ? 'outfit-recommendation-card' : 'member-sample-outfit'
      )
      expect(card).toBeVisible()
      expectFirstContentInFold(first, 'Today first content')
      expect(chromeBefore(first), 'alerts or setup before Today').toEqual([])
      const action = screen.getByTestId(
        located ? 'today-primary-action' : 'home-set-city'
      )
      expect(action).toBeVisible()
      expect(action.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        foldBand().bottom + 1
      )
      expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
      expect(screen.queryByTestId('hourly-forecast-ribbon')).toBeNull()

      if (located) {
        expectBelow(screen.getByTestId('weather-header'), first)
      } else {
        expect(within(card).getByTestId('member-sample-label')).toHaveTextContent(
          'Sample look'
        )
      }
      const closet = screen.getByTestId(
        located ? 'home-closet-strip' : 'home-add-garment'
      )
      const plan = screen.getByTestId('home-plan-week')
      expectBelow(first, closet)
      expectBelow(closet, plan)
      if (located) expectBelow(plan, screen.getByTestId('home-spotlight-teaser-link'))
      else expect(screen.queryByTestId('home-spotlight-teaser-link')).toBeNull()
    }, 30_000)
  }

  it('[P0] [7.13-NAT-001/003] a failed forecast with a saved city offers the sample and Locations within the height budget', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({ message: 'Unavailable' }, { status: 503 })
      )
    )
    renderToday()
    await todaySettled('populated', false)

    expect(screen.getByTestId('member-sample-label')).toHaveTextContent('Sample look')
    expect(screen.queryByTestId('today-primary-action')).toBeNull()
    expect(screen.getByTestId('home-closet-strip')).toBeVisible()
    const measurement = await measureNativeScreen('today')
    expectNativeMeasureFloors(measurement, 'today')
    expect(measurement.todayHeight).toBeLessThanOrEqual(1688)
    press(screen.getByTestId('home-set-city'))
    expect(routerMock.push).toHaveBeenCalledWith('/locations?guided=1')
  }, 30_000)

  it('[P0] [7.13-NAT-001/002] identical periods hide the selector and the weather line toggles the hourly ribbon', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    serveTodayForecast(false)
    renderToday()
    await todaySettled('populated')

    const weather = screen.getByTestId('weather-header')
    const details = screen.getByTestId('today-outfit-details')
    press(details)
    expect(screen.queryByTestId('scenario-toggles')).toBeNull()
    press(details)
    expect(weather).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('hourly-forecast-ribbon')).toBeNull()
    press(weather)
    expect(weather).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('hourly-forecast-ribbon')).toBeVisible()
    press(weather)
    expect(weather).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('hourly-forecast-ribbon')).toBeNull()
  }, 30_000)

  it('[P0] [7.13-NAT-002] differing periods show one selector and changing period picks that outfit', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    serveTodayForecast(true)
    renderToday()
    await todaySettled('populated')

    expect(screen.queryByTestId('scenario-toggles')).toBeNull()
    press(screen.getByTestId('today-outfit-details'))
    const periods = screen.getByTestId('scenario-toggles')
    const picker = within(periods).getByTestId('scenario-picker')
    expect(picker).toHaveAttribute('aria-expanded', 'false')
    expect(within(periods).queryByRole('tablist')).toBeNull()
    press(picker)
    expect(within(periods).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByTestId('outfit-comfort-notes').textContent).toMatch(/trench coat/i)
    press(within(periods).getByTestId('scenario-toggle-midday'))
    expect(within(periods).getByTestId('scenario-toggle-midday')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByTestId('outfit-comfort-notes').textContent).toMatch(/light tee/i)
    expect(picker).toHaveAttribute('aria-expanded', 'true')
    press(picker)
    expect(within(periods).queryByRole('tablist')).toBeNull()
  }, 30_000)

  it('[P0] [7.13-NAT-002] varying weather does not offer a period selector with one outfit', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    serveTodayForecast(true, 1)
    renderToday()
    await todaySettled('populated')
    press(screen.getByTestId('today-outfit-details'))
    expect(screen.queryByTestId('scenario-toggles')).toBeNull()
    expect(screen.getByTestId('today-primary-action')).toBeVisible()
  }, 30_000)

  it('[P0] [7.13-NAT-004] a wardrobe change removes old categories until the current closet is verified', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    renderToday()
    await todaySettled('populated')
    const recent = screen.getByTestId('home-closet-strip')
    expect(recent).toHaveAccessibleName('Recent pieces. Top, Bottom, and Outer layer')
    expect(recent.querySelectorAll('img')).toHaveLength(0)

    let markRequested: () => void = () => undefined
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve
    })
    let releaseGarments: () => void = () => undefined
    const heldGarments = new Promise<void>((resolve) => {
      releaseGarments = resolve
    })
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        markRequested()
        await heldGarments
        return HttpResponse.json({ data: [] })
      })
    )
    try {
      act(() => notifyWardrobeChanged())
      await requested
      expect(screen.queryByTestId('home-closet-strip')).toBeNull()
      expect(screen.queryByTestId('home-add-garment')).toBeNull()
    } finally {
      releaseGarments()
    }
    expect(await screen.findByTestId('home-add-garment')).toHaveAccessibleName(
      'Add a piece'
    )
  }, 30_000)

  for (const [id, fixture] of PROBES) {
    it(`[P0] [${id}] native today (${fixture}): no control whose only effect is analytics`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      const outsideCalls = () =>
        Object.values(routerMock).reduce((total, fn) => total + fn.mock.calls.length, 0) +
        openUrl.mock.calls.length +
        webBrowser.openBrowserAsync.mock.calls.length

      const { targets, results } = await probeNativeScreen({
        mount: async () => {
          const view = renderToday()
          await todaySettled(fixture)
          return view.unmount
        },
        outsideCalls,
        exclusiveGroups: screenBudget.exclusiveGroupSelectors.native,
      })

      expect(targets.length, 'Today targets the probe pressed').toBeGreaterThan(0)
      expect(targets.map((target) => target.key)).not.toContain(ABOUT)
      expectNativeWithinBudget('today', fixture, {
        analyticsOnly: nativeAnalyticsOnly(results),
        errors: nativeProbeErrors(results),
      })
    }, 180_000)
  }
})
