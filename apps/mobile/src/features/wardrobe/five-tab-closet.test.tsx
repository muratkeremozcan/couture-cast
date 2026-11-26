// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-012 (the Closet More sheet lists Closet setup and
// Silhouette; its X closes it and focus returns to More) and 7.11-NAT-023 (a garment pushed over
// the scrolled Closet and back leaves the Closet list at its offset: the tab stays mounted under
// the stack screen, D14). The Closet renders through its tab route under the tab top bar the hub
// fills (`TabTopBar`), with the CC-7.10 native fixtures.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import React from 'react'
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  router: routerMock,
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
import { WithFoldScene, setFoldViewport } from '@/src/test-utils/fold-band'
import { screenFocus } from '@/src/test-utils/focus-effect'
import {
  serveScreenBudgetFixture,
  type ScreenBudgetMode,
} from '@/src/test-utils/msw/screen-budget-fixtures'
import { press } from '@/src/test-utils/press'
import { TabTopBar, tabNavigation } from '@/src/test-utils/tab-navigation'

const MEMBER = 'five-tab-member'

/** The Closet tab on the smallest phone, under its top bar, inside the root providers. */
function renderCloset() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithFoldScene
            header={<TabTopBar title={i18n.t('tabs.closet')} route="wardrobe" />}
          >
            <WardrobeScreen />
          </WithFoldScene>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

async function closetSettled(fixture: ScreenBudgetMode) {
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  await waitFor(() =>
    expect(
      screen.getByTestId(
        fixture === 'populated' ? 'closet-garment-grid' : 'wardrobe-empty-state'
      )
    ).toBeVisible()
  )
  // react-native-web refreshes a Pressable's handlers in a passive effect (src/test-utils/press.ts).
  await act(() => Promise.resolve())
}

/** The element that scrolls `inner`: its nearest ancestor with more content than it shows. */
function scrollContainerOf(inner: HTMLElement): HTMLElement {
  for (let node = inner.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      node.scrollHeight > node.clientHeight
    )
      return node
  }
  throw new Error('no scroll container around the Closet grid')
}

/** Counts the inventory reads the Closet sends, at fetch (the app's one transport). */
function countInventoryReads() {
  const realFetch = globalThis.fetch
  const reads = { count: 0, restore: () => (globalThis.fetch = realFetch) }
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url, window.location.href).pathname.endsWith('/api/v1/wardrobe/garments'))
      reads.count += 1
    return realFetch(input, init)
  }
  return reads
}

describe('CC-7.11 native Closet More sheet and back to the Closet', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    await setFoldViewport()
    restoreToken = setMobileAccessTokenResolver(() => 'member-token')
    setMobileApplicationUserId(MEMBER)
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    screenFocus.reset()
    tabNavigation.reset()
    vi.clearAllMocks()
  })

  it('[P1] [7.11-NAT-012] More opens a sheet with Closet setup and Silhouette; X closes it and focus returns to More', async () => {
    serveScreenBudgetFixture('empty', MEMBER)
    renderCloset()
    await closetSettled('empty')

    const more = within(screen.getByTestId('app-top-bar')).getByTestId('closet-more-menu')
    expect(more).toHaveTextContent(i18n.t('wardrobe.menu.more'))
    expect(screen.queryByTestId('closet-more-sheet')).toBeNull()
    press(more)

    const sheet = await screen.findByTestId('closet-more-sheet')
    await waitFor(() => expect(sheet).toBeVisible())
    expect(within(sheet).getByRole('heading')).toHaveTextContent(
      i18n.t('wardrobe.menu.label')
    )
    expect(within(sheet).getByTestId('closet-more-setup')).toHaveTextContent(
      i18n.t('wardrobe.menu.setup')
    )
    expect(within(sheet).getByTestId('closet-more-silhouette')).toHaveTextContent(
      i18n.t('wardrobe.menu.silhouette')
    )
    // D13: the sheet's header is its swipe-down handle.
    expect(within(sheet).getByTestId('layer-swipe-handle')).toContainElement(
      within(sheet).getByTestId('closet-more-close')
    )

    const close = within(sheet).getByTestId('closet-more-close')
    expect(close).toHaveAccessibleName(i18n.t('wardrobe.menu.close'))
    press(close)

    await waitFor(() => expect(screen.queryByTestId('closet-more-sheet')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(more))
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('[P1] [7.11-NAT-023] a garment pushed over the scrolled Closet and back leaves the list at its offset', async () => {
    serveScreenBudgetFixture('populated', MEMBER)
    renderCloset()
    await closetSettled('populated')

    const grid = screen.getByTestId('closet-garment-grid')
    const scroller = scrollContainerOf(grid)
    act(() => {
      scroller.scrollTop = 600
      scroller.dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => expect(scroller.scrollTop).toBe(600))

    // Open the first garment card now on screen: the detail is a root stack screen pushed over
    // the tab, which stays mounted and only blurs.
    const visibleCard = Array.from(
      grid.querySelectorAll<HTMLElement>('[data-testid^="garment-open-"]')
    ).find(
      (card) => card.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
    )
    expect(visibleCard, 'a garment card in view after the scroll').toBeDefined()
    const garmentId = visibleCard!
      .getAttribute('data-testid')!
      .replace('garment-open-', '')
    fireEvent.click(visibleCard!)
    expect(routerMock.push).toHaveBeenCalledExactlyOnceWith({
      pathname: '/wardrobe-garment',
      params: { id: garmentId },
    })

    const reads = countInventoryReads()
    try {
      act(() => screenFocus.set(false))
      // Back pops the detail: the Closet regains focus and reads its inventory again in place.
      act(() => screenFocus.set(true))
      await waitFor(() => expect(reads.count).toBe(1))
      await waitFor(() =>
        expect(screen.getByTestId(`garment-card-${garmentId}`)).toBeVisible()
      )
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    } finally {
      reads.restore()
    }

    // Same mounted list (no remount, no placeholder) at the same offset.
    expect(scroller.isConnected).toBe(true)
    expect(scrollContainerOf(screen.getByTestId('closet-garment-grid'))).toBe(scroller)
    expect(screen.queryByTestId('screen-placeholder')).toBeNull()
    expect(scroller.scrollTop).toBe(600)
  })
})
