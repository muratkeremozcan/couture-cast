// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-020..036 and 7.11-E2E-060, a top bar with a back
// arrow and a title on every named sub-screen, back to the parent in-app and on direct entry,
// and the parent's scroll on return. Garment detail's in-app back, scroll and focus stay proved
// by wardrobe-garment-detail.spec.ts (7.5-E2E-001); its direct entry is a row here.
// Native twin: apps/mobile/src/components/app-top-bar.routing.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Story CC-7.12 (Step 69): capsules moved to /looks/capsules (back to Saved > Capsules), the saved
// look detail /looks/saved/ID is a new row, and Plan is a Looks segment reached by redirect.
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  openFixtureShell,
  SHELL_TABS,
  VISUAL_MEMBER_ID,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { FOLD_VIEWPORT } from '../support/helpers/five-tab'
import {
  bodies,
  SHELL_SAVED_LOOK_ID,
  type ShellMode,
  type ShellScreen,
} from '../support/helpers/shell-fixtures'

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
  /** Story CC-7.12: the address an in-app entry lands on, when it is not `path` itself. */
  enteredPath?: RegExp
  /**
   * Story CC-7.12 D5, D6: where back lands, when it is not the parent tab's bare path. An in-app
   * entry steps back to the entry below it; a direct entry replaces to the top bar's parent.
   */
  backTo?: { inApp: RegExp; direct: RegExp }
  /**
   * Codex 7.11 #15: the screen's own content, so a direct entry proves more than a header
   * outside its gate. Rows without one fall back to visible text in the page body.
   */
  content?: (page: Page, mode: ShellMode) => ReturnType<Page['getByTestId']>
  /**
   * The guardian and teen dashboards read the profile with the cookie session
   * (`credentials: 'include'`, no bearer), which the shell router refuses with 401; they get
   * the same fixture profile by path.
   */
  cookieProfile?: boolean
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
    content: (page) => page.getByTestId('silhouette-settings-panel'),
  },
  {
    // Story CC-7.12 D6: the manager moved under Looks and is entered from Saved > Capsules.
    name: 'capsules',
    path: '/looks/capsules',
    parent: 'looks',
    title: /^Outfit capsules$/,
    enter: async (page) => {
      await page.getByTestId('looks-filter-capsules').click()
      await expect(page).toHaveURL(/\/looks\?segment=saved&filter=capsules$/)
      await page.getByTestId('looks-manage-capsules').click()
    },
    content: (page) => page.getByTestId('create-capsule-button'),
    backTo: {
      inApp: /\/looks\?segment=saved&filter=capsules$/,
      direct: /\/looks\?segment=saved&filter=capsules$/,
    },
  },
  {
    // Story CC-7.12 D5: the saved look's own screen replaced the CC-7.11 Plan row (Plan is a
    // Looks segment now; its redirect is the test after this table's loops).
    name: 'saved look detail',
    path: `/looks/saved/${SHELL_SAVED_LOOK_ID}`,
    parent: 'looks',
    title: /\S/,
    enter: viaTestId(`saved-look-card-${SHELL_SAVED_LOOK_ID}`),
    enteredPath: new RegExp(`/looks/saved/${SHELL_SAVED_LOOK_ID}\\?from=all$`),
    // A guardian-pending teen has no saved look, so the id reads like a removed one (P6).
    content: (page, mode) =>
      mode === 'guardian-pending'
        ? page.getByTestId('saved-look-detail-gone')
        : page.getByTestId('saved-look-detail'),
    backTo: { inApp: /\/looks$/, direct: /\/looks\?segment=saved$/ },
  },
  {
    name: 'style',
    path: '/settings/style',
    parent: 'profile',
    title: /^Style$/,
    enter: viaTestId('profile-style-row'),
    content: (page) => page.getByTestId('style-rows'),
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
    // Codex 7.11 #9: Profile holds the entry; the Community header link stays as a second one.
    enter: viaTestId('profile-notifications-row'),
  },
  {
    name: 'guardian dashboard',
    path: '/guardian/dashboard',
    parent: 'profile',
    cookieProfile: true,
    title: /\S/,
    enter: null,
  },
  {
    name: 'teen dashboard',
    path: '/teen/dashboard',
    parent: 'profile',
    cookieProfile: true,
    title: /\S/,
    enter: null,
    // The guardian-pending teen sees the intended consent state, not a blank screen.
    content: (page, mode) =>
      mode === 'guardian-pending'
        ? page.getByText('Guardian consent pending')
        : page.locator('main'),
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
  mode: ShellMode = 'populated',
  sub?: SubScreen
) {
  await serveUnknownReadsEmpty(page)
  const shell = await openFixtureShell(page, interceptNetworkCall, { mode, screen })
  if (sub?.cookieProfile) {
    const teenPending = mode === 'guardian-pending'
    const { json } = bodies(
      VISUAL_MEMBER_ID,
      !teenPending && mode !== 'empty',
      teenPending
    )
    await page.route('**/api/v1/user/profile', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: json.profile })
        : route.fallback()
    )
  }
  return shell
}

/** The top bar on screen: a layer's own when one is open, else the page's. */
async function expectTopBar(page: Page, title: RegExp) {
  const scope = (await page.getByRole('dialog').count())
    ? page.getByRole('dialog')
    : page.getByTestId('app-header')
  await expect(scope.getByTestId('app-top-bar-back')).toBeVisible()
  await expect(scope.getByTestId('app-top-bar-title')).toHaveText(title)
}

/** The sub-screen rendered its own content below the top bar, not only its header. */
async function expectOwnContent(page: Page, sub: SubScreen, mode: ShellMode) {
  if (sub.content) {
    await expect(sub.content(page, mode).first(), `${sub.name} content`).toBeVisible()
    return
  }
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const header = document.querySelector('[data-testid="app-header"]')
          const main = document.querySelector('main') ?? document.body
          return Array.from(
            main.querySelectorAll<HTMLElement>('h2, h3, p, button, a, label')
          )
            .filter((node) => !header?.contains(node) && node.offsetParent !== null)
            .filter((node) => (node.textContent ?? '').trim().length > 0).length
        }),
      { message: `${sub.name} renders content below its top bar` }
    )
    .toBeGreaterThan(0)
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
      await expect(page).toHaveURL(
        sub.enteredPath ?? new RegExp(`${sub.path.replace(/[?]/g, '\\?')}$`)
      )
      await expectTopBar(page, sub.title)

      setScreen(sub.parent)
      await page.getByTestId('app-top-bar-back').click()
      // Style is entered through Profile; palette-style two-level rows are E2E-033.
      await expect(page).toHaveURL(
        sub.backTo?.inApp ?? new RegExp(`${SHELL_TABS[sub.parent].path}$`)
      )
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
        if (sub.name === 'saved look detail' && mode === 'guardian-pending')
          test.info().annotations.push({
            type: 'skipNetworkMonitoring',
            description:
              'The teen has no saved look, so the one-look read answers 404 and the screen reads like a removed look (CC-7.12 P6).',
          })
        const { router } = await open(page, interceptNetworkCall, sub.parent, mode, sub)
        await page.goto(sub.path)
        await expectTopBar(page, sub.title)
        await expectOwnContent(page, sub, mode)
        const entries = await page.evaluate(() => history.length)

        await page.getByTestId('app-top-bar-back').click()
        await expect(page).toHaveURL(
          sub.backTo?.direct ?? new RegExp(`${SHELL_TABS[sub.parent].path}$`)
        )
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

  test('[P0] [7.11-E2E-020/021] [7.12-E2E-035] Plan: /looks/plan opens the Looks Plan segment, a tab with no back arrow', async ({
    page,
    interceptNetworkCall,
  }) => {
    // Story CC-7.12 D11: the CC-7.11 Plan sub-screen (top bar back, title Plan) became a Looks
    // segment. Its old address redirects there, and the planner renders inside Looks.
    const { router } = await open(page, interceptNetworkCall, 'looks')
    await page.goto('/looks/plan')
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await waitForShellSettled(page, router)
    await expect(page.getByTestId('looks-segment-plan')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(
      page.getByTestId('app-header').getByTestId('app-top-bar-back')
    ).toHaveCount(0)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText(/^Looks$/)
    await expect(page.getByTestId(SHELL_TABS.looks.nav)).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(
      page
        .getByTestId('looks-first-content')
        .getByRole('complementary', { name: 'Planner Rail' })
    ).toBeVisible()
  })
})

test.describe('CC-7.11 parent scroll on return @local-lane', () => {
  for (const how of ['arrow', 'browser'] as const) {
    test(`[P0] [7.11-E2E-030/031] Closet scrolled, open a garment from depth, ${how} back: Closet at the same offset, focus on the tile`, async ({
      page,
      interceptNetworkCall,
    }) => {
      // D14 and the spec's I/O row "Closet scrolled, open garment, back". The top bar does not
      // stick (builder decision), so a sub-screen is opened from a control at depth: a tile
      // far down the grid. Leaving through More scrolls to the top first, so it proves nothing.
      const { router, setScreen } = await open(page, interceptNetworkCall, 'closet')
      await page.goto(SHELL_TABS.closet.path)
      await waitForShellSettled(page, router)
      const tile = page.getByTestId('garment-open-shell-garment-16')
      await tile.scrollIntoViewIfNeeded()
      const depth = await scrollY(page)
      expect(depth, 'the tile sits well below the first screen').toBeGreaterThan(600)

      await tile.click()
      await expect(page).toHaveURL(/\/wardrobe\?garment=shell-garment-16$/)
      await expectTopBar(page, /\S/)
      setScreen('closet')
      if (how === 'arrow') await page.getByTestId('app-top-bar-back').click()
      else await page.goBack()

      await expect(page).toHaveURL(/\/wardrobe$/)
      await expect
        .poll(() => scrollY(page), { message: 'Closet scroll restored' })
        .toBe(depth)
      await expect(tile).toBeFocused()
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

    // The opened tab gets the same fixture reads (routes on the page do not reach it).
    await context.route('**/api/v1/**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { data: [], total: 0, limit: 20, offset: 0 } })
        : route.fallback()
    )
    await context.route('**/api/v1/**', (route) => router.handler(route, route.request()))
    // P1: a link-opened tab shares sessionStorage (no noopener) but not history; the arrow must
    // not trust a stored stack there.
    const [opened] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => {
        window.open('/looks/capsules', '_blank')
      }),
    ])
    await opened.waitForLoadState()
    await expect(opened.getByTestId('app-top-bar-back')).toBeVisible()
    await opened.getByTestId('app-top-bar-back').click()
    // Story CC-7.12 D6: the manager's parent is Looks > Saved with the Capsules filter.
    await expect(opened).toHaveURL(/\/looks\?segment=saved&filter=capsules$/)
  })
})
