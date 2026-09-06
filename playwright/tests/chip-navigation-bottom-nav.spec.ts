// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
import { communityTest as test, expect } from '../support/helpers/community-session'

/**
 * This file asserts the chip's effect on `data-chip-category`, which lives on
 * `community-card-grid`, and that grid renders only for a signed-in reader. See
 * `support/helpers/community-session.ts`.
 */
test.describe('Chip Navigation & Sticky Bottom Nav (Story 3.6)', () => {
  test.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: {
          events: [],
          nextSince: new Date(0).toISOString(),
        },
      },
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
    recurse,
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
    // Story 6.1 removed `MOCK_LOOKBOOK_ITEMS`, so no hardcoded look renders for any
    // chip. `data-chip-category` carries the chip's observable effect on the grid,
    // which is what this step is about.
    await expect(page.getByTestId('community-card-grid')).toHaveAttribute(
      'data-chip-category',
      'Personal'
    )

    await chipBar.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY
      window.scrollTo(0, top + 200)
    })
    await recurse(
      async () => (await chipBar.boundingBox())?.y,
      (y) => y !== undefined && y <= 1
    )

    // Story 6.1 renamed this landmark: its `aria-label` is
    // `t('community.filters.label')`, "Community filters" in en-US, because the nav
    // it labels is the climate-band filter set.
    const lookbookFilters = page.getByRole('navigation', {
      name: 'Community filters',
    })
    await recurse(
      async () => {
        const chipBox = await chipBar.boundingBox()
        const filterBox = await lookbookFilters.boundingBox()
        if (!chipBox || !filterBox) {
          return -1
        }
        return filterBox.y - (chipBox.y + chipBox.height)
      },
      (delta) => delta >= 0
    )

    await communityChip.click()
    await expect(communityChip).toHaveAttribute('aria-pressed', 'true')
    await expect(personalChip).toHaveAttribute('aria-pressed', 'false')
    await expect(heroTitle).toHaveText('Parisian Silk & Cashmere Blend')
    // The `.last()` copy of this string was a mock community card. Only the hero
    // renders it now, and the line above already asserts that.
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

    // The roving-tabindex contract: one Tab exits the whole chip group. Asserting
    // it directly, without naming whatever button sits after the group, survives a
    // rename. `accessibility-hardening.spec.ts` states the same contract the same
    // way.
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).not.toHaveAttribute('data-testid', /chip-/)
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
