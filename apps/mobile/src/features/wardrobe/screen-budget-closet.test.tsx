// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-NAT-002, 006, 010 (the native Wardrobe tab, the Closet,
// within the screen budget under the empty, populated and guardian-pending members). An empty
// Closet's chrome is measured to its Add block, the gold `garment-capture-open`, which sits
// above the empty title.
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import { screenBudget } from '@couture/utils'
import React from 'react'
import { configure, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), setParams: vi.fn() },
  // The tab route reads `entry` to open the capture sheet; the audit opens the plain tab.
  useLocalSearchParams: () => ({}),
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
}))
// AppTopBar (drawn by WithTopBar) imports the icon font, whose native module the browser lacks.
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
/** The empty Closet's Add block (spec D3, review #11): the gold Add above the empty title. */
const EMPTY_CLOSET_ADD = 'garment-capture-open'

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

/** The Closet as the tab layout draws it: under the Wardrobe top bar, inside the root providers. */
function renderCloset() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTopBar title={i18n.t('tabs.wardrobe')}>
            <WardrobeScreen />
          </WithTopBar>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * The CC-7.7 gate is open (inventory, onboarding and saved looks settled) and the Closet anchor
 * the measure reads is on screen: the garment grid for a member with garments, the empty state
 * otherwise.
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
  expect(screen.getByTestId('garment-capture-open')).toBeVisible()
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
  })

  for (const [id, fixture] of AUDITS) {
    it(`[P0] [${id}] native closet (${fixture}) is within the screen budget`, async () => {
      serveScreenBudgetFixture(fixture, MEMBER)
      renderCloset()
      await closetSettled(fixture)

      const measurement = await measureNativeScreen('closet')
      expectNativeMeasureFloors(measurement, 'closet')
      // The budget's own anchor, as rendered: the grid with garments, the Add block without.
      const anchors = renderedClosetAnchors()
      expect(anchors, 'one rendered native Closet anchor').toHaveLength(1)
      const anchor = anchors[0]!
      expect(measurement.closetChrome, 'Closet chrome: the rendered anchor top').toBe(
        pageTop(anchor)
      )
      if (fixture === 'populated') {
        expect(anchor).toBe(screen.getByTestId('wardrobe-garment-list'))
      } else {
        // The empty title sits below Add, so anchoring to it would let Add move down unseen.
        const add = screen.getByTestId(EMPTY_CLOSET_ADD)
        expect(anchor, 'the empty Closet anchor is its Add block').toBe(add)
        expect(pageTop(add)).toBeLessThan(
          pageTop(screen.getByTestId('wardrobe-empty-state'))
        )
      }
      expectNativeWithinBudget('closet', fixture, measurement)
    }, 30_000)
  }
})
