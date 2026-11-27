// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): shared probes for five-tab-navigation.spec.ts,
// sub-screen-back.spec.ts and overlay-close.spec.ts.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { expect, type Locator, type Page } from '@playwright/test'
import type { ShellMode, ShellScreen } from './shell-fixtures'

/** AC2: the fold is measured at 390 x 664 (844 less the phone browser's chrome). */
export const FOLD_VIEWPORT = { width: 390, height: 664 }

/**
 * P5: each tab's first own content. Closet's is its grid, or the empty state when the member
 * has no garment.
 */
export function firstContent(page: Page, screen: ShellScreen, mode: ShellMode): Locator {
  const empty = mode === 'empty' || mode === 'guardian-pending'
  const ids: Record<ShellScreen, string> = {
    home: 'today-first-content',
    closet: empty ? 'closet-empty-state' : 'closet-garment-grid',
    looks: 'looks-first-content',
    community: 'community-first-content',
    profile: 'profile-account-row',
  }
  return page.getByTestId(ids[screen])
}

/**
 * P4: the band a member sees without scrolling, from the bottom of the top bar to the top of
 * the bottom tab bar. Both bars are measured, so a taller bar shrinks the band.
 */
export async function foldBand(page: Page) {
  const top = await page.getByTestId('app-header').boundingBox()
  const nav = await page.getByTestId('sticky-bottom-nav').boundingBox()
  expect(top, 'top bar').not.toBeNull()
  expect(nav, 'bottom tab bar').not.toBeNull()
  return { top: top!.y + top!.height, bottom: nav!.y }
}

/** The element's height inside the band, in CSS px. */
export async function visibleInBand(
  locator: Locator,
  band: { top: number; bottom: number }
) {
  const box = await locator.boundingBox()
  expect(box, 'element has a box').not.toBeNull()
  const from = Math.max(box!.y, band.top)
  const to = Math.min(box!.y + box!.height, band.bottom)
  return { box: box!, visible: Math.max(0, to - from) }
}

/**
 * AC2 "first content within the fold": all of it when it is short, else its first 120 px, so a
 * tall outfit card or grid counts once a member can see and reach it.
 */
export async function expectInFold(page: Page, locator: Locator, label: string) {
  await expect(locator, label).toBeVisible()
  const band = await foldBand(page)
  const { box, visible } = await visibleInBand(locator, band)
  expect(box.y, `${label} starts below the top bar`).toBeGreaterThanOrEqual(band.top - 1)
  expect(
    visible,
    `${label}: px inside the fold band ${band.top}..${band.bottom}`
  ).toBeGreaterThanOrEqual(Math.min(box.height, 120) - 1)
}

/**
 * AC2 "no banner, explanation or setup progress first": the visible elements that sit between
 * the top bar and the first content and read as one of those. Selectors, not class names: setup
 * progress, an onboarding link or banner, an alert or status that is not visually hidden, and
 * (when `paragraphs`) any paragraph of explanation.
 */
export async function chromeBefore(
  page: Page,
  anchor: Locator,
  options: { paragraphs: boolean }
): Promise<string[]> {
  const handle = await anchor.elementHandle()
  return page.evaluate(
    ({ anchor, paragraphs }) => {
      if (!anchor) return ['anchor missing']
      const anchorTop = anchor.getBoundingClientRect().top
      const topBar = document.querySelector('[data-testid="app-header"]')
      const barBottom = topBar ? topBar.getBoundingClientRect().bottom : 0
      const selectors = [
        '[role="progressbar"]',
        'progress',
        'a[href*="/wardrobe/onboarding"]',
        '[data-testid*="onboarding-banner"]',
        '[data-testid*="onboarding-card"]',
        '[data-testid*="setup-banner"]',
        '[role="alert"]',
        '[role="status"]',
        ...(paragraphs ? ['p'] : []),
      ]
      const outside = (element: HTMLElement) =>
        Boolean(topBar?.contains(element)) ||
        anchor.contains(element) ||
        element.closest('[data-testid="sticky-bottom-nav"]') !== null
      const hidden = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          rect.width <= 1 ||
          rect.height <= 1 ||
          style.visibility === 'hidden' ||
          style.display === 'none' ||
          Number(style.opacity) === 0 ||
          element.closest('[aria-hidden="true"],[inert]') !== null ||
          !(element.textContent ?? '').trim()
        )
      }
      const between = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > barBottom && rect.top < anchorTop
      }
      const describe = (element: HTMLElement) => {
        const id = element.getAttribute('data-testid')
        const text = (element.textContent ?? '').trim().slice(0, 60)
        return `${element.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''}: ${text}`
      }
      return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
        .filter((element) => !outside(element) && !hidden(element) && between(element))
        .map(describe)
    },
    { anchor: handle, paragraphs: options.paragraphs }
  )
}

/** The bottom bar's links, in DOM order, as the member reads them. */
export async function bottomNavTabs(page: Page) {
  return page
    .getByTestId('sticky-bottom-nav')
    .getByRole('link')
    .evaluateAll((links) =>
      links.map((link) => ({
        testId: link.getAttribute('data-testid'),
        href: link.getAttribute('href'),
        label: (link.textContent ?? '').trim(),
        current: link.getAttribute('aria-current'),
        paths: Array.from(link.querySelectorAll('svg path')).map((path) =>
          path.getAttribute('d')
        ),
        svgHidden: Array.from(link.querySelectorAll('svg')).every(
          (svg) => svg.getAttribute('aria-hidden') === 'true'
        ),
      }))
    )
}
