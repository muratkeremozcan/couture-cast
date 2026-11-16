// Owner report 2026-11-16, iPhone 16 Safari: the Wardrobe Hub header put its title and three
// actions on one row, so Outfit capsules broke onto two lines and + Add Garment ran off the
// screen. TEA test design for fix/web-signed-in-landing, case O-1: at phone widths no page
// scrolls sideways, every header and hero action lies inside the viewport and inside every
// clipping ancestor, and every action label stays on one line. Runs in Chromium and in WebKit
// with the iPhone 15 descriptor (base.config.ts), in light and dark, in English and German
// (the longest labels), at 393 px (iPhone 15 and 16) and 320 px (the narrowest supported).
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'

const WIDTHS = [393, 320] as const
const SCHEMES = ['light', 'dark'] as const
const MEMBER_ROUTES = ['/', '/wardrobe', '/wardrobe/capsules', '/community', '/settings']
const GUEST_ROUTES = ['/']

type Problem = string

/** Everything wrong with the page's layout at its current width, as readable lines. */
async function layoutProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const label = (control: HTMLElement) =>
      (control.innerText || control.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim()
    /** The nearest ancestor that clips its content, if the control pokes out of it. */
    const clippedBy = (control: HTMLElement, box: DOMRect) => {
      for (
        let ancestor = control.parentElement;
        ancestor && ancestor !== document.body;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor)
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
        const clip = ancestor.getBoundingClientRect()
        const outside = box.left < clip.left - 0.5 || box.right > clip.right + 0.5
        return outside ? ancestor.tagName.toLowerCase() : null
      }
      return null
    }
    const lineCount = (control: HTMLElement) => {
      const range = document.createRange()
      range.selectNodeContents(control)
      return new Set(
        Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => Math.round(rect.bottom))
      ).size
    }
    const controlProblems = (control: HTMLElement): string[] => {
      const box = control.getBoundingClientRect()
      const shown =
        box.width > 0 &&
        box.height > 0 &&
        control.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      if (!shown) return []
      const name = label(control)
      const problems: string[] = []
      if (box.left < -0.5 || box.right > width + 0.5)
        problems.push(
          `"${name}" leaves the viewport: ${Math.round(box.left)} to ${Math.round(box.right)} of ${width}`
        )
      const clip = clippedBy(control, box)
      if (clip) problems.push(`"${name}" is clipped by a <${clip}>`)
      const lines = lineCount(control)
      if (lines > 1) problems.push(`"${name}" wraps onto ${lines} lines`)
      return problems
    }

    const scrollWidth = document.documentElement.scrollWidth
    const problems =
      scrollWidth === width
        ? []
        : [`page scrolls sideways: scrollWidth ${scrollWidth} > ${width}`]
    const controls = document.querySelectorAll<HTMLElement>(
      'header a, header button, [data-testid="hero-section"] a, [data-testid="hero-section"] button, [data-testid="hero-section"] label'
    )
    for (const control of Array.from(controls)) problems.push(...controlProblems(control))
    return problems
  })
}

/** Checks the loaded page at every width and colour scheme, without reloading it. */
async function expectNoOverflow(page: Page, route: string) {
  const problems: string[] = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 852 })
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme })
      // Layout settles in the frame after a resize or a scheme change.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      )
      for (const problem of await layoutProblems(page))
        problems.push(`${route} at ${width} px, ${colorScheme}: ${problem}`)
    }
  }
  expect(problems).toEqual([])
}

async function open(page: Page, route: string) {
  await page.goto(route)
  await expect(page.locator('#main-content')).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => null))
}

for (const locale of ['en-US', 'de-DE']) {
  test.describe(`phone widths, ${locale}`, () => {
    test.use({ locale })

    test.describe('signed in', () => {
      test.skip(
        process.env.TEST_ENV !== undefined && process.env.TEST_ENV !== 'local',
        'The signed-in fixture session exists only on the local stack.'
      )
      for (const route of MEMBER_ROUTES)
        test(`O-1 ${route} fits a phone, signed in`, async ({ page }, testInfo) => {
          await open(page, route)
          await expectNoOverflow(page, route)
          // TEA opens these before sign-off: the header the owner reported, at 393 px.
          if (route === '/wardrobe')
            for (const colorScheme of SCHEMES) {
              await page.setViewportSize({ width: 393, height: 852 })
              await page.emulateMedia({ colorScheme })
              await testInfo.attach(`wardrobe-header-393-${colorScheme}-${locale}`, {
                body: await page.locator('header').first().screenshot(),
                contentType: 'image/png',
              })
            }
        })
    })

    test.describe('signed out', () => {
      test.use({ authSessionEnabled: false })
      for (const route of GUEST_ROUTES)
        test(`O-1 ${route} fits a phone, signed out`, async ({ page }) => {
          await open(page, route)
          await expectNoOverflow(page, route)
        })
    })
  })
}
