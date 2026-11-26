// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-003, 007, 011 (the native Community tab within the
// screen budget under the empty, populated and guardian-pending members). A member with no saved
// location gets production's `no_location` band notice and its Add location action, counted.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-010 and 040 (Community's first content inside the
// 360 x 640 fold with no alert or setup before it, every fixture). D16 (spec Plan Change Log):
// the first content is the City Spotlight when it shows looks, else the first feed card, else
// the empty state; the band notice follows it. The three fixtures take one branch each:
// populated has a city and its Spotlight, guardian-pending serves looks with no city, empty
// serves nothing. Community's own header counts as content until CC-7.15 calms it.
// New post is the top bar's trailing action (TabTopBar draws what the screen sets), and the
// climate explainer follows the first content.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { CommunitySyncState } from '@couture/api-client'
import type * as ReactNativeModule from 'react-native'
import React from 'react'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-router', async () => ({
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), setParams: vi.fn() },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), setParams: vi.fn() }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
  // Story CC-7.11 D16: New post goes into the tab top bar through setOptions (TabTopBar).
  useNavigation: (await import('../test-utils/tab-navigation-store.js')).useTabNavigation,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
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
import {
  WithFoldScene,
  chromeBefore,
  expectFirstContentInFold,
  setFoldViewport,
} from '@/src/test-utils/fold-band'
import { screenFocus } from '@/src/test-utils/focus-effect'
import {
  hasSavedLocation,
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'
import { TabTopBar, tabNavigation } from '@/src/test-utils/tab-navigation'
import {
  WithTabHeader,
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

/** D16: the block each fixture's first content must be. */
const FOLD_CASES: readonly (readonly [string, ScreenBudgetMode, string, string])[] = [
  ['7.11-NAT-010', 'empty', 'the empty state', 'community-feed-empty'],
  [
    '7.11-NAT-010',
    'populated',
    'its City Spotlight',
    'community-spotlight-item-budget-spot-1',
  ],
  [
    '7.11-NAT-040',
    'guardian-pending',
    'its first feed card',
    'community-post-card-budget-look-1',
  ],
]

/** The Community top bar as the navigator draws it, New post in its trailing slot (D16). */
const communityTopBar = () => (
  <TabTopBar title={i18n.t('tabs.community')} route="community" />
)

/** Community as the tab layout draws it: under the Community top bar, inside the root providers. */
function renderCommunity(fold = false) {
  const Frame = fold ? WithFoldScene : WithTabHeader
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <Frame header={communityTopBar()}>
            <CommunityRoute />
          </Frame>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open (first feed page and City Spotlight settled) and the feed it gates
 * has landed: the fixture's first look when the feed serves looks, the empty state otherwise,
 * and the unresolved band notice for a member with no saved location.
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
  if (!hasSavedLocation(fixture))
    await waitFor(() =>
      expect(screen.getByTestId('community-band-unresolved')).toBeVisible()
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
    tabNavigation.reset()
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native community (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCommunity()
      await communitySettled(fixture)

      const measurement = await measureNativeScreen('community')
      expectNativeMeasureFloors(measurement, 'community')
      // Production's no_location panel (community.service.ts) carries the guided Add location
      // action; a member with a city has neither.
      const notice = screen.queryByTestId('community-band-unresolved')
      if (hasSavedLocation(fixture)) {
        expect(notice).toBeNull()
      } else {
        expect(notice?.textContent).toBe(
          `${i18n.t('community.band.unresolved.no_location')}${i18n.t('locations.guided.add')}`
        )
        expect(within(notice!).getByTestId('community-add-location')).toBeVisible()
      }
      expectNativeWithinBudget('community', fixture, measurement)
    }, 30_000)
  }

  for (const [id, fixture, block, blockId] of FOLD_CASES) {
    it(`[P0] [${id}] [D16] native community (${fixture}) opens on ${block} inside the 360 x 640 fold`, async () => {
      await setFoldViewport()
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCommunity(true)
      await communitySettled(fixture)
      await waitFor(() => expect(screen.getByTestId(blockId)).toBeVisible())

      const anchors = screen.getAllByTestId('community-first-content')
      expect(anchors, 'one Community first content').toHaveLength(1)
      const first = anchors[0]!
      expect(within(first).getByTestId(blockId)).toBeVisible()
      if (fixture === 'populated') {
        // The Spotlight leads, so the first feed card below it is not the anchor.
        expect(first).not.toContainElement(
          screen.getByTestId('community-post-card-budget-look-1')
        )
      }
      expectFirstContentInFold(first, 'Community first content')
      expect(chromeBefore(first), 'alerts or setup before Community').toEqual([])
      // D16: New post is the top bar's trailing action, so no row above the first content
      // holds it.
      expect(
        within(screen.getByTestId('app-top-bar')).getByTestId('community-new-post-button')
      ).toBeVisible()
      // D16: the climate explainer follows the first content (Spotlight, first post or empty
      // state), outside it and below it.
      const explainers = screen.getAllByTestId('community-filters-explainer')
      expect(explainers, 'one climate explainer').toHaveLength(1)
      const explainer = explainers[0]!
      expect(explainer).toBeVisible()
      expect(first).not.toContainElement(explainer)
      expect(
        first.compareDocumentPosition(explainer) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the explainer follows the first content'
      ).toBeTruthy()
      expect(
        explainer.getBoundingClientRect().top,
        'the explainer sits below the first content'
      ).toBeGreaterThanOrEqual(first.getBoundingClientRect().bottom - 1)
      // D16: a member with no city reads the band notice after the first content.
      const notice = screen.queryByTestId('community-band-unresolved')
      if (hasSavedLocation(fixture)) {
        expect(notice).toBeNull()
      } else {
        expect(notice).toBeVisible()
        expect(first).not.toContainElement(notice)
        expect(
          first.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING,
          'the band notice follows the first content'
        ).toBeTruthy()
      }
    }, 30_000)
  }
})
