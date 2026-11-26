// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-006, E2E-007, E2E-010, E2E-011, E2E-013; AC1 to AC5, spec D2, D3, D6 to
// D9. Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
//
// Owner walk before CC-7.9: every tab looked like a different app (an always-dark page framing an
// inset light lookbook card on Home and Community, a light admin layout on Wardrobe, headers of
// different heights, gold on chips and borders). These cases read what the browser painted, by
// computed style, at 390 x 844 in both schemes, against the CC-7.7 populated shell fixtures. The
// snapshot spec beside this file locks what these rules do not name.
//
// The per-tab checks (E2E-001..006) live in app-shell-tabs-light and app-shell-tabs-dark, the
// palettes (E2E-008) in app-shell-premium-palettes and the de-DE strings (E2E-009) in
// app-shell-de-de-strings: one file was too heavy for one burn-in shard (CI 46f09ae8).
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  expectOneSurface,
  expectOneTopBar,
  openFixtureShell,
  rgbOf,
  SCHEMES,
  surfaceFindings,
  tokenTriples,
  waitForShellSettled,
} from '../support/helpers/app-shell'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

/** Routed sub-screens of a member (spec D7); `parent` is where back lands on a direct entry. */
const SUB_SCREENS = [
  // Story CC-7.11 D10: capsules is a Looks row now, so a direct entry backs out to Looks.
  {
    name: 'capsules',
    path: '/wardrobe/capsules',
    parent: '/looks',
    mode: 'populated',
  },
  // Closet setup shows only while setup is unfinished: a finished closet redirects to /wardrobe.
  {
    name: 'closet setup',
    path: '/wardrobe/onboarding',
    parent: '/wardrobe',
    mode: 'empty',
  },
  {
    name: 'garment detail',
    path: '/wardrobe?garment=shell-garment-1',
    parent: '/wardrobe',
    mode: 'populated',
  },
  // Story CC-7.11 D10: notification settings moved from Community to Profile, so Back lands there.
  {
    name: 'notification settings',
    path: '/notification-settings',
    parent: '/settings',
    mode: 'populated',
  },
] as const
/** Other routed screens that still carry the one top bar and page surface. */
const OTHER_SCREENS = [
  { name: 'palette', path: '/palette', mode: 'populated', expected404: false },
  // The 404 document is this screen's subject, so the network monitor is off for it alone.
  { name: 'not found', path: '/no-such-page-7-9', mode: 'populated', expected404: true },
] as const

// Fixture bearer accepted only by the local auth build, as in the CC-7.7 fixture suite.
test.describe('CC-7.9 one app shell @local-lane', () => {
  test('[P1] [7.9-E2E-006] the keyboard focus ring is the gold focus role on both schemes', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
    })
    await page.goto('/')
    await waitForShellSettled(page, router)
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme })
      const roles = await tokenTriples(page)
      const focus = rgbOf(roles['--cc-focus'] ?? '')
      await page.getByTestId('bottom-nav-wardrobe').focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('bottom-nav-wardrobe')).toBeFocused()
      const ring = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element)
        return `${style.outlineColor} ${style.outlineWidth} | ${style.boxShadow}`
      })
      // The ring is an outline or a box-shadow in the focus role; channels, any alpha.
      expect(ring, `${scheme}: focus ring`).toContain(focus.slice(4, -1))
    }
  })

  for (const sub of [
    ...SUB_SCREENS.map((screen) => ({ ...screen, expected404: false })),
    ...OTHER_SCREENS,
  ]) {
    test(
      `[P1] [7.9-E2E-001..002] ${sub.name}: the same top bar and one page surface`,
      {
        annotation: sub.expected404 ? [{ type: 'skipNetworkMonitoring' }] : [],
      },
      async ({ page, interceptNetworkCall }) => {
        await openFixtureShell(page, interceptNetworkCall, {
          mode: sub.mode,
          screen: 'closet',
        })
        await page.goto(sub.path)
        await expect(page.getByTestId('app-header')).toBeVisible()
        await expectOneTopBar(page, sub.name)
        await expectOneSurface(page, sub.name)
      }
    )
  }

  for (const sub of SUB_SCREENS) {
    test(`[P1] [7.9-E2E-007] ${sub.name}: back in the top bar, entered directly, returns to ${sub.parent}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openFixtureShell(page, interceptNetworkCall, {
        mode: sub.mode,
        screen: 'closet',
      })
      await page.goto(sub.path)
      const back = page.getByTestId('app-header').getByTestId('app-top-bar-back')
      await expect(back).toBeVisible()
      await expect(back).toHaveAccessibleName(enUS.shell.back)
      await back.click()
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === sub.parent)
      await expectOneTopBar(page, `${sub.name} parent`)
    })
  }

  test('[P1] [7.9-E2E-010] a system scheme change with the page open repaints the surface without a reload', async ({
    page,
    interceptNetworkCall,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'community',
    })
    await page.goto('/community')
    await waitForShellSettled(page, router)
    const light = (await surfaceFindings(page)).pageBackground
    await page.evaluate(() => {
      ;(window as unknown as { __noReload: boolean }).__noReload = true
    })

    await page.emulateMedia({ colorScheme: 'dark' })
    const roles = await tokenTriples(page)
    await expect
      .poll(async () => (await surfaceFindings(page)).pageBackground)
      .toBe(rgbOf(roles['--cc-page'] ?? ''))
    expect((await surfaceFindings(page)).pageBackground).not.toBe(light)
    expect(
      await page.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload
      )
    ).toBe(true)
  })

  test('[P0] [7.9-E2E-011] session pending: the placeholder sits inside the final shell (CC-7.7 D1)', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
      storedSession: true,
    })
    // The profile read verifies the stored session: held, the session stays pending.
    const release = router.hold('profile')
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-session', 'pending')
    const placeholder = page.getByTestId('screen-placeholder').first()
    await expect(placeholder).toBeVisible()
    await expectOneTopBar(page, 'pending')
    const nav = page.getByTestId('sticky-bottom-nav')
    await expect(nav).toBeVisible()

    const [header, navBox, hole] = await Promise.all([
      page.getByTestId('app-header').boundingBox(),
      nav.boundingBox(),
      placeholder.boundingBox(),
    ])
    // Home's gate is min-h-screen on purpose, so its placeholder runs under the fixed tab bar:
    // it starts below the top bar and is on screen between the two bars.
    expect(hole!.y, 'placeholder below the top bar').toBeGreaterThanOrEqual(
      header!.y + 56
    )
    expect(hole!.y, 'placeholder starts above the tab bar').toBeLessThan(navBox!.y)
    const roles = await tokenTriples(page)
    await expect(placeholder).toHaveCSS(
      'background-color',
      rgbOf(roles['--cc-card-muted'] ?? '')
    )
    // The placeholder running under the tab bar must not take its taps: the topmost element at
    // the centre of each tab is inside the tab bar (Codex replaced-assertions check).
    // Story CC-7.11 D1: every one of the five tabs, Looks included.
    for (const tab of [
      'bottom-nav-home',
      'bottom-nav-wardrobe',
      'bottom-nav-looks',
      'bottom-nav-community',
      'bottom-nav-settings',
    ]) {
      const box = await page.getByTestId(tab).boundingBox()
      const hit = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[data-testid="sticky-bottom-nav"]') !=
          null,
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
      )
      expect(hit, `${tab} takes its tap while the session is pending`).toBe(true)
    }

    release()
    await waitForShellSettled(page, router)
    await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
    // Both bars hold their boxes across the release (CC-7.7 AC2).
    expect(await page.getByTestId('app-header').boundingBox(), 'top bar moved').toEqual(
      header
    )
    expect(await nav.boundingBox(), 'tab bar moved').toEqual(navBox)
  })
})

test.describe('CC-7.9 Profile account handoff @local-lane', () => {
  // Codex replaced-assertions check 2: the unit cases check classes; this proves the visible
  // handoff in the browser. The Profile gate opens without the account read (CC-7.7 D3), so the
  // account line holds a reserve until the read lands; landing must not move what follows.
  test('[P0] [7.9-E2E-013] the account read landing after the reveal swaps the reserve for the email without moving the next section', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'profile',
    })
    const release = router.hold('profile')
    await page.goto('/settings')
    await expect(
      page.locator('[data-testid="screen-gate"][data-ready="true"]')
    ).toBeVisible()

    const reserve = page.getByTestId('profile-account-reserved')
    await expect(reserve).toBeVisible()
    await expect(page.getByTestId('profile-account')).toHaveCount(0)
    const next = page.getByRole('heading', { name: 'Locations', level: 2 })
    await expect(next).toBeVisible()
    const before = await next.boundingBox()

    release()
    const account = page.getByTestId('profile-account')
    await expect(account).toBeVisible()
    await expect(account).toContainText('shell-member@example.test')
    await expect(reserve).toHaveCount(0)
    expect(await next.boundingBox(), 'the section below the account line moved').toEqual(
      before
    )
  })
})
