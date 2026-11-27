// Story CC-7.12 (Step 69): the Looks segments, the Saved Capsules filter and the capsule manager
// at /looks/capsules are the member routes in place of /wardrobe/capsules.
// Story CC-7.11 D4: the Closet actions now live in the top bar (Add and More); the row that
// broke below is gone and `wardrobeHeaderProblems` holds the new placement.
// Owner report 2026-11-16, iPhone 16 Safari: the Wardrobe Hub header put its title and three
// actions on one row, so Outfit capsules broke onto two lines and + Add Garment ran off the
// screen. TEA test design for fix/web-signed-in-landing, case O-1: at phone widths no page
// scrolls sideways, every header and hero action lies inside the viewport and inside every
// clipping ancestor, and compact action labels stay on one line. Runs in Chromium and in WebKit
// with the iPhone 15 descriptor (base.config.ts), in light and dark, in English and German
// (the longest labels), at 393 px (iPhone 15 and 16) and 320 px (the narrowest supported). The
// bottom navigation is checked too, and no label may be cut inside its own box.
import type { Page } from '@playwright/test'
import { communityFeedResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { seedWebSession } from '../support/helpers/commerce-session'

const WIDTHS = [393, 320] as const
const SCHEMES = ['light', 'dark'] as const
// Story CC-7.11 D1: Looks is the new tab. Story CC-7.12 D1, D4, D6: its segments, the Saved
// filter row and the capsule manager, which moved from `/wardrobe/capsules` to `/looks/capsules`.
const MEMBER_ROUTES = [
  '/',
  '/wardrobe',
  '/looks',
  '/looks?segment=saved&filter=capsules',
  '/looks?segment=ideas',
  '/looks?segment=plan',
  '/looks/capsules',
  '/community',
  '/settings',
]
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
    /** The first ancestor, nearest out, that clips its content and that the control pokes out of. */
    const clippedBy = (control: HTMLElement, box: DOMRect) => {
      for (
        let ancestor = control.parentElement;
        ancestor && ancestor !== document.body;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor)
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
        const clip = ancestor.getBoundingClientRect()
        // Every clipping ancestor counts, not only the nearest (CodeRabbit on PR 248).
        if (box.left < clip.left - 0.5 || box.right > clip.right + 0.5)
          return ancestor.tagName.toLowerCase()
      }
      return null
    }
    /**
     * The boxes a control's content paints: one per text fragment and one per icon. Story
     * CC-7.11 D2: an inline svg icon is one box; its paths are not lines of text (a range over
     * the icon reports a rect per path, which read the multi-path tab icons as two lines).
     */
    const contentRects = (element: Element): DOMRect[] => {
      const rects: DOMRect[] = []
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            if (node instanceof HTMLElement && node.classList.contains('sr-only'))
              return NodeFilter.FILTER_REJECT
            if (node instanceof SVGSVGElement) {
              rects.push(node.getBoundingClientRect())
              // FILTER_REJECT skips the icon's paths with it.
              return NodeFilter.FILTER_REJECT
            }
            return node.nodeType === Node.TEXT_NODE
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP
          },
        }
      )
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        rects.push(...Array.from(range.getClientRects()))
      }
      return rects
    }
    /** Line boxes of a set of rects: a rect starting below the current line opens a new one. */
    const linesOf = (all: DOMRect[]) => {
      const rects = all
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
      return linesOf(contentRects(element))
    }
    const positionProblems = (control: HTMLElement, box: DOMRect, name: string) => {
      const problems: string[] = []
      const chipRow = control.closest<HTMLElement>('[data-testid="community-chip-row"]')
      const scrollable = chipRow && getComputedStyle(chipRow).overflowX === 'auto'
      const rowBox = scrollable ? chipRow.getBoundingClientRect() : null
      const viewportBox = rowBox ?? box
      if (viewportBox.left < -0.5 || viewportBox.right > width + 0.5)
        problems.push(
          `"${name}" leaves the viewport: ${Math.round(viewportBox.left)} to ${Math.round(viewportBox.right)} of ${width}`
        )
      if (rowBox && chipRow) {
        const left = box.left - rowBox.left + chipRow.scrollLeft
        if (
          left < -0.5 ||
          left + box.width > chipRow.scrollWidth + 0.5 ||
          box.width > chipRow.clientWidth + 0.5
        )
          problems.push(`"${name}" cannot scroll fully into view`)
      }
      const clip = clippedBy(scrollable ? chipRow : control, viewportBox)
      if (clip) problems.push(`"${name}" is clipped by a <${clip}>`)
      return problems
    }
    const controlProblems = (control: HTMLElement): string[] => {
      const box = control.getBoundingClientRect()
      const shown =
        box.width > 0 &&
        box.height > 0 &&
        !control.closest('.sr-only') &&
        control.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      if (!shown) return []
      const name = label(control)
      const problems = positionProblems(control, box, name)
      const lines = lineCount(control)
      // Tab labels and full-sentence actions can use two lines on narrow phones.
      const canWrap = control.closest(
        '[data-testid="sticky-bottom-nav"], [data-testid="guest-preview-entry"], [data-testid="commerce-opt-out-label"], [data-testid="closet-empty-state"], [data-testid^="profile-"][data-testid$="-row"], [data-testid="closet-setup-progress-link"]'
      )
      const maxLines = canWrap ? 2 : 1
      if (lines > maxLines) problems.push(`"${name}" wraps onto ${lines} lines`)
      // TEA P5, R2: a label cut by its own box, whatever its overflow: content wider than a box,
      // or text that reaches past the control's edges.
      // A screen-reader-only part is a 1 px clipped box on purpose.
      for (const part of [
        control,
        ...Array.from(control.querySelectorAll<HTMLElement>('*')),
      ])
        if (part.clientWidth > 1 && part.scrollWidth > part.clientWidth + 0.5)
          problems.push(`"${name}" is cut inside its own box`)
      if (
        contentRects(control).some(
          (part) =>
            part.width > 0 && (part.left < box.left - 0.5 || part.right > box.right + 0.5)
        )
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
      'header a, header button, main a, main button, main label, [data-testid="sticky-bottom-nav"] a'
    )
    for (const control of Array.from(controls)) problems.push(...controlProblems(control))
    return problems
  })
}

/**
 * Let the browser apply the new scheme and viewport before measuring layout.
 */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  )
}

/**
 * TEA P4 as amended by Story CC-7.11 D4: the Capsules / Silhouette / + Add Garment row above the
 * grid is gone. + Add Garment (the one gold primary) and the neutral More button sit in the top
 * bar's trailing slot, on its one 56 px row, beside the title; `layoutProblems` already holds
 * every header control inside the viewport on one line.
 */
async function wardrobeHeaderProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]')
    const box = (testId: string) =>
      header?.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect()
    const bar = header?.getBoundingClientRect()
    const add = box('garment-capture-open')
    const more = box('closet-more-menu')
    const title = header?.querySelector('h1')?.getBoundingClientRect()
    const problems: string[] = []
    // Story CC-7.11 D4: the old action row must not come back above the grid.
    if (document.querySelector('[data-testid="wardrobe-actions"]'))
      problems.push('the old Closet action row is still on the page')
    if (!bar || !add || !more || !title)
      return [...problems, 'a Closet top bar part is missing']
    const centre = (rect: DOMRect) => rect.top + rect.height / 2
    if (Math.round(bar.height) !== 56)
      problems.push(`the top bar is ${bar.height} px tall`)
    for (const [name, rect] of [
      ['+ Add Garment', add],
      ['More', more],
    ] as const) {
      if (rect.top < bar.top - 0.5 || rect.bottom > bar.bottom + 0.5)
        problems.push(`${name} is outside the top bar row`)
      if (Math.abs(centre(rect) - centre(title)) > 1)
        problems.push(`${name} is not on the title's row`)
    }
    if (!(more.left >= add.right)) problems.push('More is not after + Add Garment')
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
  await page.emulateMedia({ reducedMotion: 'reduce' })
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
        test.describe(route, () => {
          // Story CC-7.12 D10: a free member's Plan rests on the planner's exact Premium-required
          // 403 (the free preview); every other planner error stays fatal.
          if (route === '/looks?segment=plan')
            test.use({ allowPremiumPlannerRefusal: true })
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
                  body: await page
                    .locator('header')
                    .first()
                    .screenshot({ animations: 'disabled' }),
                  contentType: 'image/png',
                })
              }
          })
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
