// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Story 3.5 Task 6 step 4 owner: E2E smoke test responsive layout boundaries across viewports in playwright/tests/lookbook-prism.spec.ts
import { log } from '@seontechnologies/playwright-utils/log'
import { communityTest, expect } from '../support/helpers/community-session'

/**
 * Story 6.1 note on the session. This spec used the bare fixture and therefore
 * rendered the SIGNED-OUT community panel ("Sign in to take part in the
 * community."), because `apps/web/src/lib/community.ts` reads
 * `sessionStorage[couturecast.access-token]` as its sole credential and
 * `merged-fixtures.ts`'s auth-session fixture does not write that key. Every
 * community assertion below was therefore looking at a panel with no grid in it,
 * which is indistinguishable from a broken render. `communityTest` writes the key
 * the app actually reads.
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

      /*
       * The planner read is stubbed to restore this spec's original scope rather
       * than to hide a failure. Signing the spec in (which the community grid
       * assertion below requires) also made the planner rail's own fetch real,
       * and a fresh account has no Premium entitlement, so opening the drawer
       * issues a genuine 403 that `networkErrorMonitor` — correctly — fails on.
       * That 403 is proven where it belongs, in `planner.spec.ts` and in the
       * Pact planner interactions; here the rail is scenery for a LAYOUT
       * assertion, and it renders its drawer either way.
       *
       * Seven `error` days rather than seven ready ones: it is the smallest body
       * the contract accepts, and this spec asserts nothing about day content.
       */
      const plannerWindow = [
        '2026-07-16',
        '2026-07-17',
        '2026-07-18',
        '2026-07-19',
        '2026-07-20',
        '2026-07-21',
        '2026-07-22',
      ]
      void interceptNetworkCall({
        url: '**/api/v1/commerce/premium/planner*',
        fulfillResponse: {
          status: 200,
          body: {
            data: {
              locationId: 'loc-1',
              timezone: 'America/Chicago',
              anchorDate: plannerWindow[0],
              daysReady: 0,
              days: plannerWindow.map((planDate) => ({
                status: 'error',
                planDate,
                errorCode: 'generation_failed',
                retryable: true,
              })),
            },
          },
        },
      })

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
      // Story 5.5 Decision 7: closed by default. Below 1440px the planner is
      // reachable as a focus-trapped overlay drawer, not simply hidden.
      const plannerRail = page.getByRole('complementary', { name: /planner rail/i })
      const openControl = page.getByTestId('planner-open-control')
      await expect(plannerRail).toBeHidden()
      await openControl.click()
      await expect(plannerRail).toBeVisible()
      await page.getByRole('button', { name: /close planner/i }).click()
      await expect(plannerRail).toBeHidden()

      await log.step(
        'Set wide desktop viewport (1440x900) and verify planner rail visibility'
      )
      await page.setViewportSize({ width: 1440, height: 900 })
      await openControl.click()
      await expect(plannerRail).toBeVisible()
      await expect
        .poll(async () => {
          const box = await container.boundingBox()
          return box?.width ?? 0
        })
        .toBeGreaterThanOrEqual(1300)

      await log.step('Toggle comparison mode and verify comparison view container')
      const comparisonToggle = page.getByRole('button', { name: /comparison mode/i })
      await expect(comparisonToggle).toBeVisible()
      await comparisonToggle.click()
      await expect(page.getByTestId('comparison-container')).toBeVisible()

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
