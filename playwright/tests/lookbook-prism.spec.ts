// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Story 3.5 Task 6 step 4 owner: E2E smoke test responsive layout boundaries across viewports in playwright/tests/lookbook-prism.spec.ts
import { log } from '@seontechnologies/playwright-utils/log'
import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('Lookbook Prism Responsive Layout (3.5-E2E-001)', () => {
  test('adapts layout grid and controls across desktop and mobile viewports', async ({
    page,
    interceptNetworkCall,
  }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll*',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: null },
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

    await log.step('Set mobile viewport (700x812) and verify single column cards')
    await page.setViewportSize({ width: 700, height: 812 })
    const cards = communitySection.locator('article')
    await expect
      .poll(async () => {
        const firstCardBox = await cards.nth(0).boundingBox()
        const secondCardBox = await cards.nth(1).boundingBox()
        if (!firstCardBox || !secondCardBox) return false
        return secondCardBox.y >= firstCardBox.y + firstCardBox.height
      })
      .toBe(true)
    await expect(page.locator('h1')).toHaveCount(1)
  })
})
