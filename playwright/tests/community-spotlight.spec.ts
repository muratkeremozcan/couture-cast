// Story 6.6: the City Spotlight module that heads the community section on `/`.
import type { Page } from '@playwright/test'
import { checkA11y } from '../support/helpers/accessibility'
import { communityTest as test, expect } from '../support/helpers/community-session'
import {
  SEEDED_SPOTLIGHT_POST_IDS,
  assertSeededSpotlight,
  placeViewerInArea,
  seededSpotlightCaption,
} from '../support/helpers/community-spotlight'
import { SEEDED_SPOTLIGHT_AREA } from '@couture/testing'

const spotlight = (page: Page) => page.getByTestId('community-spotlight')

async function loadedSpotlight(page: Page) {
  await page.goto('/')
  await expect(spotlight(page)).toHaveAttribute('aria-busy', 'false')
  await expect(spotlight(page)).toHaveAttribute(
    'data-level',
    /^(city|region|country|none)$/
  )
}

async function rankedIds(page: Page): Promise<string[]> {
  const entries = spotlight(page).getByRole('listitem')
  return entries.evaluateAll((items) =>
    items.map(
      (item) =>
        item.getAttribute('data-testid')?.replace(/^community-spotlight-item-/, '') ?? ''
    )
  )
}

test.describe('Story 6.6 City Spotlight', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  test('[P1] heads the community section with the viewer area and the ranked seeded cohort', async ({
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
      await loadedSpotlight(page)

      await expect(spotlight(page)).toHaveAttribute('data-level', 'city')
      await expect(page.getByTestId('community-spotlight-heading')).toHaveText(
        `Spotlight in ${SEEDED_SPOTLIGHT_AREA.city}`
      )
      // The module is the first thing in the community section.
      await expect(
        page
          .getByRole('complementary', { name: 'Community lookbook' })
          .locator(':scope > *')
          .first()
      ).toHaveAttribute('data-testid', 'community-spotlight')
      const firstPage = SEEDED_SPOTLIGHT_POST_IDS.slice(0, 6)
      expect(await rankedIds(page)).toEqual(firstPage)
      for (const [index, postId] of firstPage.entries()) {
        await expect(
          page.getByTestId(`community-spotlight-item-${postId}`)
        ).toHaveAttribute('data-rank', String(index + 1))
      }
      await expect(page.getByTestId('community-spotlight-view-more')).toBeVisible()
      await checkA11y(page)
    } finally {
      // Leave the page first: an open detail keeps reading the post's comments,
      // and deleting the fixture under a live request turns it into a 404.
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] View more appends the next ranked looks, focuses the first one and announces once', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      await loadedSpotlight(page)
      await expect(page.getByTestId('community-spotlight-heading')).toHaveText(
        `Spotlight in ${SEEDED_SPOTLIGHT_AREA.city}`
      )
      expect(await rankedIds(page)).toEqual(SEEDED_SPOTLIGHT_POST_IDS.slice(0, 6))

      // Every text the one live region takes, so a repeated announcement shows.
      await page.getByTestId('community-live-region').evaluate((region) => {
        const seen: string[] = []
        Object.assign(window, { __spotlightAnnouncements: seen })
        new MutationObserver(() => seen.push(region.textContent ?? '')).observe(region, {
          childList: true,
          subtree: true,
          characterData: true,
        })
      })
      await page.getByTestId('community-spotlight-view-more').click()

      const firstNew = SEEDED_SPOTLIGHT_POST_IDS[6]!
      await expect(page.getByTestId(`spotlight-lookbook-card-${firstNew}`)).toBeFocused()
      expect(await rankedIds(page)).toEqual(SEEDED_SPOTLIGHT_POST_IDS)
      await expect(page.getByTestId('community-live-region')).toHaveText(
        'Loaded 1 more spotlight look.'
      )
      expect(
        await page.evaluate(() =>
          (
            (window as unknown as { __spotlightAnnouncements: string[] })
              .__spotlightAnnouncements ?? []
          ).filter((text) => text === 'Loaded 1 more spotlight look.')
        )
      ).toHaveLength(1)
      await expect(page.getByTestId('community-spotlight-view-more')).toHaveCount(0)
      await checkA11y(page)
    } finally {
      // Leave the page first: an open detail keeps reading the post's comments,
      // and deleting the fixture under a live request turns it into a 404.
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P1] opening a spotlight look opens the detail and records only the spotlight open', async ({
    page,
    communitySession,
  }) => {
    await assertSeededSpotlight()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const opens: unknown[] = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          /\/community\/posts\/[^/]+\/opened$/.test(request.url())
        )
          opens.push(request.postDataJSON())
      })
      await loadedSpotlight(page)
      const target = SEEDED_SPOTLIGHT_POST_IDS[1]!
      const recorded = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/community/posts/${target}/opened`)
      )
      await page.getByTestId(`spotlight-lookbook-open-${target}`).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByTestId('community-detail-caption')).toHaveText(
        seededSpotlightCaption(target)
      )
      expect(
        await dialog.evaluate((element) => element.contains(document.activeElement))
      ).toBe(true)
      expect((await recorded).status()).toBe(200)
      expect(opens).toEqual([{ surface: 'spotlight', rank: 2, level: 'city' }])
    } finally {
      // Leave the page first: an open detail keeps reading the post's comments,
      // and deleting the fixture under a live request turns it into a 404.
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`[P1] lays the ranked looks out in one horizontal row at ${viewport.width}px`, async ({
      page,
      communitySession,
    }) => {
      // R42: six stacked cards pushed the first feed card several screens down.
      // One row keeps the feed within a card's height of the module.
      await assertSeededSpotlight()
      const removeLocation = await placeViewerInArea(
        communitySession.userId,
        SEEDED_SPOTLIGHT_AREA
      )
      try {
        await page.setViewportSize(viewport)
        await loadedSpotlight(page)
        const row = page.getByTestId('community-spotlight-row')
        await expect(row).toBeVisible()
        const layout = await row.evaluate((element) => {
          const items = Array.from(
            element.querySelectorAll<HTMLElement>(
              '[data-testid^="community-spotlight-item-"]'
            ),
            (item) => item.getBoundingClientRect()
          )
          const module = document
            .querySelector('[data-testid="community-spotlight"]')!
            .getBoundingClientRect()
          return {
            rowScrolls: element.scrollWidth > element.clientWidth,
            pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
            tops: items.map((item) => Math.round(item.top)),
            cardHeight: Math.max(...items.map((item) => item.height)),
            moduleHeight: module.height,
          }
        })
        expect(layout.tops).toHaveLength(6)
        expect(new Set(layout.tops).size).toBe(1)
        expect(layout.rowScrolls).toBe(true)
        expect(layout.pageScrollsSideways).toBe(false)
        // Heading, row and View more: the module is one card tall plus chrome.
        expect(layout.moduleHeight).toBeLessThan(layout.cardHeight + 200)
        await checkA11y(page)
      } finally {
        await page.goto('about:blank')
        await removeLocation()
      }
    })
  }

  test('[P2] shows the localized empty state for a viewer with no saved location', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await loadedSpotlight(page)

    await expect(spotlight(page)).toHaveAttribute('data-level', 'none')
    await expect(page.getByTestId('community-spotlight-heading')).toHaveText(
      'City Spotlight'
    )
    await expect(page.getByTestId('community-spotlight-empty')).toContainText(
      'No spotlight near you yet'
    )
    await expect(page.getByTestId('community-spotlight-list')).toHaveCount(0)
  })
})
