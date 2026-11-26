// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-020..036 and 7.11-E2E-060, a top bar with a back
// arrow and a title on every named sub-screen, back to the parent in-app and on direct entry,
// and the parent's scroll on return. Garment detail's in-app back, scroll and focus stay proved
// by wardrobe-garment-detail.spec.ts (7.5-E2E-001); its direct entry is a row here.
// Native twin: apps/mobile/src/components/app-top-bar.routing.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  openFixtureShell,
  SHELL_TABS,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { FOLD_VIEWPORT } from '../support/helpers/five-tab'
import type { ShellMode, ShellScreen } from '../support/helpers/shell-fixtures'

test.use({
  authSessionEnabled: false,
  viewport: FOLD_VIEWPORT,
  isMobile: true,
  hasTouch: true,
})

type SubScreen = {
  name: string
  path: string
  parent: ShellScreen
  /** The title the top bar reads; any text when the catalog owns it beyond this story. */
  title: RegExp
  /** How a member reaches it from its parent tab; null when no in-app link exists on web. */
  enter: ((page: Page) => Promise<void>) | null
}

const viaMore = (item: string) => async (page: Page) => {
  await page.getByTestId('closet-more-menu').click()
  await page.getByTestId(item).click()
}
const viaTestId = (id: string) => async (page: Page) => {
  await page.getByTestId(id).click()
}
const viaStyle = (row: string) => async (page: Page) => {
  await page.getByTestId('profile-style-row').click()
  await expect(page).toHaveURL(/\/settings\/style$/)
  await page.getByTestId(row).click()
}

/** D10: every named web sub-screen with a URL and its parent tab. */
const SUB_SCREENS: SubScreen[] = [
  {
    name: 'garment detail',
    path: '/wardrobe?garment=shell-garment-1',
    parent: 'closet',
    title: /\S/,
    enter: null,
  },
  {
    name: 'closet setup',
    path: '/wardrobe/onboarding',
    parent: 'closet',
    title: /^Closet setup$/,
    enter: viaMore('closet-more-setup'),
  },
  {
    name: 'silhouette',
    path: '/wardrobe/silhouette',
    parent: 'closet',
    title: /^Silhouette$/,
    enter: viaMore('closet-more-silhouette'),
  },
  {
    name: 'capsules',
    path: '/wardrobe/capsules',
    parent: 'looks',
    title: /^Outfit capsules$/,
    enter: viaTestId('looks-capsules-row'),
  },
  {
    name: 'plan',
    path: '/looks/plan',
    parent: 'looks',
    title: /^Plan$/,
    enter: viaTestId('looks-plan-row'),
  },
  {
    name: 'style',
    path: '/settings/style',
    parent: 'profile',
    title: /^Style$/,
    enter: viaTestId('profile-style-row'),
  },
  {
    name: 'color palette',
    path: '/palette',
    parent: 'profile',
    title: /^Color palette$/,
    enter: null,
  },
  {
    name: 'notification settings',
    path: '/notification-settings',
    parent: 'profile',
    title: /\S/,
    enter: null,
  },
  {
    name: 'guardian dashboard',
    path: '/guardian/dashboard',
    parent: 'profile',
    title: /\S/,
    enter: null,
  },
  {
    name: 'teen dashboard',
    path: '/teen/dashboard',
    parent: 'profile',
    title: /\S/,
    enter: null,
  },
]

/**
 * Sub-screens read more than the CC-7.7 shell fixtures serve. Registered first, so the shell
 * router (registered after, answering first) keeps every read it knows; the rest get an empty
 * page instead of a fixture member's 404 from the local API. The back control is what these
 * tests assert, and it sits outside each screen's content gate.
 */
async function serveUnknownReadsEmpty(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ json: { data: [], total: 0, limit: 20, offset: 0 } })
  })
}

async function open(
  page: Page,
  interceptNetworkCall: Parameters<typeof openFixtureShell>[1],
  screen: ShellScreen,
  mode: ShellMode = 'populated'
) {
  await serveUnknownReadsEmpty(page)
  return openFixtureShell(page, interceptNetworkCall, { mode, screen })
}

async function expectTopBar(page: Page, title: RegExp) {
  await expect(page.getByTestId('app-top-bar-back')).toBeVisible()
  await expect(page.getByTestId('app-top-bar-title')).toHaveText(title)
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

test.describe('CC-7.11 back on every sub-screen @local-lane', () => {
  for (const sub of SUB_SCREENS.filter((row) => row.enter !== null)) {
    test(`[P0] [7.11-E2E-020] ${sub.name}: in-app from ${sub.parent}, top bar with back and title, back returns to ${sub.parent}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router, setScreen } = await open(page, interceptNetworkCall, sub.parent)
      await page.goto(SHELL_TABS[sub.parent].path)
      await waitForShellSettled(page, router)

      await sub.enter!(page)
      await expect(page).toHaveURL(new RegExp(`${sub.path.replace(/[?]/g, '\\?')}$`))
      await expectTopBar(page, sub.title)

      setScreen(sub.parent)
      await page.getByTestId('app-top-bar-back').click()
      // Style is entered through Profile; palette-style two-level rows are E2E-033.
      await expect(page).toHaveURL(new RegExp(`${SHELL_TABS[sub.parent].path}$`))
      await expect(page.getByTestId(SHELL_TABS[sub.parent].nav)).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  }

  for (const mode of ['populated', 'guardian-pending'] as const) {
    for (const sub of SUB_SCREENS) {
      test(`[P0] [7.11-E2E-021/036/060] ${sub.name}, ${mode}: direct entry, back replaces to ${sub.parent}`, async ({
        page,
        interceptNetworkCall,
      }) => {
        const { router } = await open(page, interceptNetworkCall, sub.parent, mode)
        await page.goto(sub.path)
        await expectTopBar(page, sub.title)
        const entries = await page.evaluate(() => history.length)

        await page.getByTestId('app-top-bar-back').click()
        await expect(page).toHaveURL(new RegExp(`${SHELL_TABS[sub.parent].path}$`))
        await waitForShellSettled(page, router)
        await expect(page.getByTestId(SHELL_TABS[sub.parent].nav)).toHaveAttribute(
          'aria-current',
          'page'
        )
        // A replace, not a push: the back arrow never grows history on a cold entry.
        expect(await page.evaluate(() => history.length)).toBe(entries)
      })
    }
  }
})

test.describe('CC-7.11 parent scroll on return @local-lane', () => {
  for (const how of ['arrow', 'browser'] as const) {
    test(`[P0] [7.11-E2E-030/031] Closet scrolled, open Silhouette, ${how} back: Closet at the same offset`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router, setScreen } = await open(page, interceptNetworkCall, 'closet')
      await page.goto(SHELL_TABS.closet.path)
      await waitForShellSettled(page, router)
      await page.evaluate(() => window.scrollTo(0, 1200))
      await expect.poll(() => scrollY(page)).toBe(1200)

      // The More button rides in the sticky top bar, so it is reachable at any scroll.
      await viaMore('closet-more-silhouette')(page)
      await expect(page).toHaveURL(/\/wardrobe\/silhouette$/)
      setScreen('closet')
      if (how === 'arrow') await page.getByTestId('app-top-bar-back').click()
      else await page.goBack()

      await expect(page).toHaveURL(/\/wardrobe$/)
      await waitForShellSettled(page, router)
      await expect
        .poll(() => scrollY(page), { message: 'Closet scroll restored' })
        .toBe(1200)
    })
  }

  test('[P1] [7.11-E2E-032] Community post detail layer: browser back closes it, URL and scroll unchanged', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await open(page, interceptNetworkCall, 'community')
    await page.goto(SHELL_TABS.community.path)
    await waitForShellSettled(page, router)
    const opener = page.getByTestId('lookbook-open-shell-look-2')
    await opener.scrollIntoViewIfNeeded()
    const before = await scrollY(page)
    const url = page.url()

    await opener.click()
    const layer = page.getByTestId('community-detail')
    await expect(layer).toBeVisible()
    await expectTopBar(page, /\S/)

    await page.goBack()
    await expect(layer).toHaveCount(0)
    expect(page.url()).toBe(url)
    await expect.poll(() => scrollY(page)).toBe(before)
    await expect(opener).toBeFocused()
  })

  test('[P1] [7.11-E2E-033] two levels: Profile > Style > Color palette, back twice, arrow and browser agree', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await open(page, interceptNetworkCall, 'profile')
    await page.goto(SHELL_TABS.profile.path)
    await waitForShellSettled(page, router)

    await viaStyle('style-row-palette')(page)
    await expect(page).toHaveURL(/\/palette$/)
    await expectTopBar(page, /^Color palette$/)
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/settings\/style$/)
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/settings$/)

    // Same walk with browser back.
    await viaStyle('style-row-palette')(page)
    await expect(page).toHaveURL(/\/palette$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\/style$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('[P1] [7.11-E2E-034] reload on a sub-screen after in-app entry: back still lands on the parent', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await open(page, interceptNetworkCall, 'closet')
    await page.goto(SHELL_TABS.closet.path)
    await waitForShellSettled(page, router)
    await viaMore('closet-more-silhouette')(page)
    await expect(page).toHaveURL(/\/wardrobe\/silhouette$/)

    await page.reload()
    await expectTopBar(page, /^Silhouette$/)
    await page.getByTestId('app-top-bar-back').click()
    await expect(page).toHaveURL(/\/wardrobe$/)
    await expect(page.getByTestId('bottom-nav-wardrobe')).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('[P1] [7.11-E2E-034] a tab opened from a link starts with no in-app history: back replaces to the parent', async ({
    page,
    context,
    interceptNetworkCall,
  }) => {
    const { router } = await open(page, interceptNetworkCall, 'closet')
    await page.goto(SHELL_TABS.closet.path)
    await waitForShellSettled(page, router)
    await viaMore('closet-more-silhouette')(page)
    await expect(page).toHaveURL(/\/wardrobe\/silhouette$/)

    // P1: a link-opened tab shares sessionStorage (no noopener) but not history; the arrow must
    // not trust a stored stack there.
    const [opened] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => {
        window.open('/wardrobe/capsules', '_blank')
      }),
    ])
    await opened.waitForLoadState()
    await expect(opened.getByTestId('app-top-bar-back')).toBeVisible()
    await opened.getByTestId('app-top-bar-back').click()
    await expect(opened).toHaveURL(/\/looks$/)
  })
})
