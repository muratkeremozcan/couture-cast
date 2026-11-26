// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-001, 005, 009 (native Today within the screen budget
// under the empty, populated and guardian-pending members) and 7.10-NAT-013..015 (no Today
// control whose only effect is analytics, pressed one by one in a fresh render).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import React from 'react'
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

vi.mock('expo-router', async () => ({
  router: routerMock,
  useLocalSearchParams: () => ({}),
  useRouter: () => routerMock,
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// AppTopBar (drawn by WithTopBar) imports the icon font, whose native module the browser lacks.
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
import TabOneScreen from '@/app/(tabs)/index'
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
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'
import {
  WithTopBar,
  expectNativeMeasureFloors,
  expectNativeWithinBudget,
  measureNativeScreen,
  nativeAnalyticsOnly,
  nativeProbeErrors,
  probeNativeScreen,
  setBudgetViewport,
} from '@/src/test-utils/screen-budget'

const MEMBER = 'budget-member'

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

/** Today as the tab layout draws it: under the Home top bar, inside the root providers. */
function renderToday() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTopBar title={i18n.t('tabs.home')}>
            <TabOneScreen />
          </WithTopBar>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open and the body it gates has landed: the outfit for a member with a city,
 * the labeled sample for one without. The Spotlight teaser reads on its own after the gate, so a
 * fixture that serves one waits for its image too; with `empty` the Spotlight serves no level and
 * the teaser renders nothing.
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
  if (fixture !== 'empty')
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
      })

      expect(targets.length, 'Today targets the probe pressed').toBeGreaterThan(0)
      expectNativeWithinBudget('today', fixture, {
        analyticsOnly: nativeAnalyticsOnly(results),
        errors: nativeProbeErrors(results),
      })
    }, 180_000)
  }
})
