// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
// Test design: _bmad-output/test-artifacts/test-design-7-15-calm-community-empty-state.md.
import type { Locator } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  FIXED_NOW,
  openFixtureShell,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { calmCommunityFixture } from '../support/helpers/shell-fixtures'

const CLIMATE_OPTIONS = [
  'auto',
  'all',
  'cold_wet',
  'cold_dry',
  'temperate_wet',
  'temperate_dry',
  'warm_wet',
  'warm_dry',
] as const
const FIRST_POST = 'calm-community-peer-1'
const SECOND_POST = 'calm-community-peer-2'
const EXPLAINER = /Climate filters group looks by the week's forecast/

async function assertFitsPhone(control: Locator, width: number) {
  await control.scrollIntoViewIfNeeded()
  const bounds = await control.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(-1)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
  const fits = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const text = document.createRange()
    text.selectNodeContents(element)
    const lines = Array.from(text.getClientRects())
    return (
      lines.length > 0 &&
      lines.every(
        (line) => line.left >= bounds.left - 1 && line.right <= bounds.right + 1
      )
    )
  })
  expect(fits, `${control.toString()} wraps inside its bounds`).toBe(true)
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

test.describe('CC-7.15 Calm Community @local-lane', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
  })

  test('[P0] [7.15-COM-001/002/003] the single feed leads with the ranked look and keeps detail and report separate', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'community',
      community: calmCommunityFixture(false),
    })
    await page.goto('/community')
    await waitForShellSettled(page, router)

    const heading = page.getByRole('heading', { name: 'Community', exact: true })
    const post = page.getByTestId('create-post-button')
    const filter = page.getByTestId('community-climate-filter')
    const challenge = page.getByTestId('weekly-challenge-banner')
    const ranked = page.getByTestId(`spotlight-lookbook-card-${FIRST_POST}`)
    const peer = page.getByTestId(`lookbook-card-${SECOND_POST}`)
    await expect(post).toHaveAccessibleName('Post')
    await expect(filter).toHaveCount(1)
    await expect(challenge).toContainText('Weekend Layers Challenge')
    const tops: number[] = []
    for (const part of [heading, filter, challenge, ranked, peer]) {
      await expect(part).toBeVisible()
      tops.push((await part.boundingBox())!.y)
    }
    expect(tops[1]).toBeGreaterThan(tops[0]!)
    expect(tops[2]).toBeGreaterThan(tops[1]!)
    expect(tops[3]).toBeGreaterThan(tops[2]!)
    await expect(ranked.getByText('Near you', { exact: true })).toBeVisible()
    await expect(peer.getByText('Near you', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId(`lookbook-card-${FIRST_POST}`)).toHaveCount(0)
    await expect(
      page.getByTestId(/^(spotlight-)?lookbook-card-calm-community-peer-/)
    ).toHaveCount(2)
    await expect(ranked.getByText('Blue layers', { exact: true })).toBeVisible()
    await expect(ranked.getByText('Style Explorer CC7150A1')).toBeVisible()
    await expect(
      ranked.getByRole('img', { name: 'Illustration of blue layers.' })
    ).toBeVisible()
    await expect(
      ranked.getByTestId(`spotlight-community-reactions-${FIRST_POST}`)
    ).toHaveCount(1)
    await expect(peer.getByText('Rain shell', { exact: true })).toBeVisible()
    await expect(peer.getByText('Style Explorer CC7150B2')).toBeVisible()
    await expect(
      peer.getByRole('img', { name: 'Illustration of rain shell.' })
    ).toBeVisible()
    await expect(peer.getByTestId(`community-reactions-${SECOND_POST}`)).toHaveCount(1)

    await expect(page.getByText(EXPLAINER)).toHaveCount(0)
    await filter.click()
    const sheet = page.getByTestId('community-climate-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText(EXPLAINER)).toBeVisible()
    for (const mode of CLIMATE_OPTIONS) {
      await expect(sheet.getByTestId(`community-filter-${mode}`)).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(filter).toBeFocused()

    await challenge.getByTestId('community-challenge-dismiss').click()
    await expect(challenge).toBeHidden()
    await expect(ranked).toBeVisible()

    await ranked.getByTestId(`spotlight-lookbook-open-${FIRST_POST}`).click()
    const detail = page.getByRole('dialog', { name: 'Blue layers' })
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('community-detail-author')).toHaveText(
      'Style Explorer CC7150A1'
    )
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    await expect(page.getByTestId(`report-button-${SECOND_POST}`)).toBeHidden()
    await peer.getByTestId('community-card-actions').click()
    await expect(page.getByTestId('community-detail')).toHaveCount(0)
    await expect(page.getByTestId(`withdraw-button-${SECOND_POST}`)).toHaveCount(0)
    await page.getByTestId(`report-button-${SECOND_POST}`).click()
    await expect(page.getByTestId('report-reason-select')).toBeVisible()
  })

  test('[P0] [7.15-COM-004] an empty climate opens all climates and reveals both peer looks', async ({
    page,
    interceptNetworkCall,
  }) => {
    const scene = calmCommunityFixture(true)
    const nearby = scene.feed('all').items.find(({ id }) => id === FIRST_POST)!
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'community',
      community: {
        ...scene,
        spotlight: {
          level: 'city',
          label: 'Chicago',
          items: [{ ...nearby, rank: 1 }],
          nextCursor: 'next-ranked-page',
        },
      },
    })
    await page.goto('/community')
    await waitForShellSettled(page, router)

    const empty = page.getByTestId('community-feed-empty')
    await expect(empty).toContainText('No looks in your climate yet')
    await expect(empty.getByRole('button')).toHaveCount(1)
    await expect(page.getByTestId(/^(spotlight-)?lookbook-card-/)).toHaveCount(0)
    await expect(page.getByTestId('community-spotlight-view-more')).toHaveCount(0)
    await expect(page.getByTestId('community-spotlight-error')).toHaveCount(0)
    await empty.getByRole('button', { name: 'See all climates', exact: true }).click()
    await expect(page.getByTestId(`spotlight-lookbook-card-${FIRST_POST}`)).toBeVisible()
    await expect(page.getByTestId(`lookbook-card-${SECOND_POST}`)).toBeVisible()
    await expect(
      page.getByTestId(/^(spotlight-)?lookbook-card-calm-community-peer-/)
    ).toHaveCount(2)
    await expect(empty).toBeHidden()
  })

  test('[P0] [7.15-COM-004] unresolved auto uses the all-climate empty copy', async ({
    page,
    interceptNetworkCall,
  }) => {
    const scene = calmCommunityFixture(true)
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'community',
      community: {
        ...scene,
        feed: (mode) => ({
          ...scene.feed(mode),
          viewerBand: null,
          bandResolved: false,
          bandUnresolvedReason: 'weather_stale',
        }),
      },
    })
    await page.goto('/community')
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('community-feed-empty')).toContainText(
      'No looks shared here yet'
    )
    await expect(page.getByTestId('community-clear-filters')).toHaveCount(0)
  })

  test('[P0] [7.15-COM-003] the report action is reachable when reactions are unavailable', async ({
    page,
    interceptNetworkCall,
  }) => {
    const scene = calmCommunityFixture(false)
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'community',
      community: {
        ...scene,
        feed: (mode) => {
          const feed = scene.feed(mode)
          return {
            ...feed,
            items: feed.items.map((item) => ({ ...item, reactions: undefined })),
          }
        },
      },
    })
    await page.goto('/community')
    await waitForShellSettled(page, router)
    const card = page.getByTestId(`lookbook-card-${SECOND_POST}`)
    await expect(card.getByTestId(`community-reactions-${SECOND_POST}`)).toHaveCount(0)
    await card.getByTestId('community-card-actions').click()
    await card.getByTestId(`report-button-${SECOND_POST}`).click()
    await expect(page.getByTestId('report-reason-select')).toBeVisible()
  })

  test.describe('long locale at compact width', () => {
    test.use({ locale: 'de-DE', viewport: { width: 320, height: 640 } })

    test('[P1] [7.15-COM-005] the empty action and climate sheet fit at 200% text', async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'community',
        community: calmCommunityFixture(true),
      })
      await page.goto('/community')
      await waitForShellSettled(page, router)
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
      await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE')
      await expect(page.locator('html')).toHaveCSS('font-size', '32px')

      const heading = page.getByRole('heading', { name: 'Community', exact: true })
      await assertFitsPhone(heading, 320)
      const post = page.getByRole('button', { name: 'Posten', exact: true })
      await assertFitsPhone(post, 320)
      await post.click({ trial: true })

      const empty = page.getByTestId('community-feed-empty')
      await expect(empty).toContainText('Noch keine Looks in deiner Klimazone')
      const emptyAction = empty.getByRole('button')
      await expect(emptyAction).toHaveAccessibleName('Alle Klimazonen ansehen')
      await assertFitsPhone(emptyAction, 320)
      await emptyAction.click({ trial: true })
      const filter = page.getByTestId('community-climate-filter')
      await assertFitsPhone(filter, 320)
      await filter.click()
      const sheet = page.getByTestId('community-climate-sheet')
      await expect(sheet).toBeVisible()
      for (const mode of CLIMATE_OPTIONS) {
        const option = sheet.getByTestId(`community-filter-${mode}`)
        await assertFitsPhone(option, 320)
        await option.click({ trial: true })
      }
      const widths = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }))
      expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1)
    })
  })
})
