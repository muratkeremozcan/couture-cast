// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-002, 006, 010 (the native Closet tab within the
// screen budget under the empty, populated and guardian-pending members).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-BUD-002 (no closet-chrome known entry remains, so the
// guard holds Closet chrome to its 160 px limit in every fixture), 7.11-NAT-010 and 040 (the
// Closet's first content inside the 360 x 640 fold, nothing before it, every fixture) and
// 7.11-NAT-011 (populated: four tiles in the band; empty: the empty state with Add; the top bar
// Add the one gold primary beside More). Add and More live in the tab top bar the hub fills
// through `navigation.setOptions` (D4), drawn here by `TabTopBar`.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { screenBudget } from '@couture/utils'
import React from 'react'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), setParams: vi.fn() },
  // The tab route reads `entry` to open the capture sheet; the audit opens the plain tab.
  useLocalSearchParams: () => ({}),
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
  // Story CC-7.11 D4: the hub puts Add and More in its tab top bar through setOptions.
  useNavigation: (await import('../../test-utils/tab-navigation-store.js'))
    .useTabNavigation,
}))
// AppTopBar (drawn by TabTopBar) imports the icon font, whose native module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))
// The capture and style piece modules reach native Expo modules; the audit never opens them.
vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))
vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      return []
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    readonly exists = false
    readonly size = 0
    textSync() {
      return ''
    }
    write() {
      return undefined
    }
    delete() {
      return undefined
    }
    bytes() {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]))
    }
  },
  Paths: { cache: 'file:///cache/', document: 'file:///documents' },
}))
vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

import WardrobeScreen from '@/app/(tabs)/wardrobe'
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
  textBefore,
} from '@/src/test-utils/fold-band'
import { screenFocus } from '@/src/test-utils/focus-effect'
import {
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'
import {
  WithTabHeader,
  expectNativeMeasureFloors,
  expectNativeWithinBudget,
  measureNativeScreen,
  setBudgetViewport,
} from '@/src/test-utils/screen-budget'
import { TabTopBar, tabNavigation } from '@/src/test-utils/tab-navigation'

const MEMBER = 'budget-member'
/** The top bar's Add (spec D4): the Closet's one gold primary. */
const ADD = 'garment-capture-open'

/** The checked-in native Closet anchors that render now, read at test time from the budget. */
const renderedClosetAnchors = () =>
  screenBudget.selectors.native.closetAnchors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector))
  )

/** An element's top in px from the top of the page, as the shared measure reads an anchor. */
const pageTop = (el: Element) =>
  Math.round(el.getBoundingClientRect().top + window.scrollY)

const AUDITS: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.10-NAT-002', 'empty'],
  ['7.10-NAT-006', 'populated'],
  ['7.10-NAT-010', 'guardian-pending'],
]

const FOLD_CASES: readonly (readonly [string, ScreenBudgetMode])[] = [
  ['7.11-NAT-010', 'empty'],
  ['7.11-NAT-010', 'populated'],
  ['7.11-NAT-040', 'guardian-pending'],
]

/** The Closet's tab top bar: the Closet title, and the Add and More the hub sets. */
const closetTopBar = () => <TabTopBar title={i18n.t('tabs.closet')} route="wardrobe" />

/** The Closet inside the root providers, under its tab header in `frame`. */
function renderCloset(
  Frame: React.ComponentType<{ header: React.ReactNode; children: React.ReactNode }>
) {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <Frame header={closetTopBar()}>
            <WardrobeScreen />
          </Frame>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open (inventory and saved looks settled) and the Closet anchor the measure
 * reads is on screen: the garment grid for a member with garments, the empty state otherwise.
 */
async function closetSettled(fixture: ScreenBudgetMode) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  expect(screen.queryByTestId('screen-placeholder')).toBeNull()
  if (fixture === 'populated') {
    await waitFor(() => expect(screen.getByTestId('wardrobe-garment-list')).toBeVisible())
    await waitFor(() =>
      expect(screen.getByTestId('garment-card-budget-garment-1')).toBeVisible()
    )
  } else {
    await waitFor(() => expect(screen.getByTestId('wardrobe-empty-state')).toBeVisible())
  }
  expect(screen.getByTestId(ADD)).toBeVisible()
}

describe('Screen budget: native Closet', () => {
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
    tabNavigation.reset()
  })

  it('[P0] [7.11-BUD-002] no closet-chrome known entry remains, so the 160 px limit holds Closet', () => {
    expect(
      screenBudget.known.filter((entry) => entry.rule === 'closet-chrome'),
      'closet-chrome known entries'
    ).toEqual([])
    expect(screenBudget.limits['closet-chrome']).toBe(160)
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] [7.11-BUD-002] native closet (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCloset(WithTabHeader)
      await closetSettled(fixture)

      const measurement = await measureNativeScreen('closet')
      expectNativeMeasureFloors(measurement, 'closet')
      // The budget's own anchor, as rendered: the grid with garments, the empty state without.
      const anchors = renderedClosetAnchors()
      expect(anchors, 'one rendered native Closet anchor').toHaveLength(1)
      const anchor = anchors[0]!
      expect(measurement.closetChrome, 'Closet chrome: the rendered anchor top').toBe(
        pageTop(anchor)
      )
      expect(anchor).toBe(
        screen.getByTestId(
          fixture === 'populated' ? 'wardrobe-garment-list' : 'wardrobe-empty-state'
        )
      )
      // D4: the setup card, the action row and the explainer left, so the closet starts right
      // under the top bar, and the gold Add sits in that bar above it.
      expect(measurement.closetChrome!).toBeLessThanOrEqual(
        screenBudget.limits['closet-chrome']
      )
      const add = screen.getByTestId(ADD)
      expect(screen.getByTestId('app-top-bar').contains(add)).toBe(true)
      expect(add.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        anchor.getBoundingClientRect().top
      )
      expect(measurement.primaryButtons.map((button) => button.key)).toEqual([ADD])
      expectNativeWithinBudget('closet', fixture, measurement)
    }, 30_000)
  }

  for (const [id, fixture] of FOLD_CASES) {
    it(`[P0] [${id}] [7.11-NAT-011] [Codex 7.11 #2] native closet (${fixture}) opens on its own content inside the 360 x 640 fold`, async () => {
      await setFoldViewport()
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCloset(WithFoldScene)
      await closetSettled(fixture)

      const anchor = screen.getByTestId(
        fixture === 'populated' ? 'closet-garment-grid' : 'wardrobe-empty-state'
      )
      expectFirstContentInFold(anchor, 'Closet first content')
      expect(chromeBefore(anchor), 'banners, alerts or setup before the closet').toEqual(
        []
      )
      const labelsStart =
        fixture === 'populated' ? screen.getByTestId('closet-category-filters') : anchor
      expect(textBefore(labelsStart), 'text before the Closet controls').toEqual([])
      if (fixture === 'populated') {
        expect(labelsStart.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          anchor.getBoundingClientRect().top + 1
        )
      }

      const bar = screen.getByTestId('app-top-bar')
      const add = screen.getByTestId(ADD)
      expect(bar.contains(add), 'Add in the top bar').toBe(true)
      expect(
        bar.contains(screen.getByTestId('closet-more-menu')),
        'More in the top bar'
      ).toBe(true)
      // D4: Add is the one gold primary; More and the empty state's Add stay neutral.
      const gold = getComputedStyle(add).backgroundColor
      const goldButtons = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="button"], button, [role="link"], a'
        )
      ).filter(
        (element) =>
          element.checkVisibility() && getComputedStyle(element).backgroundColor === gold
      )
      expect(goldButtons.map((element) => element.getAttribute('data-testid'))).toEqual([
        ADD,
      ])

      if (fixture === 'populated') {
        // P4, Codex 7.11 #2: all four first tiles sit wholly inside the band, each a tagged
        // piece with its photo and label. The card opens the garment detail.
        const band = foldBand()
        for (const index of [1, 2, 3, 4]) {
          const card = screen.getByTestId(`garment-card-budget-garment-${index}`)
          expect(card.querySelector('img'), `tile ${index} photo`).not.toBeNull()
          expect(within(card).getByTestId('garment-card-label')).toBeVisible()
          expect(within(card).queryByTestId(/^garment-status-/)).toBeNull()
          const open = screen.getByTestId(`garment-open-budget-garment-${index}`)
          expect(open).toBeVisible()
          expect(open.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
          const tile = card.getBoundingClientRect()
          expect(tile.top, `tile ${index} top`).toBeGreaterThanOrEqual(band.top - 1)
          expect(
            tile.bottom,
            `tile ${index} fully inside ${band.top}..${band.bottom}`
          ).toBeLessThanOrEqual(band.bottom + 1)
        }
      } else {
        // The empty state carries its own Add, inside the band, as AC2 asks.
        const emptyAdd = screen.getByTestId('wardrobe-empty-add')
        expect(anchor.contains(emptyAdd)).toBe(true)
        expectFirstContentInFold(emptyAdd, 'empty-state Add')
      }
    }, 30_000)
  }
})
