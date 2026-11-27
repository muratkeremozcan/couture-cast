// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-E2E-001..017, the five tabs, each tab's first content
// above the fold, the Closet More menu, Profile > Style, the Looks tab and the Plan route.
// Native twin: apps/mobile/src/screens/five-tab-navigation.test.tsx.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Story CC-7.12 (Step 69): Closet has no saved looks row; Looks has Saved, Ideas and Plan
// segments with look and capsule tiles; Plan week and /?planner=1 open /looks?segment=plan.
import { APP_TABS, TAB_ICON_PATHS } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  openFixtureShell,
  SHELL_TABS,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import {
  bottomNavTabs,
  chromeBefore,
  expectInFold,
  FOLD_VIEWPORT,
  firstContent,
  foldBand,
  visibleInBand,
} from '../support/helpers/five-tab'
import {
  SHELL_CAPSULE_ID,
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

const LABELS = ['Today', 'Closet', 'Looks', 'Community', 'Profile']
const SCREENS: ShellScreen[] = ['home', 'closet', 'looks', 'community', 'profile']
const FIXTURES: ShellMode[] = ['empty', 'populated', 'guardian-pending']

test.describe('CC-7.11 five tabs @local-lane', () => {
  test('[P0] [7.11-E2E-001/002] bottom bar: Today, Closet, Looks, Community, Profile with the shared icons and 12 px sentence-case labels', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
    })
    await page.goto(SHELL_TABS.closet.path)
    await waitForShellSettled(page, router)

    const tabs = await bottomNavTabs(page)
    expect(tabs.map((tab) => tab.label)).toEqual(LABELS)
    expect(tabs.map((tab) => tab.testId)).toEqual(
      APP_TABS.map((tab) => `bottom-nav-${tab.id}`)
    )
    expect(tabs.map((tab) => tab.href)).toEqual(APP_TABS.map((tab) => tab.webHref))
    for (const [index, tab] of tabs.entries()) {
      const id = APP_TABS[index]!.id
      expect(tab.paths, `${tab.label} icon`).toEqual([...TAB_ICON_PATHS[id]])
      expect(tab.svgHidden, `${tab.label} icon is decorative`).toBe(true)
      // D2: emoji leave the tab bar.
      expect(tab.label, `${tab.label} has no emoji`).not.toMatch(
        /\p{Extended_Pictographic}/u
      )
    }

    const labelStyles = await page
      .getByTestId('sticky-bottom-nav')
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => {
          // The label is the link's deepest element holding its text.
          const label =
            Array.from(link.querySelectorAll<HTMLElement>('*')).find(
              (node) =>
                node.children.length === 0 && (node.textContent ?? '').trim().length > 0
            ) ?? (link as HTMLElement)
          return {
            text: (label.textContent ?? '').trim(),
            size: parseFloat(getComputedStyle(label).fontSize),
            transform: getComputedStyle(label).textTransform,
          }
        })
      )
    for (const style of labelStyles) {
      expect(style.size, `${style.text} font size`).toBeGreaterThanOrEqual(12)
      // Sentence case as rendered: no uppercase or capitalize transform over the catalog text.
      expect(['none', ''], `${style.text} text-transform`).toContain(style.transform)
      expect(style.text, 'sentence case').toMatch(/^\p{Lu}[^\p{Lu}]*$/u)
    }
  })

  test('[P1] [7.11-E2E-003] desktop top tabs: the same five, same order, same icons', async ({
    page,
    interceptNetworkCall,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
    })
    await page.goto(SHELL_TABS.home.path)
    await waitForShellSettled(page, router)

    const desktop = await page
      .locator(APP_TABS.map((tab) => `[data-testid="${tab.desktopTestId}"]`).join(','))
      .evaluateAll((links) =>
        links.map((link) => ({
          testId: link.getAttribute('data-testid'),
          label: (link.textContent ?? '').trim(),
          paths: Array.from(link.querySelectorAll('svg path')).map((path) =>
            path.getAttribute('d')
          ),
        }))
      )
    expect(desktop.map((tab) => tab.testId)).toEqual(
      APP_TABS.map((tab) => tab.desktopTestId)
    )
    expect(desktop.map((tab) => tab.label)).toEqual(LABELS)
    for (const [index, tab] of desktop.entries())
      expect(tab.paths, tab.label).toEqual([...TAB_ICON_PATHS[APP_TABS[index]!.id]])
  })

  for (const colors of ['none', 'active'] as const) {
    test(`[P0] [7.11-E2E-004] active tab is marked without color, forced-colors ${colors}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await page.emulateMedia({ forcedColors: colors })
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'closet',
      })
      await page.goto(SHELL_TABS.closet.path)
      await waitForShellSettled(page, router)
      // Grayscale: whatever cue survives must not be a hue.
      await page.addStyleTag({ content: 'html { filter: grayscale(1) }' })

      const marks = await page
        .getByTestId('sticky-bottom-nav')
        .getByRole('link')
        .evaluateAll((links) => {
          const nav = links[0]!.closest(
            '[data-testid="sticky-bottom-nav"]'
          ) as HTMLElement
          const navBackground = getComputedStyle(nav).backgroundColor
          return links.map((link) => {
            const label =
              Array.from(link.querySelectorAll<HTMLElement>('*')).find(
                (node) =>
                  node.children.length === 0 && (node.textContent ?? '').trim().length > 0
              ) ?? (link as HTMLElement)
            const indicator = link.querySelector<HTMLElement>(
              '[data-testid="gold-active-indicator"]'
            )
            let indicatorPainted = false
            if (indicator) {
              const style = getComputedStyle(indicator)
              const rect = indicator.getBoundingClientRect()
              const fill = style.backgroundColor
              const border =
                style.borderTopWidth !== '0px' || style.borderBottomWidth !== '0px'
              indicatorPainted =
                rect.width >= 8 &&
                rect.height >= 2 &&
                style.visibility !== 'hidden' &&
                ((fill !== 'rgba(0, 0, 0, 0)' && fill !== navBackground) || border)
            }
            return {
              id: link.getAttribute('data-testid'),
              current: link.getAttribute('aria-current'),
              weight: Number(getComputedStyle(label).fontWeight),
              indicatorPainted,
            }
          })
        })

      const active = marks.filter((mark) => mark.id === 'bottom-nav-wardrobe')
      const inactive = marks.filter((mark) => mark.id !== 'bottom-nav-wardrobe')
      expect(active).toHaveLength(1)
      expect(inactive).toHaveLength(4)
      expect(active[0]).toMatchObject({ current: 'page', indicatorPainted: true })
      expect(active[0]!.weight, 'active label weight').toBeGreaterThanOrEqual(600)
      for (const mark of inactive) {
        expect(mark, `${mark.id} is not marked`).toMatchObject({
          current: null,
          indicatorPainted: false,
        })
        expect(mark.weight, `${mark.id} weight`).toBeLessThan(600)
      }
    })
  }

  for (const mode of FIXTURES) {
    for (const screen of SCREENS) {
      test(`[P0] [7.11-E2E-005] ${screen}, ${mode}: first own content above the fold, nothing before it`, async ({
        page,
        interceptNetworkCall,
      }) => {
        const { router } = await openFixtureShell(page, interceptNetworkCall, {
          mode,
          screen,
        })
        await page.goto(SHELL_TABS[screen].path)
        await waitForShellSettled(page, router)

        const anchor = firstContent(page, screen, mode)
        await expectInFold(page, anchor, `${screen} first content`)
        // Today's weather line and Community's own header are content (CC-7.13, CC-7.15); on
        // Closet, Looks and Profile no paragraph of explanation may come first.
        const paragraphs =
          screen === 'closet' || screen === 'looks' || screen === 'profile'
        expect(await chromeBefore(page, anchor, { paragraphs })).toEqual([])
      })
    }
  }
})

test.describe('CC-7.11 Closet opens on its grid @local-lane', () => {
  test('[P0] [7.11-E2E-010/012] [7.12-E2E-016] populated: four tiles in the fold, Add the one primary in the top bar, no saved looks row', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
    })
    await page.goto(SHELL_TABS.closet.path)
    await waitForShellSettled(page, router)

    const band = await foldBand(page)
    for (const index of [1, 2, 3, 4]) {
      const tile = page.getByTestId(`garment-card-shell-garment-${index}`)
      const { box, visible } = await visibleInBand(tile, band)
      expect(
        visible,
        `tile ${index} fully inside ${band.top}..${band.bottom}`
      ).toBeGreaterThanOrEqual(box.height - 1)
    }

    const topBar = page.getByTestId('app-header')
    await expect(topBar.getByTestId('garment-capture-open')).toBeVisible()
    await expect(topBar.getByTestId('closet-more-menu')).toBeVisible()
    // D4: the Capsules / Silhouette / Add row left the Closet body.
    await expect(page.getByTestId('wardrobe-actions')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /^Capsules$/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Set up your closet' })).toHaveCount(0)

    // Story CC-7.12 D8: the saved looks row left the Closet; the member's saved looks live on
    // Looks > Saved. The populated member has one saved look, so an absent row is no empty state.
    await expect(page.getByTestId('closet-garment-grid')).toBeVisible()
    await expect(page.getByTestId('closet-saved-looks-row')).toHaveCount(0)
    await expect(page.getByTestId(`saved-look-card-${SHELL_SAVED_LOOK_ID}`)).toHaveCount(
      0
    )
    expect(router.calls('saved-looks'), 'Closet sends no saved looks read').toBe(0)
  })

  test('[P0] [7.11-E2E-011] empty: the empty-state Add in the fold, no setup banner, no Capsules or Silhouette above the grid', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'empty',
      screen: 'closet',
    })
    await page.goto(SHELL_TABS.closet.path)
    await waitForShellSettled(page, router)

    const empty = page.getByTestId('closet-empty-state')
    await expectInFold(page, empty.getByRole('button'), 'empty-state Add')
    await expect(page.getByTestId('wardrobe-actions')).toHaveCount(0)
    const progress = page.getByTestId('closet-setup-progress-link')
    await expect(progress).toHaveAttribute('href', '/wardrobe/onboarding')
    const emptyBox = (await empty.boundingBox())!
    expect((await progress.boundingBox())!.y).toBeGreaterThanOrEqual(
      emptyBox.y + emptyBox.height - 1
    )
    await expect(page.getByRole('button', { name: /^Silhouette$/ })).toHaveCount(0)
  })
})

test.describe('CC-7.11 More menu and Profile > Style @local-lane', () => {
  for (const [mode, setup] of [
    ['empty', /^Closet setup$/],
    ['populated', /^Closet setup: done$/],
  ] as const) {
    test(`[P0] [7.11-E2E-013/014] More menu, ${mode}: Closet setup and Silhouette, Escape and outside click close it, focus back on More`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode,
        screen: 'closet',
      })
      await page.goto(SHELL_TABS.closet.path)
      await waitForShellSettled(page, router)

      const more = page.getByTestId('closet-more-menu')
      await more.click()
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(more).toHaveAttribute('aria-expanded', 'true')
      await expect(menu.getByRole('menuitem')).toHaveText([setup, /^Silhouette$/])
      await expect(page.getByTestId('closet-more-setup')).toHaveText(setup)

      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(more).toBeFocused()
      await expect(more).toHaveAttribute('aria-expanded', 'false')

      await more.click()
      await expect(menu).toBeVisible()
      await page.getByTestId('app-top-bar-title').click()
      await expect(menu).toBeHidden()
      // Codex 7.11 #14: an outside click on non-focusable chrome hands focus back to More.
      await expect(more).toBeFocused()
      await expect(page).toHaveURL(/\/wardrobe$/)
    })
  }

  for (const [item, url, title] of [
    ['closet-more-setup', /\/wardrobe\/onboarding$/, /^Closet setup$/],
    ['closet-more-silhouette', /\/wardrobe\/silhouette$/, /^Silhouette$/],
  ] as const) {
    test(`[P1] [7.11-E2E-014] More > ${item} opens its screen under a top bar with back`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'closet',
      })
      await page.goto(SHELL_TABS.closet.path)
      await waitForShellSettled(page, router)

      await page.getByTestId('closet-more-menu').click()
      await page.getByTestId(item).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByTestId('app-top-bar-back')).toBeVisible()
      await expect(page.getByTestId('app-top-bar-title')).toHaveText(title)
    })
  }

  test('[P0] [7.11-E2E-015] Profile > Style lists Silhouette, Closet setup and Color palette, each opens its screen', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'profile',
    })
    await page.goto(SHELL_TABS.profile.path)
    await waitForShellSettled(page, router)

    const account = await page.getByTestId('profile-account-row').boundingBox()
    const styleRow = page.getByTestId('profile-style-row')
    const row = await styleRow.boundingBox()
    expect(row!.y, 'Style row below the Account row').toBeGreaterThanOrEqual(
      account!.y + account!.height - 1
    )
    await styleRow.click()
    await expect(page).toHaveURL(/\/settings\/style$/)
    await expect(page.getByTestId('app-top-bar-title')).toHaveText(/^Style$/)
    await expect(page.getByTestId('app-top-bar-back')).toBeVisible()

    const rows = ['style-row-silhouette', 'style-row-setup', 'style-row-palette']
    const tops = await Promise.all(
      rows.map(async (id) => (await page.getByTestId(id).boundingBox())!.y)
    )
    expect(tops, 'Silhouette, Closet setup, Color palette in that order').toEqual(
      [...tops].sort((a, b) => a - b)
    )

    for (const [id, url] of [
      ['style-row-silhouette', /\/wardrobe\/silhouette$/],
      ['style-row-setup', /\/wardrobe\/onboarding$/],
      ['style-row-palette', /\/palette$/],
    ] as const) {
      await page.getByTestId(id).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByTestId('app-top-bar-back')).toBeVisible()
      await page.getByTestId('app-top-bar-back').click()
      await expect(page).toHaveURL(/\/settings\/style$/)
    }
  })
})

test.describe('CC-7.12 Looks tab and Plan @local-lane', () => {
  for (const mode of ['empty', 'populated'] as const) {
    test(`[P0] [7.11-E2E-016] [7.12-E2E-003] Looks, ${mode}: Saved, Ideas and Plan segments; opens on ${mode === 'empty' ? 'Ideas' : 'Saved'}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      const { router } = await openFixtureShell(page, interceptNetworkCall, {
        mode,
        screen: 'looks',
      })
      await page.goto(SHELL_TABS.looks.path)
      await waitForShellSettled(page, router)

      await expect(page.getByTestId('app-top-bar-title')).toHaveText(/^Looks$/)
      await expect(page.getByTestId('bottom-nav-looks')).toHaveAttribute(
        'aria-current',
        'page'
      )
      // D1: three segments in order, the open one selected; the CC-7.11 rows are gone.
      await expect(page.getByRole('tab')).toHaveText(['Saved', 'Ideas', 'Plan'])
      await expect(page.getByTestId('looks-capsules-row')).toHaveCount(0)
      await expect(page.getByTestId('looks-plan-row')).toHaveCount(0)
      const first = page.getByTestId('looks-first-content')
      if (mode === 'empty') {
        await expect(page.getByTestId('looks-segment-ideas')).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(first.getByTestId('looks-ideas-empty-line')).toHaveText(
          'Save a look to see it here'
        )
      } else {
        await expect(page.getByTestId('looks-segment-saved')).toHaveAttribute(
          'aria-selected',
          'true'
        )
        // D2, D3: newest first, the look (saved after the capsule) then the capsule.
        const look = first.getByTestId(`saved-look-card-${SHELL_SAVED_LOOK_ID}`)
        const capsule = first.getByTestId(`looks-capsule-card-${SHELL_CAPSULE_ID}`)
        await expect(look).toHaveAttribute(
          'href',
          `/looks/saved/${SHELL_SAVED_LOOK_ID}?from=all`
        )
        await expect(capsule).toHaveAttribute(
          'href',
          `/looks/capsules?capsule=${SHELL_CAPSULE_ID}`
        )
        const lookBox = (await look.boundingBox())!
        const capsuleBox = (await capsule.boundingBox())!
        expect(
          lookBox.y * 10_000 + lookBox.x,
          'the newer look sits before the capsule'
        ).toBeLessThan(capsuleBox.y * 10_000 + capsuleBox.x)
      }

      // Capsules is a Saved filter now, with the manager one row below the tiles.
      await page.getByTestId('looks-segment-saved').click()
      await page.getByTestId('looks-filter-capsules').click()
      await expect(page).toHaveURL(/\/looks\?segment=saved&filter=capsules$/)
      await expect(page.getByTestId('looks-filter-capsules')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await page.getByTestId('looks-manage-capsules').click()
      await expect(page).toHaveURL(/\/looks\/capsules$/)
      await expect(page.getByTestId('app-top-bar-title')).toHaveText(/^Outfit capsules$/)
      await page.getByTestId('app-top-bar-back').click()
      await expect(page).toHaveURL(/\/looks\?segment=saved&filter=capsules$/)

      // Plan is a segment: the Looks top bar stays, with no back arrow.
      await page.getByTestId('looks-segment-plan').click()
      await expect(page).toHaveURL(/\/looks\?segment=plan$/)
      await expect(page.getByTestId('looks-segment-plan')).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await expect(page.getByTestId('app-top-bar-title')).toHaveText(/^Looks$/)
      await expect(page.getByTestId('app-top-bar-back')).toHaveCount(0)
      // The planner renders inside the segment (free preview vs week is looks-plan.spec.ts).
      await expect(
        page
          .getByTestId('looks-first-content')
          .getByRole('complementary', { name: 'Planner Rail' })
      ).toBeVisible()
    })
  }

  test('[P1] [7.11-E2E-017] [7.12-E2E-034/035] Today Plan week opens /looks?segment=plan; /?planner=1 and /looks/plan redirect there; no planner drawer on Today', async ({
    page,
    interceptNetworkCall,
  }) => {
    const { router } = await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'home',
    })
    await page.goto(SHELL_TABS.home.path)
    await waitForShellSettled(page, router)

    // D9: Today renders no Planner Rail. (Today still embeds the Community grid's own aside
    // until CC-7.13, so the check names the rail.)
    await expect(page.getByRole('complementary', { name: 'Planner Rail' })).toHaveCount(0)
    const planLink = page.getByTestId('home-plan-week')
    await expect(planLink).toHaveAttribute('href', '/looks?segment=plan')
    await expect(planLink).toBeVisible()
    await planLink.click()
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await expect(page.getByTestId('looks-segment-plan')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByTestId('bottom-nav-looks')).toHaveAttribute(
      'aria-current',
      'page'
    )

    // D11: the Looks address drops the legacy `planner` key the redirect passes through.
    await page.goto('/?planner=1')
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
    await page.goto('/looks/plan')
    await expect(page).toHaveURL(/\/looks\?segment=plan$/)
  })
})
