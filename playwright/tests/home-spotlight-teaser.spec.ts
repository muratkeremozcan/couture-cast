// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Story 6.7: the Today Spotlight row and its handoff to Community.
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

const teaserLink = (page: Page) => page.getByTestId('home-spotlight-teaser-link')

function isTeaserRead(request: Request): boolean {
  if (request.method() !== 'GET') return false
  const url = new URL(request.url())
  return (
    url.pathname.endsWith('/api/v1/community/spotlight') &&
    url.searchParams.get('surface') === 'home_teaser'
  )
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

  test('[P1] a narrow layout shows one eligible row and focuses it in the City Spotlight from the keyboard', async ({
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

      const link = teaserLink(page)
      await expect(link).toBeVisible()
      await expect(link).toHaveCount(1)
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
      const href = new URL((await link.getAttribute('href'))!, 'http://local.test')
      expect(href.pathname).toBe('/community')
      expect(Object.fromEntries(href.searchParams)).toMatchObject({
        source: 'app',
        type: 'community',
        cardId: top,
        focus: 'spotlight',
        focusToken: expect.stringMatching(/.+/),
      })
      await expect(link).toHaveAccessibleName(
        new RegExp(
          `^Standout look in ${SEEDED_SPOTLIGHT_AREA.city} by ${author}, ${SEEDED_SPOTLIGHT_REACTION_COUNTS[0]} reactions\\.`
        )
      )
      const box = await link.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(teaserReads.map((url) => url.searchParams.get('limit'))).toEqual(['1'])
      await checkA11y(page)

      await link.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(`${href.pathname}${href.search}`)
      await expect(page.getByTestId(`spotlight-lookbook-card-${top}`)).toBeFocused()
      await expect(page.getByTestId('community-live-region')).toHaveText(
        'Focused on the highlighted look.'
      )
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

  test('[P1] desktop also shows exactly one Spotlight row without embedding the feed', async ({
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
      await expect(teaserLink(page)).toHaveCount(1)
      await expect(teaserLink(page)).toBeVisible()
      await expect(page.getByTestId('community-spotlight')).toHaveCount(0)
      await expect(page.getByTestId('community-card-grid')).toHaveCount(0)
      expect(teaserReads).toHaveLength(1)
    } finally {
      await page.goto('about:blank')
      await removeLocation()
    }
  })

  test('[P2] a viewer with no eligible Spotlight sees the sample and no Community row', async ({
    page,
    communitySession,
    interceptNetworkCall,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const read = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/community/spotlight?**surface=home_teaser**',
    })
    await page.setViewportSize(NARROW)
    await page.goto('/')
    const response = await read
    expect(response.responseJson).toMatchObject({ data: { level: 'none', items: [] } })
    await expect(page.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByTestId('home-spotlight-teaser')).toHaveCount(0)
    await expect(page.getByTestId('home-spotlight-teaser-reserved')).toHaveCount(0)
    await expect(page.getByTestId('member-sample-outfit')).toBeVisible()
    await checkA11y(page)
  })
})
