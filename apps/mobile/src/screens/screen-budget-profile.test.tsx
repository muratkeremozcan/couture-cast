// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-004, 008, 012 (the native Profile tab within the
// screen budget under the empty, populated and guardian-pending members).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
//
// The libraries stay real and answer through MSW (the fixture serves the profile, subscription,
// premium access and palette; the default handlers serve health and the shopping preference).
// RevenueCat needs no double: on web `ensurePurchasesConfigured` answers `unavailable`, which is
// the Premium section's Expo Go state.
import React from 'react'
import { configure, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// As every suite that renders Settings: expo-router pulls in expo-asset, which this browser
// bundle cannot evaluate.
vi.mock('expo-router', async () => ({
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), setParams: vi.fn() },
  // Story CC-7.7 D5: Profile re-reads its sections when the tab regains focus.
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// AppTopBar (drawn by WithTopBar) imports the icon font, whose native module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)

import SettingsScreen from '../../app/(tabs)/settings'
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
  setBudgetViewport,
} from '@/src/test-utils/screen-budget'

const MEMBER = 'budget-member'

const AUDITS: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.10-NAT-004', 'empty'],
  ['7.10-NAT-008', 'populated'],
  ['7.10-NAT-012', 'guardian-pending'],
]

/** Profile as the tab layout draws it: under the Profile top bar, inside the root providers. */
function renderProfile() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTopBar title={i18n.t('tabs.profile')}>
            <SettingsScreen />
          </WithTopBar>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open: the account header, shopping preference, subscription with its store
 * availability and the palette read all settled (`profileGateSettled`), so every section the
 * measure counts is on screen together.
 */
async function profileSettled() {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  await waitFor(() => expect(screen.getByTestId('profile-account')).toBeVisible())
  expect(screen.getByTestId('premium-settings-section')).toBeVisible()
}

describe('Screen budget: native Profile', () => {
  let restoreToken: (() => void) | undefined

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
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    screenFocus.reset()
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native profile (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderProfile()
      await profileSettled()

      const measurement = await measureNativeScreen('profile')
      expectNativeMeasureFloors(measurement, 'profile')
      expectNativeWithinBudget('profile', fixture, measurement)
    }, 30_000)
  }
})
