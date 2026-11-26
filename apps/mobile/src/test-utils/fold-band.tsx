// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the native fold of AC2 for 7.11-NAT-010, 011 and 040, shared by
// the screen-budget-*.test.tsx suites. P4 (spec Plan Change Log): the smallest supported phone
// stays 360 x 640 dp (CC-7.9 D11), and the band a member sees without scrolling runs from the
// bottom of the 56 pt top bar to the top of the tab bar. The suites render no tab navigator, so
// `WithFoldScene` stands a 56 pt bar in for it below the scene, where the navigator draws its own.
// The rules match the web probe (playwright/support/helpers/five-tab.ts): a short first content
// sits wholly in the band, a tall one (the outfit card, a feed card) shows its first 120 px.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { shell } from '@couture/utils'
import { DefaultTheme, ThemeProvider } from '@react-navigation/native'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { expect } from 'vitest'
import { setViewport } from './viewport'

/** P4: the smallest supported phone, in dp (CSS px under react-native-web). */
export const NATIVE_FOLD_VIEWPORT = { width: 360, height: 640 } as const

/** How much of a tall first content must show inside the band (as on web). */
const TALL_CONTENT_VISIBLE_PX = 120

export function setFoldViewport() {
  return setViewport(NATIVE_FOLD_VIEWPORT.width, NATIVE_FOLD_VIEWPORT.height)
}

/**
 * A tab scene on the smallest phone: the tab's header and screen in the height the navigator
 * leaves above its tab bar, then a stand-in tab bar of the shell's height.
 */
export function WithFoldScene({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    // The navigation themes type as `error` under the lint program, as in app/_layout.tsx.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    <ThemeProvider value={DefaultTheme}>
      <View style={{ height: NATIVE_FOLD_VIEWPORT.height }}>
        <View style={{ flex: 1 }}>
          {header}
          <View style={{ flex: 1 }}>{children}</View>
        </View>
        <View testID="fold-tab-bar" style={{ height: shell.tabBarHeight }} />
      </View>
    </ThemeProvider>
  )
}

function topBar(): HTMLElement {
  const bars = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="app-top-bar"]')
  ).filter((bar) => bar.checkVisibility())
  expect(bars, 'one visible top bar').toHaveLength(1)
  return bars[0]!
}

/** P4: from the bottom of the top bar to the top of the tab bar, in page px at scroll 0. */
export function foldBand() {
  const tabBar = document.querySelector('[data-testid="fold-tab-bar"]')
  expect(tabBar, 'the stand-in tab bar').not.toBeNull()
  const band = {
    top: topBar().getBoundingClientRect().bottom,
    bottom: tabBar!.getBoundingClientRect().top,
  }
  // The band is the phone minus the two 56 pt bars: a taller bar would shrink it.
  expect(band.top, 'top bar height').toBeCloseTo(shell.topBarHeight, 0)
  expect(band.bottom, 'tab bar top').toBeCloseTo(
    NATIVE_FOLD_VIEWPORT.height - shell.tabBarHeight,
    0
  )
  return band
}

/** AC2: the first own content starts below the top bar and shows inside the band. */
export function expectFirstContentInFold(anchor: HTMLElement, label: string) {
  const band = foldBand()
  const box = anchor.getBoundingClientRect()
  expect(box.height, `${label} has a box`).toBeGreaterThan(0)
  expect(box.top, `${label} starts below the top bar`).toBeGreaterThanOrEqual(
    band.top - 1
  )
  const visible = Math.max(
    0,
    Math.min(box.bottom, band.bottom) - Math.max(box.top, band.top)
  )
  expect(
    visible,
    `${label}: px inside the fold band ${band.top}..${band.bottom} (top ${box.top}, height ${box.height})`
  ).toBeGreaterThanOrEqual(Math.min(box.height, TALL_CONTENT_VISIBLE_PX) - 1)
}

/** An element a member can see: a box, shown, not hidden from assistive tech. */
function shown(element: Element) {
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 1 &&
    rect.height > 1 &&
    element.closest('[aria-hidden="true"], [inert]') === null &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  )
}

/** Whether `element` sits between the top bar and the first content, outside both. */
function between(element: Element, anchor: HTMLElement, bandTop: number) {
  if (topBar().contains(element) || anchor.contains(element) || element.contains(anchor))
    return false
  const rect = element.getBoundingClientRect()
  return rect.top >= bandTop - 1 && rect.bottom <= anchor.getBoundingClientRect().top + 1
}

/**
 * AC2 "no banner, explanation or setup progress first": the visible alerts, status lines,
 * progress bars and setup cards or banners between the top bar and the first content.
 */
export function chromeBefore(anchor: HTMLElement): string[] {
  const { top } = foldBand()
  const selectors = [
    '[role="progressbar"]',
    '[role="alert"]',
    '[role="status"]',
    '[aria-live="assertive"]',
    '[data-testid*="onboarding-card"]',
    '[data-testid*="onboarding-banner"]',
    '[data-testid*="setup-banner"]',
  ].join(', ')
  return Array.from(document.querySelectorAll(selectors))
    .filter((element) => shown(element) && between(element, anchor, top))
    .map(
      (element) =>
        element.getAttribute('data-testid') ??
        `${element.getAttribute('role') ?? element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 40)}"`
    )
}

/**
 * Every line of text between the top bar and the first content. On Closet, Looks and Profile no
 * explanation may come first; Today's weather line and Community's own header are content
 * (CC-7.13, CC-7.15), so those suites do not call this.
 */
export function textBefore(anchor: HTMLElement): string[] {
  const { top } = foldBand()
  const out: string[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    const parent = node.parentElement
    if (text && parent && shown(parent) && between(parent, anchor, top)) out.push(text)
  }
  return out
}
