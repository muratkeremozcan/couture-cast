// Story 6.7: the Home spotlight teaser in the Hero Ritual Canvas on stacked layouts.
import type { Page, Request } from '@playwright/test'
import { checkA11y } from '../support/helpers/accessibility'
import { communityTest as test, expect } from '../support/helpers/community-session'
import {
  SEEDED_SPOTLIGHT_POST_IDS,
  SEEDED_SPOTLIGHT_REACTION_COUNTS,
  assertSeededSpotlight,
  placeViewerInArea,
  seededSpotlightTopAuthorAlias,
} from '../support/helpers/community-spotlight'
import { SEEDED_SPOTLIGHT_AREA } from '@couture/testing'

const NARROW = { width: 390, height: 844 }
const WIDE = { width: 1440, height: 900 }

const heroCanvas = (page: Page) =>
  page.getByRole('region', { name: 'Hero Ritual Canvas' })
const teaserLink = (page: Page) => page.getByTestId('home-spotlight-teaser-link')

function isTeaserRead(request: Request): boolean {
  if (request.method() !== 'GET') return false
  const url = new URL(request.url())
  return (
    url.pathname.endsWith('/api/v1/community/spotlight') &&
    url.searchParams.get('surface') === 'home_teaser'
  )
}

/** Waits for the Community module to settle, so a read it never made cannot still arrive. */
async function settledModule(page: Page) {
  const module = page.getByTestId('community-spotlight')
  await expect(module).toHaveAttribute('aria-busy', 'false')
  await expect(module).toHaveAttribute('data-level', /^(city|region|country|none)$/)
}

test.describe('Story 6.7 Home spotlight teaser', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('[P1] a narrow layout shows the top entry in the hero and focuses it in the City Spotlight from the keyboard', async ({
    page,
    communitySession,
  }) => {
    // Read-only: the shared seeded cohort is never reacted to by a test.
    await assertSeededSpotlight()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const teaserReads: URL[] = []
      const opens: unknown[] = []
      page.on('request', (request) => {
        if (isTeaserRead(request)) teaserReads.push(new URL(request.url()))
        if (
          request.method() === 'POST' &&
          /\/community\/posts\/[^/]+\/opened$/.test(request.url())
        )
          opens.push(request.postDataJSON())
      })
      await page.setViewportSize(NARROW)
      await page.goto('/')
      await settledModule(page)

      const link = teaserLink(page)
      await expect(link).toBeVisible()
      await expect(
        heroCanvas(page).getByTestId('home-spotlight-teaser-link')
      ).toHaveCount(1)
      const top = SEEDED_SPOTLIGHT_POST_IDS[0]!
      await expect(page.getByTestId('home-spotlight-teaser-heading')).toHaveText(
        `Standout look in ${SEEDED_SPOTLIGHT_AREA.city}`
      )
      await expect(page.getByTestId('home-spotlight-teaser-reactions')).toHaveText(
        `${SEEDED_SPOTLIGHT_REACTION_COUNTS[0]} reactions`
      )
      // The served page already resolved the author's stored alias.
      const author = await seededSpotlightTopAuthorAlias()
      await expect(page.getByTestId('home-spotlight-teaser-author')).toHaveText(author)
      const image = page.getByTestId('home-spotlight-teaser-image')
      await expect(image).toHaveAttribute('alt', '')
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0)
      await expect(link).toHaveAttribute('href', `#spotlight-lookbook-card-${top}`)
      await expect(link).toHaveAccessibleName(
        new RegExp(
          `^Standout look in ${SEEDED_SPOTLIGHT_AREA.city} by ${author}, ${SEEDED_SPOTLIGHT_REACTION_COUNTS[0]} reactions\\.`
        )
      )
      const box = await link.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(teaserReads.map((url) => url.searchParams.get('limit'))).toEqual(['1'])
      await checkA11y(page)

      // Every text the one live region takes, so a repeated announcement shows.
      await page.getByTestId('community-live-region').evaluate((region) => {
        const seen: string[] = []
        Object.assign(window, { __teaserAnnouncements: seen })
        new MutationObserver(() => seen.push(region.textContent ?? '')).observe(region, {
          childList: true,
          subtree: true,
          characterData: true,
        })
      })
      await link.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId(`spotlight-lookbook-card-${top}`)).toBeFocused()
      await expect(page.getByTestId('community-live-region')).toHaveText(
        'Focused on the highlighted look.'
      )
      expect(
        await page.evaluate(() =>
          (
            (window as unknown as { __teaserAnnouncements: string[] })
              .__teaserAnnouncements ?? []
          ).filter((text) => text === 'Focused on the highlighted look.')
        )
      ).toHaveLength(1)
      await expect
        .poll(() => opens)
        .toEqual([{ surface: 'home_teaser', rank: 1, level: 'city' }])
      await expect(page.getByTestId('community-spotlight-notice')).toHaveCount(0)
      await expect(page.getByTestId('deep-link-info-banner')).toHaveCount(0)
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] a side-by-side layout issues no home_teaser read and shows no teaser', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const teaserReads: string[] = []
      page.on('request', (request) => {
        if (isTeaserRead(request)) teaserReads.push(request.url())
      })
      await page.setViewportSize(WIDE)
      await page.goto('/')
      await settledModule(page)
      await expect(page.getByTestId('community-spotlight')).toHaveAttribute(
        'data-level',
        'city'
      )
      // The teaser resolves its member and visibility on mount, before the
      // module's own read settles, so any read it made would be out by now.
      await expect(page.getByTestId('community-spotlight-list')).toBeVisible()
      await expect(page.locator('[data-testid^="home-spotlight-teaser"]')).toHaveCount(0)

      // Positive control: the same page stacked reads and shows the teaser. The
      // read must be caused by the resize, so none may have happened before it.
      expect(teaserReads).toEqual([])
      const stackedRead = page.waitForRequest(isTeaserRead)
      await page.setViewportSize(NARROW)
      await stackedRead
      await expect(teaserLink(page)).toBeVisible()
      expect(teaserReads).toHaveLength(1)
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P2] a viewer with no spotlight renders no teaser and reserves no space', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const teaserRead = page.waitForResponse((response) =>
      isTeaserRead(response.request())
    )
    await page.setViewportSize(NARROW)
    await page.goto('/')
    await settledModule(page)
    await expect(page.getByTestId('community-spotlight')).toHaveAttribute(
      'data-level',
      'none'
    )
    // The teaser's own read answered none, and React had frames to render
    // whatever it would render for it, before absence is asserted.
    const answered: unknown = await (await teaserRead).json()
    expect(answered).toMatchObject({ data: { level: 'none', items: [] } })
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    await expect(page.locator('[data-testid^="home-spotlight-teaser"]')).toHaveCount(0)
    // The hero ends with the outfit tiles: nothing is reserved after them.
    const gap = await heroCanvas(page).evaluate((canvas) => {
      const last = canvas.lastElementChild!.getBoundingClientRect()
      const bottom = canvas.getBoundingClientRect().bottom
      return Math.round(bottom - last.bottom)
    })
    expect(gap).toBeLessThanOrEqual(48)
    expect(
      await heroCanvas(page).evaluate(
        (canvas) =>
          canvas.lastElementChild?.querySelector('[data-testid="outfit-scroll"]') !== null
      )
    ).toBe(true)
    await checkA11y(page)
  })
})
