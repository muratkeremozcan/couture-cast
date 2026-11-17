// Owner report 2026-11-16, iPhone 16 Safari: the Wardrobe Hub header put its title and three
// actions on one row, so Outfit capsules broke onto two lines and + Add Garment ran off the
// screen. TEA test design for fix/web-signed-in-landing, case O-1: at phone widths no page
// scrolls sideways, every header and hero action lies inside the viewport and inside every
// clipping ancestor, and every action label stays on one line. Runs in Chromium and in WebKit
// with the iPhone 15 descriptor (base.config.ts), in light and dark, in English and German
// (the longest labels), at 393 px (iPhone 15 and 16) and 320 px (the narrowest supported). The
// bottom navigation is checked too, and no label may be cut inside its own box.
import type { Page } from '@playwright/test'
import { communityFeedResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { seedWebSession } from '../support/helpers/commerce-session'

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
    /** Line boxes of a range's rects: a rect starting below the current line opens a new one. */
    const linesOf = (range: Range) => {
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => a.top - b.top)
      let lines = 0
      let bottom = -Infinity
      for (const rect of rects)
        if (rect.top >= bottom - 1) {
          lines++
          bottom = rect.bottom
        } else bottom = Math.max(bottom, rect.bottom)
      return lines
    }
    /**
     * The lines the control's whole content takes (TEA R2). A control that stacks its parts in
     * a column on purpose (an icon above a label in the bottom navigation) is measured part by
     * part, each part as a whole.
     */
    const lineCount = (element: Element): number => {
      const style = getComputedStyle(element)
      if (style.display.includes('flex') && style.flexDirection.startsWith('column'))
        return Math.max(0, ...Array.from(element.children).map(lineCount))
      const range = document.createRange()
      range.selectNodeContents(element)
      return linesOf(range)
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
      // TEA P5, R2: a label cut by its own box, whatever its overflow: content wider than a box,
      // or text that reaches past the control's edges.
      // A screen-reader-only part is a 1 px clipped box on purpose.
      for (const part of [
        control,
        ...Array.from(control.querySelectorAll<HTMLElement>('*')),
      ])
        if (part.clientWidth > 1 && part.scrollWidth > part.clientWidth + 0.5)
          problems.push(`"${name}" is cut inside its own box`)
      const text = document.createRange()
      text.selectNodeContents(control)
      const textBox = text.getBoundingClientRect()
      if (
        textBox.width > 0 &&
        (textBox.left < box.left - 0.5 || textBox.right > box.right + 0.5)
      )
        problems.push(`"${name}" has text outside its box`)
      return problems
    }

    const scrollWidth = document.documentElement.scrollWidth
    const problems =
      scrollWidth === width
        ? []
        : [`page scrolls sideways: scrollWidth ${scrollWidth} > ${width}`]
    const controls = document.querySelectorAll<HTMLElement>(
      'header a, header button, [data-testid="hero-section"] a, [data-testid="hero-section"] button, [data-testid="hero-section"] label, [data-testid="sticky-bottom-nav"] a'
    )
    for (const control of Array.from(controls)) problems.push(...controlProblems(control))
    return problems
  })
}

/**
 * Layout settles in the frame after a resize or a scheme change, and colours once their
 * transitions end (TEA F5: a screenshot mid-transition showed + Add Garment as if disabled).
 */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  )
  // Colour transitions only: a looping animation (a loading pulse) never finishes, and one that
  // is cancelled rejects.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => null))
    ).then(() => null)
  )
}

/**
 * TEA P4: below the sm breakpoint the Wardrobe Hub's two secondary actions share the first row
 * in equal halves and + Add Garment takes the whole second row.
 */
async function wardrobeHeaderProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const box = (element: Element | null) => element?.getBoundingClientRect()
    const capsules = box(document.querySelector('[data-testid="wardrobe-capsules-link"]'))
    const header = document.querySelector('header')
    const buttons = Array.from(header?.querySelectorAll('button') ?? [])
    const silhouette = box(
      buttons.find((button) => !button.textContent?.includes('Add')) ?? null
    )
    const add = box(
      buttons.find((button) => button.textContent?.includes('Add Garment')) ?? null
    )
    if (!capsules || !silhouette || !add) return ['a Wardrobe Hub action is missing']
    const near = (a: number, b: number) => Math.abs(a - b) <= 1
    const problems: string[] = []
    if (!near(capsules.top, silhouette.top))
      problems.push('the secondaries are not on one row')
    if (!near(capsules.width, silhouette.width))
      problems.push('the secondaries are not equal halves')
    if (!(add.top >= capsules.bottom))
      problems.push('+ Add Garment is not below the secondaries')
    if (!near(add.left, capsules.left) || !near(add.right, silhouette.right))
      problems.push('+ Add Garment does not span the row')
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
      await settle(page)
      for (const problem of await layoutProblems(page))
        problems.push(`${route} at ${width} px, ${colorScheme}: ${problem}`)
      if (route === '/wardrobe')
        for (const problem of await wardrobeHeaderProblems(page))
          problems.push(`${route} at ${width} px, ${colorScheme}: ${problem}`)
    }
  }
  expect(problems).toEqual([])
}

/**
 * TEA R4: the landing's community feed reads storage objects that live only in the default
 * database, so on an isolated stack it answers 503. The layout test needs the page chrome, not
 * the feed, so the feed answers a fixed empty page, checked against the contract.
 */
const EMPTY_FEED = communityFeedResponseSchema.parse({
  data: {
    items: [],
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    viewerBand: null,
    bandResolved: false,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: null,
  },
})

async function open(page: Page, route: string) {
  await page.route('**/api/v1/community/feed**', (request) =>
    request.fulfill({ json: EMPTY_FEED })
  )
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
        test(`O-1 ${route} fits a phone, signed in`, async ({
          page,
          authToken,
        }, testInfo) => {
          // TEA F3: the app's own bearer, so the landing really is the member landing.
          await seedWebSession(page, authToken)
          await open(page, route)
          await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
          await expectNoOverflow(page, route)
          // TEA opens these before sign-off: the header the owner reported, at 393 px.
          if (route === '/wardrobe')
            for (const colorScheme of SCHEMES) {
              await page.setViewportSize({ width: 393, height: 852 })
              await page.emulateMedia({ colorScheme })
              await settle(page)
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
