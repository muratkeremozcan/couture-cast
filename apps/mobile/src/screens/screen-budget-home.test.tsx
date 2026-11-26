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
// Story CC-7.11 test owner (TEA): 7.11-NAT-010 and 040 (Today's first content, the outfit card
// or the labeled sample, inside the 360 x 640 fold with no alert or setup before it, every
// fixture), under the same header the layout declares. D16 (spec Plan Change Log): with a city
// Today opens on the weather header and then the outfit card; the alert, the add prompt, the
// scenario toggles, the hourly ribbon and the Plan link all follow the first content.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
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
import { configure, render, screen, waitFor, within } from '@testing-library/react'
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

/**
 * D16: the blocks that follow Today's first content when they show. `required` are the ones the
 * fixture always draws, so the order check can never pass on an absent block.
 */
const AFTER_FIRST = [
  'weather-alert-banner',
  'home-add-garment-container',
  'scenario-toggles',
  'hourly-forecast-ribbon',
  'home-plan-week',
] as const

function expectTodayD16Order(
  first: HTMLElement,
  fixture: ScreenBudgetMode,
  required: readonly (typeof AFTER_FIRST)[number][]
) {
  const band = foldBand()
  const firstBox = first.getBoundingClientRect()
  if (hasSavedLocation(fixture)) {
    // The weather header leads, wholly inside the band, right above the outfit card.
    const header = screen.getByTestId('weather-header')
    expect(first.contains(header), 'the weather header sits outside the card').toBe(false)
    const box = header.getBoundingClientRect()
    expect(box.top, 'weather header below the top bar').toBeGreaterThanOrEqual(
      band.top - 1
    )
    expect(box.bottom, 'weather header inside the band').toBeLessThanOrEqual(
      band.bottom + 1
    )
    expect(box.bottom, 'weather header above the outfit card').toBeLessThanOrEqual(
      firstBox.top + 1
    )
  }
  for (const id of required) expect(screen.getByTestId(id), id).toBeVisible()
  for (const id of AFTER_FIRST) {
    for (const block of screen.queryAllByTestId(id)) {
      expect(first.contains(block), `${id} outside the first content`).toBe(false)
      expect(
        block.getBoundingClientRect().top,
        `${id} follows the first content (bottom ${firstBox.bottom})`
      ).toBeGreaterThanOrEqual(firstBox.bottom - 1)
    }
  }
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
async function todaySettled(fixture: ScreenBudgetMode) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  await waitFor(() =>
    expect(
      screen.getByTestId(
        fixture === 'populated' ? 'weather-header' : 'member-sample-outfit'
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
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native today (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderToday()
      await todaySettled(fixture)

      const measurement = await measureNativeScreen('today')
      expectNativeMeasureFloors(measurement, 'today')
      // The production header is drawn and its About control counts toward the fold.
      expect(screen.getByTestId(ABOUT)).toBeVisible()
      expect(
        measurement.targetsAboveFold.map((target) => target.key),
        'targets counted above the fold'
      ).toContain(ABOUT)
      expectNativeWithinBudget('today', fixture, measurement)
    }, 30_000)
  }

  for (const [id, fixture] of FOLD_CASES) {
    it(`[P0] [${id}] [D16] native today (${fixture}) opens on weather and its own content inside the 360 x 640 fold`, async () => {
      await setFoldViewport()
      serveScreenBudgetFixture(fixture, MEMBER)
      renderToday(WithFoldScene)
      await todaySettled(fixture)

      // The header reads Today (D1) from the layout's own options.
      expect(screen.getByTestId('app-top-bar')).toHaveTextContent(i18n.t('tabs.today'))
      const anchors = screen.getAllByTestId('today-first-content')
      expect(anchors, 'one Today first content').toHaveLength(1)
      const first = anchors[0]!
      await waitFor(() =>
        expect(
          within(first).getByTestId(
            hasSavedLocation(fixture)
              ? 'outfit-recommendation-card'
              : 'member-sample-outfit'
          )
        ).toBeVisible()
      )
      expectFirstContentInFold(first, 'Today first content')
      expect(chromeBefore(first), 'alerts or setup before Today').toEqual([])
      // D16: with a city, weather then the outfit; the ribbon, toggles and Plan link follow.
      expectTodayD16Order(
        first,
        fixture,
        hasSavedLocation(fixture)
          ? ['scenario-toggles', 'hourly-forecast-ribbon', 'home-plan-week']
          : ['home-plan-week']
      )
    }, 30_000)
  }

  it('[P0] [7.11-NAT-010] [D16] a weather alert follows the outfit card, so no alert comes before Today', async () => {
    await setFoldViewport()
    serveScreenBudgetFixture('populated', MEMBER)
    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({
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
        })
      )
    )
    renderToday(WithFoldScene)
    await todaySettled('populated')

    const first = screen.getByTestId('today-first-content')
    await waitFor(() =>
      expect(within(first).getByTestId('outfit-recommendation-card')).toBeVisible()
    )
    expectFirstContentInFold(first, 'Today first content')
    expect(chromeBefore(first), 'alerts or setup before Today').toEqual([])
    expectTodayD16Order(first, 'populated', [
      'weather-alert-banner',
      'scenario-toggles',
      'hourly-forecast-ribbon',
      'home-plan-week',
    ])
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
      // The header's About control is pressed too, and its effect is the route to /modal.
      expect(targets.map((target) => target.key)).toContain(ABOUT)
      // The link cancels its own anchor navigation, so the route is the router call, not a link.
      const about = results.find((result) => result.target.key === ABOUT)
      expect(about?.error).toBeUndefined()
      expect(about?.effects).toContain('outside call')
      expect(about?.effects.filter((effect) => effect.startsWith('link '))).toEqual([])
      expect(routerMock.push).toHaveBeenCalledWith('/modal')
      expectNativeWithinBudget('today', fixture, {
        analyticsOnly: nativeAnalyticsOnly(results),
        errors: nativeProbeErrors(results),
      })
    }, 180_000)
  }
})
