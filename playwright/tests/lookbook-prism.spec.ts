// Story 3.5 Task 6 step 4 owner: E2E smoke test responsive layout boundaries across viewports in playwright/tests/lookbook-prism.spec.ts
import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('Lookbook Prism Responsive Layout (3.5-E2E-001)', () => {
  test('adapts layout grid and controls across desktop and mobile viewports', async ({
    page,
  }) => {
    await page.route('**/api/v1/events/poll*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], nextSince: null }),
      })
    )

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

    const tabletHeroBox = await heroSection.boundingBox()
    const tabletCommunityBox = await communitySection.boundingBox()
    expect(tabletCommunityBox?.y).toBeGreaterThanOrEqual(
      (tabletHeroBox?.y ?? 0) + (tabletHeroBox?.height ?? 0)
    )

    await page.setViewportSize({ width: 1280, height: 900 })
    const desktopHeroBox = await heroSection.boundingBox()
    const desktopCommunityBox = await communitySection.boundingBox()
    expect(desktopCommunityBox?.x).toBeGreaterThan(
      (desktopHeroBox?.x ?? 0) + (desktopHeroBox?.width ?? 0) / 2
    )
    await expect(page.getByRole('complementary', { name: /planner rail/i })).toBeHidden()

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('complementary', { name: /planner rail/i })).toBeVisible()
    expect((await container.boundingBox())?.width).toBeGreaterThanOrEqual(1300)

    const comparisonToggle = page.getByRole('button', { name: /comparison mode/i })
    await expect(comparisonToggle).toBeVisible()
    await comparisonToggle.click()
    await expect(page.getByTestId('comparison-container')).toBeVisible()

    await page.setViewportSize({ width: 700, height: 812 })
    const cards = communitySection.locator('article')
    const firstCardBox = await cards.nth(0).boundingBox()
    const secondCardBox = await cards.nth(1).boundingBox()
    expect(secondCardBox?.y).toBeGreaterThanOrEqual(
      (firstCardBox?.y ?? 0) + (firstCardBox?.height ?? 0)
    )
    await expect(page.locator('h1')).toHaveCount(1)
  })
})
