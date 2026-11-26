// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-003, 007, 011 (the native Community tab within the
// screen budget under the empty, populated and guardian-pending members).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import { CommunitySyncState } from '@couture/api-client'
import type * as ReactNativeModule from 'react-native'
import React from 'react'
import { configure, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-router', async () => ({
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), setParams: vi.fn() },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), setParams: vi.fn() }),
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
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: () => true,
}))
// Native Expo modules the screen and its cards load (some lazily); the audit presses nothing.
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn().mockResolvedValue(undefined) }))
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }))
vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))
vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    }
    write() {
      return undefined
    }
  },
  Paths: { cache: 'file:///cache/' },
}))
vi.mock('expo-file-system/legacy', async () => {
  const { nativeStorageMocks } = await import('../test-utils/persisted-writes.js')
  return nativeStorageMocks.legacyFileSystem
})
vi.mock('expo-secure-store', async () => {
  const { nativeStorageMocks } = await import('../test-utils/persisted-writes.js')
  return nativeStorageMocks.secureStore
})
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))
// As in community-screen.test.tsx: react-native-web throws from findNodeHandle and has no
// accessibility focus, and the screen's deep-link listener needs a subscription to remove.
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Linking: { ...actual.Linking, addEventListener: () => ({ remove: vi.fn() }) },
  }
})

import CommunityRoute from '@/app/(tabs)/community'
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
  ['7.10-NAT-003', 'empty'],
  ['7.10-NAT-007', 'populated'],
  ['7.10-NAT-011', 'guardian-pending'],
]

/** Community as the tab layout draws it: under the Community top bar, inside the root providers. */
function renderCommunity() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTopBar title={i18n.t('tabs.community')}>
            <CommunityRoute />
          </WithTopBar>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open (first feed page and City Spotlight settled) and the feed it gates
 * has landed: the fixture's first look when the feed serves looks, the empty state otherwise.
 */
async function communitySettled(fixture: ScreenBudgetMode) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  await waitFor(() =>
    expect(
      screen.getByTestId(
        fixture === 'empty' ? 'community-feed-empty' : 'community-post-card-budget-look-1'
      )
    ).toBeVisible()
  )
}

describe('Screen budget: native Community', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    await setBudgetViewport()
    // No realtime socket: the audit measures the feed as its REST reads leave it.
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
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
    it(`[P0] [${id}] native community (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCommunity()
      await communitySettled(fixture)

      const measurement = await measureNativeScreen('community')
      expectNativeMeasureFloors(measurement, 'community')
      expectNativeWithinBudget('community', fixture, measurement)
    }, 30_000)
  }
})
