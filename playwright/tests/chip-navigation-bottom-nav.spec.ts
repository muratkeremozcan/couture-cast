// Story 3.6 Task 6 step 1 owner: E2E test sticky bottom nav viewport visibility, chip keyboard navigation, and reduced motion in playwright/tests/chip-navigation-bottom-nav.spec.ts
import { test, expect } from '../support/fixtures/merged-fixtures'

test.describe('Chip Navigation & Sticky Bottom Nav (Story 3.6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/events/poll**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [],
          nextSince: new Date(0).toISOString(),
        }),
      })
    })
  })

  test('3.6-E2E-001: mobile sticky bottom nav visibility across viewports', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    const bottomNav = page.getByTestId('sticky-bottom-nav')
    await expect(bottomNav).toBeVisible()
    await expect(bottomNav).toBeInViewport()

    const activeHomeTab = page.getByTestId('bottom-nav-home')
    await expect(activeHomeTab).toHaveAttribute('aria-current', 'page')
    await expect(activeHomeTab.getByTestId('gold-active-indicator')).toBeVisible()

    await page.getByTestId('bottom-nav-community').click()
    await expect(page).toHaveURL('/community')
    await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible()
    await expect(page.getByTestId('bottom-nav-community')).toHaveAttribute(
      'aria-current',
      'page'
    )

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTestId('sticky-bottom-nav')).toBeHidden()

    await page.goto('/')
    await page.getByRole('button', { name: 'Mobile Preview' }).click()

    const preview = page.getByTestId('lookbook-prism-container')
    const previewNav = preview.getByTestId('sticky-bottom-nav')
    await expect(previewNav).toBeVisible()
    await expect(previewNav).toHaveCSS('position', 'sticky')
    await expect(preview).toHaveCSS('overflow-y', 'auto')
  })

  test('3.6-E2E-002: chip navigation bar sticky positioning and click state updates', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    const chipBar = page.getByTestId('chip-navigation-bar')
    await expect(chipBar).toBeVisible()

    const personalChip = page.getByTestId('chip-personal')
    const communityChip = page.getByTestId('chip-community')
    const heroTitle = page.getByTestId('hero-recommendation-title')

    await expect(personalChip).toHaveAttribute('aria-pressed', 'true')
    await expect(communityChip).toHaveAttribute('aria-pressed', 'false')
    await expect(heroTitle).toHaveText('Double-Breasted Blazer & Silk Knit')
    await expect(page.getByText('Milan Autumn Wool Trench')).toBeVisible()

    await chipBar.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, top + 200)
    })
    await expect.poll(async () => (await chipBar.boundingBox())?.y).toBeLessThanOrEqual(1)

    const lookbookFilters = page.getByRole('navigation', {
      name: 'Lookbook Filters',
    })
    await expect
      .poll(async () => {
        const chipBox = await chipBar.boundingBox()
        const filterBox = await lookbookFilters.boundingBox()
        if (!chipBox || !filterBox) {
          return -1
        }
        return filterBox.y - (chipBox.y + chipBox.height)
      })
      .toBeGreaterThanOrEqual(0)

    await communityChip.click()
    await expect(communityChip).toHaveAttribute('aria-pressed', 'true')
    await expect(personalChip).toHaveAttribute('aria-pressed', 'false')
    await expect(heroTitle).toHaveText('Parisian Silk & Cashmere Blend')
    await expect(page.getByText('Parisian Silk & Cashmere Blend').last()).toBeVisible()
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'data-chip-category',
      'Community'
    )

    const liveRegion = chipBar.getByRole('status')
    await expect(liveRegion).toHaveText('Showing Community recommendations')
  })

  test('3.6-E2E-003: keyboard arrow navigation across chips and focus ring styling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto('/')

    const personalChip = page.getByTestId('chip-personal')
    const communityChip = page.getByTestId('chip-community')

    await personalChip.focus()
    await expect(personalChip).toBeFocused()

    await page.keyboard.press('ArrowRight')
    await expect(communityChip).toBeFocused()
    await expect(communityChip).toHaveAttribute('aria-pressed', 'true')
    await expect(communityChip).toHaveAttribute('tabindex', '0')
    await expect(personalChip).toHaveAttribute('tabindex', '-1')
    await expect(communityChip).toHaveCSS('outline-color', 'rgb(17, 17, 17)')
    await expect(communityChip).toHaveCSS(
      'box-shadow',
      'rgb(201, 161, 74) 0px 0px 0px 4px'
    )

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'New' })).toBeFocused()
  })

  test('3.6-E2E-004: respects prefers-reduced-motion media feature', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    const chipBar = page.getByTestId('chip-navigation-bar')
    await expect(chipBar).toBeVisible()

    const communityChip = page.getByTestId('chip-community')
    await communityChip.click()
    await expect(communityChip).toHaveAttribute('aria-pressed', 'true')
    await expect(communityChip).toHaveCSS('transition-property', 'none')
  })
})
