// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.6 Task 6 step 1 owner: E2E test sticky bottom nav viewport visibility, chip keyboard navigation, and reduced motion in `playwright/tests/chip-navigation-bottom-nav.spec.ts`
import { openCommunityClimate } from '../support/helpers/community-ui'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import {
  communityTest as test,
  completedCommunityFeed,
  expect,
  expectCommunityFeedLoaded,
} from '../support/helpers/community-session'

test.describe('Sticky bottom navigation (Story 3.6)', () => {
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
    // Story CC-7.11 D1, D2: the Home tab reads Today and draws an inline svg icon, no emoji.
    await expect(activeHomeTab).toHaveAccessibleName(enUS.nav.today)
    await expect(activeHomeTab.locator('svg')).toHaveCount(1)
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
  })

  /*
   * Production follow-up after the project close (2026-11-19). A tester on Android
   * Chrome (448 px) tapped the Community tab four times and reported "community is
   * empty": `/community` was still the Story 3.6 placeholder, a dark page holding
   * only the word "Community", while the lookbook lived on Home alone. This walks
   * her path: Home, tap the bottom-nav Community tab, and expect the lookbook
   * itself, with the renamed heading, the climate explainer and a loaded feed.
   */
  test('3.6-E2E-007: the bottom-nav Community tab opens the community lookbook on a phone', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    await page.setViewportSize({ width: 448, height: 900 })
    await page.goto('/')

    // No response listener here: Home can start a second feed read that lands
    // after the tap, and its body is gone once the page navigates, so a listener
    // could bind to Home's read and fail. The looks rendered inside the
    // Community page are the proof, and the network monitor fails any 4xx/5xx.
    await page.getByTestId('bottom-nav-community').click()
    await expect(page).toHaveURL('/community')
    await expect(page.getByTestId('bottom-nav-community')).toHaveAttribute(
      'aria-current',
      'page'
    )

    const communityPage = page.getByTestId('community-page')
    // CC-7.9 D6: the title is the top bar's h1, above the page's main column.
    await expect(
      page.getByTestId('app-header').getByRole('heading', { level: 1 })
    ).toHaveText('Community')

    const filters = await openCommunityClimate(page)
    const explainer = filters.getByTestId('community-filters-explainer')
    await expect(explainer).toHaveText(enUS.community.filters.explainer)
    await expect(
      page.getByRole('dialog', { name: 'Filter looks' })
    ).toHaveAccessibleDescription(enUS.community.filters.explainer)
    await expect(filters.getByTestId('community-filter-cold_wet')).toHaveText(
      'Cold and wet'
    )

    await page.keyboard.press('Escape')
    // A real card inside the card grid; the loading skeletons sit outside it.
    await expectCommunityFeedLoaded(page, communityPage)
    await expect(communityPage.getByTestId('community-feed-empty')).toHaveCount(0)
  })

  test('3.6-E2E-008: /community keeps its filter and links back to Today on desktop', async ({
    page,
    communitySession,
  }) => {
    expect(communitySession.userId).toBeTruthy()
    const feedOnCommunity = completedCommunityFeed(page)
    await page.goto('/community')
    expect((await feedOnCommunity).status).toBe(200)
    await expectCommunityFeedLoaded(page)
    await expect(page.getByTestId('community-climate-filter')).toBeVisible()

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTestId('sticky-bottom-nav')).toBeHidden()
    // CC-7.9 D6: the desktop tab links live in the top bar's trailing slot.
    const home = page.getByTestId('primary-nav').getByTestId('nav-ritual')
    await expect(home).toBeVisible()
    // Story CC-7.11 D1: the desktop link to `/` reads Today.
    await expect(home).toHaveAccessibleName(enUS.nav.today)
    await home.click()
    await expect(page).toHaveURL('/')
  })
})
