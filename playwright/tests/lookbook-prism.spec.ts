// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 3.5 Task 6 step 4 owner: E2E smoke test responsive layout boundaries across viewports in `playwright/tests/lookbook-prism.spec.ts`
import { log } from '@seontechnologies/playwright-utils/log'
import { test as guestTest } from '../support/fixtures/merged-fixtures'
import { communityTest, expect } from '../support/helpers/community-session'

/**
 * `communityTest`, because the community grid renders only for a signed-in reader.
 * On the bare fixture this spec rendered the SIGNED-OUT panel and every community
 * assertion below was looking at a panel with no grid in it. See
 * `support/helpers/community-session.ts`.
 */
communityTest.describe('Lookbook Prism Responsive Layout (3.5-E2E-001)', () => {
  communityTest(
    'adapts layout grid and controls across desktop and mobile viewports',
    async ({ page, interceptNetworkCall, communitySession }) => {
      expect(communitySession.userId).toBeTruthy()
      void interceptNetworkCall({
        url: '**/api/v1/events/poll*',
        fulfillResponse: {
          status: 200,
          body: { events: [], nextSince: null },
        },
      })

      // Story CC-7.11 D9: Today no longer holds the planner (Plan is the `/looks/plan` route),
      // so this layout spec makes no planner read and needs no planner stub.

      await log.step('Set tablet viewport (1024x900) and verify stacked grid')
      await page.setViewportSize({ width: 1024, height: 900 })
      await page.goto('/')

      const container = page.getByTestId('lookbook-prism-container')
      const heroSection = page.getByRole('region', { name: /hero ritual canvas/i })
      const communitySection = page.getByRole('complementary', {
        name: /community lookbook/i,
      })
      await expect(container).toBeVisible()
      await expect(heroSection).toBeVisible()
      await expect(communitySection).toBeVisible()

      await expect
        .poll(async () => {
          const heroBox = await heroSection.boundingBox()
          const communityBox = await communitySection.boundingBox()
          if (!heroBox || !communityBox) return false
          return communityBox.y >= heroBox.y + heroBox.height - 100
        })
        .toBe(true)

      await log.step('Set desktop viewport (1280x900) and verify side-by-side layout')
      await page.setViewportSize({ width: 1280, height: 900 })
      await expect
        .poll(async () => {
          const heroBox = await heroSection.boundingBox()
          const communityBox = await communitySection.boundingBox()
          if (!heroBox || !communityBox) return false
          return communityBox.x > heroBox.x
        })
        .toBe(true)
      // The two columns share the row evenly and the community column stays on
      // screen. A bare `1fr` track let the hero's chip row claim the whole row.
      const evenColumns = async (viewportWidth: number) => {
        const heroBox = await heroSection.boundingBox()
        const communityBox = await communitySection.boundingBox()
        if (!heroBox || !communityBox) return false
        return (
          Math.abs(heroBox.width - communityBox.width) <= 2 &&
          communityBox.x + communityBox.width <= viewportWidth
        )
      }
      await expect.poll(() => evenColumns(1280)).toBe(true)
      // Story CC-7.11 D9: the drawer that opened here is gone. Today carries no planner at any
      // width, and its Plan week control is a link to the Plan route under Looks.
      const plannerRail = page.getByRole('complementary', { name: /planner rail/i })
      const openControl = page.getByTestId('planner-open-control')
      await expect(plannerRail).toHaveCount(0)
      await expect(openControl).toHaveAttribute('href', '/looks/plan')

      await log.step('Set wide desktop viewport (1440x900) and verify no planner column')
      await page.setViewportSize({ width: 1440, height: 900 })
      // Story CC-7.11 D9: no third planner column at 1440 either; the rail lives on Plan.
      await expect(plannerRail).toHaveCount(0)
      // CC-7.9 D7 (builder decision 2026-11-26): every tab sits on one shared main column,
      // max-w-6xl (1152 px) like the top bar, so at 1440 the lookbook fills that column less its
      // 16 px gutters: 1120 px, centred.
      await expect
        .poll(async () => {
          const box = await container.boundingBox()
          return box?.width ?? 0
        })
        .toBe(1120)
      await expect.poll(() => evenColumns(1440)).toBe(true)

      await expect(page.getByRole('button', { name: /comparison mode/i })).toBeHidden()

      await log.step('Set mobile viewport (700x812) and verify the single-column grid')
      await page.setViewportSize({ width: 700, height: 812 })

      /*
       * This step used to compare the bounding boxes of two `article` elements,
       * which only ever worked because `MOCK_LOOKBOOK_ITEMS` guaranteed five cards
       * were on the page. Story 6.1 removed those mocks, and a real card cannot be
       * put on this page from a test today (see the file header of
       * `community-feed.spec.ts` for the two blockers), so a card-count assertion
       * here would be asserting the emptiness rather than the layout.
       *
       * The responsive contract itself does not need cards: it is the grid's own
       * track count, which the container declares whether or not anything is in it.
       * Asserting the computed `grid-template-columns` resolves to ONE track is the
       * same claim the box comparison was making, and it holds for a feed of five
       * posts or of none.
       */
      const grid = page.getByTestId('community-card-grid')
      // Attached rather than visible: the container is always rendered for a
      // signed-in reader but has no layout box while the feed is empty, and its
      // computed `grid-template-columns` is readable either way.
      await expect(grid).toBeAttached()
      await expect
        .poll(async () => {
          const columns = await grid.evaluate(
            (element) => window.getComputedStyle(element).gridTemplateColumns
          )
          return columns.trim().split(/\s+/).length
        })
        .toBe(1)

      await log.step('Set desktop viewport (1280x900) and verify the multi-column grid')
      await page.setViewportSize({ width: 1280, height: 900 })
      await expect
        .poll(async () => {
          const columns = await grid.evaluate(
            (element) => window.getComputedStyle(element).gridTemplateColumns
          )
          return columns.trim().split(/\s+/).length
        })
        .toBeGreaterThan(1)

      await expect(page.locator('h1')).toHaveCount(1)
    }
  )
})

guestTest.describe('Guest outfit comparison', () => {
  guestTest.use({ authSessionEnabled: false })

  guestTest('opens comparison controls for the guest example', async ({ page }) => {
    await page.goto('/')
    const comparisonToggle = page.getByRole('button', { name: /comparison mode/i })
    await expect(comparisonToggle).toBeVisible()
    await comparisonToggle.click()
    await expect(page.getByTestId('comparison-container')).toBeVisible()
    await expect(comparisonToggle).toHaveAttribute('aria-pressed', 'true')
  })
})
