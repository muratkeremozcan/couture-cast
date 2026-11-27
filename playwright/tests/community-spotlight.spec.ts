// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
import type { Page } from '@playwright/test'
import { COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT } from '@couture/api-client/contracts/http'
import { checkA11y } from '../support/helpers/accessibility'
import { selectCommunityClimate } from '../support/helpers/community-ui'
import { communityTest as test, expect } from '../support/helpers/community-session'
import {
  SEEDED_SPOTLIGHT_POST_IDS,
  assertSeededSpotlight,
  placeViewerInArea,
  seededSpotlightCaption,
} from '../support/helpers/community-spotlight'
import { SEEDED_SPOTLIGHT_AREA } from '@couture/testing'

const rankedCards = (page: Page) =>
  page.getByTestId('community-card-grid').getByTestId(/^spotlight-lookbook-card-/)

async function loadedSpotlight(page: Page) {
  await page.goto('/community')
  await selectCommunityClimate(page, 'all')
  await expect(rankedCards(page).first()).toBeVisible()
}

async function rankedIds(page: Page): Promise<string[]> {
  return rankedCards(page).evaluateAll((items) =>
    items.map((item) => item.id.replace(/^spotlight-lookbook-card-/, ''))
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

  test('[P1] shows the ranked seeded cohort at the front of the feed with Near you labels', async ({
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

      const firstPage = SEEDED_SPOTLIGHT_POST_IDS.slice(
        0,
        COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT
      )
      await expect(rankedCards(page)).toHaveCount(firstPage.length)
      expect(await rankedIds(page)).toEqual(firstPage)
      const first = page.getByTestId('community-card-grid').locator('article').first()
      await expect(first).toHaveAttribute('id', `spotlight-lookbook-card-${firstPage[0]}`)
      for (const postId of firstPage) {
        await expect(
          page
            .getByTestId(`spotlight-lookbook-card-${postId}`)
            .getByText('Near you', { exact: true })
        ).toBeVisible()
        await expect(page.getByTestId(`lookbook-card-${postId}`)).toHaveCount(0)
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

  test('[P1] View more from the keyboard appends the next ranked looks, focuses the first one and announces once', async ({
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
      expect(await rankedIds(page)).toEqual(
        SEEDED_SPOTLIGHT_POST_IDS.slice(0, COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT)
      )

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
      // AC4 names keyboard users: View more is reached and activated from the keyboard.
      const viewMore = page.getByTestId('community-spotlight-view-more')
      await viewMore.focus()
      await expect(viewMore).toBeFocused()
      await page.keyboard.press('Enter')

      const firstNew = SEEDED_SPOTLIGHT_POST_IDS[COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT]!
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
    interceptNetworkCall,
  }) => {
    await assertSeededSpotlight()
    const removeLocation = await placeViewerInArea(
      communitySession.userId,
      SEEDED_SPOTLIGHT_AREA
    )
    try {
      const opens: unknown[] = []
      // playwright-utils deviation: interceptNetworkCall resolves on its first match;
      // this listener counts every open, so a second one shows.
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          /\/community\/posts\/[^/]+\/opened$/.test(request.url())
        )
          opens.push(request.postDataJSON())
      })
      await loadedSpotlight(page)
      const target = SEEDED_SPOTLIGHT_POST_IDS[1]!
      const recorded = interceptNetworkCall({
        method: 'POST',
        url: `**/community/posts/${target}/opened`,
      })
      await page.getByTestId(`spotlight-lookbook-open-${target}`).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByTestId('community-detail-caption')).toHaveText(
        seededSpotlightCaption(target)
      )
      expect(
        await dialog.evaluate((element) => element.contains(document.activeElement))
      ).toBe(true)
      expect((await recorded).status).toBe(200)
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
    test(`[P1] the inline ranked cards stay inside the feed at ${viewport.width}px`, async ({
      page,
      communitySession,
    }) => {
      await assertSeededSpotlight()
      const removeLocation = await placeViewerInArea(
        communitySession.userId,
        SEEDED_SPOTLIGHT_AREA
      )
      try {
        await page.setViewportSize(viewport)
        await loadedSpotlight(page)
        await expect(rankedCards(page)).toHaveCount(COMMUNITY_SPOTLIGHT_DEFAULT_LIMIT)
        for (const card of await rankedCards(page).all()) {
          const bounds = (await card.boundingBox())!
          expect(bounds.x).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(viewport.width)
        await checkA11y(page)
      } finally {
        await page.goto('about:blank')
        await removeLocation()
      }
    })
  }

  test('[P2] a viewer with no saved location sees the feed without an empty Spotlight module', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.goto('/community')
    await expect(
      page.getByTestId('community-card-grid').locator('article').first()
    ).toBeVisible()
    await expect(rankedCards(page)).toHaveCount(0)
    await expect(page.getByTestId('community-spotlight-view-more')).toHaveCount(0)
    await checkA11y(page)
  })
})
