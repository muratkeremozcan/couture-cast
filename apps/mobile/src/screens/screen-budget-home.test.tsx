// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-001, 005, 009 (native Today within the screen budget
// under the empty, populated and guardian-pending members) and 7.10-NAT-013..015 (no Today
// control whose only effect is analytics, pressed one by one in a fresh render). Today is drawn
// under the header app/(tabs)/_layout.tsx declares for Home, About button included, read from
// the layout itself through a `Tabs` double.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
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
import { configure, render, screen, waitFor } from '@testing-library/react'
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

/** Today as the tab layout draws it: under the Home tab header, inside the root providers. */
function renderToday() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTabHeader header={tabHeader(tabLayout, 'index')}>
            <TabOneScreen />
          </WithTabHeader>
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
