// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-001..007, E2E-009..011; AC1 to AC5, spec D2, D3, D6 to
// D9. Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
//
// Owner walk before CC-7.9: every tab looked like a different app (an always-dark page framing an
// inset light lookbook card on Home and Community, a light admin layout on Wardrobe, headers of
// different heights, gold on chips and borders). These cases read what the browser painted, by
// computed style, at 390 x 844 in both schemes, against the CC-7.7 populated shell fixtures. The
// snapshot spec beside this file locks what these rules do not name.
import type { Page } from '@playwright/test'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import deDE from '../../apps/web/src/i18n/locales/de-DE.json'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  openFixtureShell,
  paintFindings,
  rgbOf,
  SCHEMES,
  SHELL_SCREENS,
  SHELL_TABS,
  surfaceFindings,
  tokenTriples,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import {
  placeholderContrastFailures,
  surfacePixel,
  textContrastFailures,
} from '../support/helpers/painted-contrast'
import { plannerResponseSchema } from '@couture/api-client/contracts/http'
import { hexToChannels, PREMIUM_PALETTE_KEYS, premiumPalettes } from '@couture/utils'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

/** Routed sub-screens of a member (spec D7); `parent` is where back lands on a direct entry. */
const SUB_SCREENS = [
  { name: 'capsules', path: '/wardrobe/capsules', parent: '/wardrobe' },
  { name: 'closet setup', path: '/wardrobe/onboarding', parent: '/wardrobe' },
  {
    name: 'garment detail',
    path: '/wardrobe?garment=shell-garment-1',
    parent: '/wardrobe',
  },
  // D6 as recorded: notification settings are reached from Community, so Back lands there.
  { name: 'notification settings', path: '/notification-settings', parent: '/community' },
] as const
/** Other routed screens that still carry the one top bar and page surface. */
const OTHER_SCREENS = [
  { name: 'palette', path: '/palette' },
  { name: 'not found', path: '/no-such-page-7-9' },
] as const

const TOP_BAR_HEIGHT = 56

async function expectOneTopBar(page: Page, label: string) {
  const header = page.getByTestId('app-header')
  await expect(header, label).toHaveCount(1)
  const box = await header.boundingBox()
  expect(box?.height, `${label}: top bar height`).toBe(TOP_BAR_HEIGHT)
  // One row: every visible child sits inside the bar's 56 px.
  const overflow = await header.evaluate((bar) => {
    const top = bar.getBoundingClientRect().top
    return Array.from(bar.querySelectorAll('*'))
      .map((child) => child.getBoundingClientRect())
      .filter(
        (rect) => rect.height > 0 && (rect.top < top - 0.5 || rect.bottom > top + 56.5)
      ).length
  })
  expect(overflow, `${label}: top bar children outside one 56 px row`).toBe(0)
  await expect(header.locator('h1'), `${label}: one h1 title`).toHaveCount(1)
  await expect(header.locator('h1'), `${label}: title text`).not.toBeEmpty()
}

async function expectOneSurface(page: Page, label: string) {
  const roles = await tokenTriples(page)
  const surface = await surfaceFindings(page)
  expect(surface.pageCount, `${label}: page surfaces`).toBe(1)
  expect(surface.pageBackground, `${label}: page surface colour`).toBe(
    rgbOf(roles['--cc-page'] ?? '')
  )
  expect(surface.nestedCards, `${label}: cards inside cards`).toEqual([])
  return surface
}

// Fixture bearer accepted only by the local auth build, as in the CC-7.7 fixture suite.
test.describe('CC-7.9 one app shell @local-lane', () => {
  for (const scheme of SCHEMES) {
    for (const screen of SHELL_SCREENS) {
      test(`[P0] [7.9-E2E-001..006] ${screen} in ${scheme}: 56 px top bar, one surface, token colours, gold only by role, readable text`, async ({
        page,
        interceptNetworkCall,
      }) => {
        await page.emulateMedia({ colorScheme: scheme })
        const { router } = await openFixtureShell(page, interceptNetworkCall, {
          mode: 'populated',
          screen,
        })
        await page.goto(SHELL_TABS[screen].path)
        await waitForShellSettled(page, router)
        await expect(page.locator('html')).toHaveAttribute('data-session', 'member')

        // E2E-001: the bar, with the tab label as its title (D6).
        await expectOneTopBar(page, screen)
        await expect(page.getByTestId('app-header').locator('h1')).toHaveText(
          SHELL_TABS[screen].title
        )

        // E2E-002 and E2E-004: one page surface, one card level; no inset light card in dark.
        const surface = await expectOneSurface(page, `${screen} ${scheme}`)
        if (scheme === 'dark') {
          expect(surface.largeLightFills, 'light fills over 40% of the screen').toEqual(
            []
          )
          expect(surface.gradients, 'page-sized gradients').toEqual([])
        }

        // E2E-003 and E2E-006: every painted colour is a role; gold only where data-gold says.
        const roles = await tokenTriples(page)
        expect(Object.keys(roles).length, 'emitted --cc-* roles').toBeGreaterThan(10)
        const paint = await paintFindings(page, roles)
        expect(paint.offRole, 'colours that are not a token role').toEqual([])
        expect(
          paint.strayGold,
          'gold outside the primary action, focus, tab and Premium'
        ).toEqual([])

        // E2E-005: painted contrast in this scheme. Empty fields (Profile's city search) are
        // measured by their placeholder first, then hold a typed value for the text scan; the
        // value is set on the element only, so no search request starts.
        const main = page.locator('main').first()
        expect(await placeholderContrastFailures(main), 'placeholders').toEqual([])
        await main.evaluate((root) => {
          for (const field of Array.from(root.querySelectorAll('input, textarea'))) {
            const input = field as HTMLInputElement
            const rect = input.getBoundingClientRect()
            if (
              rect.width > 0 &&
              !input.value &&
              !input.disabled &&
              input.type !== 'hidden'
            )
              input.value = 'Chicago'
          }
        })
        expect(await textContrastFailures(main)).toEqual([])
      })
    }
  }

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

  for (const sub of [...SUB_SCREENS, ...OTHER_SCREENS]) {
    test(`[P1] [7.9-E2E-001..002] ${sub.name}: the same top bar and one page surface`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'closet',
      })
      await page.goto(sub.path)
      await expect(page.getByTestId('app-header')).toBeVisible()
      await expectOneTopBar(page, sub.name)
      await expectOneSurface(page, sub.name)
    })
  }

  for (const sub of SUB_SCREENS) {
    test(`[P1] [7.9-E2E-007] ${sub.name}: back in the top bar, entered directly, returns to ${sub.parent}`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
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
    // Home gives the placeholder a 60vh minimum on purpose, so it runs under the fixed tab bar:
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

/** Hard-coded English on Wardrobe and capsules at the 812cadce baseline (spec D9). */
const BASELINE_ENGLISH = [
  'Your Digital Closet',
  'Wardrobe Hub',
  '+ Add Garment',
  'Snap or Import Garment',
  'Outfit capsules',
  'Needs tags',
  'Photograph or upload clothing items to power personalized weather guidance.',
  'Curate and manage your custom outfit combinations.',
  'Filter by occasion',
  'Loading outfit capsules…',
  'Casual',
  'Evening',
  'Formal',
  'Outdoor',
  'Travel',
]

const flatten = (value: unknown, prefix = ''): Record<string, string> =>
  typeof value === 'string'
    ? { [prefix]: value }
    : Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
        (all, [key, child]) => ({
          ...all,
          ...flatten(child, prefix ? `${prefix}.${key}` : key),
        }),
        {}
      )

test.describe('CC-7.9 Wardrobe strings from the catalogs @local-lane', () => {
  test.use({ locale: 'de-DE' })

  for (const screen of [
    { name: 'Wardrobe', path: '/wardrobe' },
    { name: 'capsules', path: '/wardrobe/capsules' },
  ]) {
    test(`[P1] [7.9-E2E-009] ${screen.name} in de-DE shows no English`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await openFixtureShell(page, interceptNetworkCall, {
        mode: 'populated',
        screen: 'closet',
      })
      await page.goto(screen.path)
      await expect(page.getByTestId('app-header')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', /^de/)
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)

      const texts = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set<string>()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement
          if (!parent || parent.closest('script, style, [aria-hidden="true"]')) continue
          const rect = parent.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text) seen.add(text)
        }
        for (const element of Array.from(
          document.querySelectorAll('[aria-label], [placeholder]')
        ))
          for (const name of ['aria-label', 'placeholder'])
            if (element.getAttribute(name)) seen.add(element.getAttribute(name)!.trim())
        return [...seen]
      })

      const en = flatten(enUS)
      const de = flatten(deDE)
      const untranslated = new Set(
        Object.entries(en)
          .filter(([key, value]) => de[key] !== value && value.length > 3)
          .map(([, value]) => value)
      )
      expect(
        texts.filter((text) => BASELINE_ENGLISH.includes(text)),
        'hard-coded English from before CC-7.9'
      ).toEqual([])
      expect(
        texts.filter((text) => untranslated.has(text)),
        'en-US catalog text where de-DE has its own'
      ).toEqual([])
    })
  }

  test('[P1] [7.9-E2E-009] the top bar back control is named from the de-DE catalog', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openFixtureShell(page, interceptNetworkCall, {
      mode: 'populated',
      screen: 'closet',
    })
    await page.goto('/wardrobe/capsules')
    await expect(
      page.getByTestId('app-header').getByTestId('app-top-bar-back')
    ).toHaveAccessibleName(deDE.shell.back)
  })
})

/*
 * 7.9-E2E-008 (spec D5, risk R3): a premium palette is the member's choice and also follows the
 * system setting, so under each scheme the palette's own variant for that scheme paints Community's
 * cards and the planner, and its text stays readable there. The palette reaches the page the way a
 * member's does: Profile's theme read names it, the app writes it on <html>, and the member moves
 * to Community and Home inside the same document. Only the theme and planner reads are answered
 * here; every other read comes from the CC-7.7 shell fixtures, and nothing is written.
 */
const PLANNER_IMAGE =
  'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%201%201%22%3E%3Cpath%20d=%22M0%200h1v1H0z%22%20fill=%22blue%22/%3E%3C/svg%3E'

/** A ready seven-day week, checked against the published planner contract before it is served. */
function fixturePlannerWeek() {
  const anchor = Date.UTC(2026, 10, 20)
  const days = Array.from({ length: 7 }, (_, index) => ({
    status: 'ready' as const,
    planDate: new Date(anchor + index * 86_400_000).toISOString().slice(0, 10),
    version: 1,
    weather: {
      confidence: 'daily' as const,
      freshness: 'fresh' as const,
      condition: 'clear' as const,
      temperatureLow: 8,
      temperatureHigh: 16,
    },
    isStarterWardrobe: false,
    outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
      id: `shell-planner-${index}-${scenario}`,
      scenario,
      garmentIds: ['shell-garment-1'],
      // An image, so the scan reads the planner's words, not the placeholder garment emoji.
      displayGarments: [
        {
          id: 'shell-garment-1',
          category: 'top' as const,
          imageAccess: { url: PLANNER_IMAGE, expiresAt: '2099-12-31T00:00:00.000Z' },
        },
      ],
      reasoningBadges: [],
      comfortNotes: `Synthetic ${scenario} comfort note`,
      shopThisLook: null,
    })),
  }))
  return plannerResponseSchema.parse({
    data: {
      locationId: 'shell-home',
      timezone: 'America/Chicago',
      anchorDate: days[0]!.planDate,
      daysReady: 7,
      days,
    },
  })
}

test.describe('CC-7.9 premium palette follows the system scheme (7.9-E2E-008) @local-lane', () => {
  for (const scheme of SCHEMES) {
    for (const palette of PREMIUM_PALETTE_KEYS) {
      test(`[P1] [7.9-E2E-008] ${palette} in ${scheme}: Community cards and the planner paint the palette's ${scheme} variant and stay readable`, async ({
        page,
        interceptNetworkCall,
      }) => {
        // D5: the variant for this scheme, from the one token source (D1); the other scheme's
        // variant is what a palette that ignored the system setting would paint.
        const other = scheme === 'dark' ? 'light' : 'dark'
        const expectedTriple = hexToChannels(premiumPalettes[palette][scheme].cardBg)
        const expectedSurface = rgbOf(expectedTriple)
        const otherSurface = rgbOf(hexToChannels(premiumPalettes[palette][other].cardBg))
        const normal = (triple: string | undefined) =>
          (triple ?? '').trim().split(/\s+/).join(' ')

        await page.emulateMedia({ colorScheme: scheme })
        const { router, setScreen } = await openFixtureShell(page, interceptNetworkCall, {
          mode: 'populated',
          screen: 'profile',
        })
        // Registered after the shell router, so these two answers take precedence over it.
        const themeRead = interceptNetworkCall({
          method: 'GET',
          url: '**/api/v1/commerce/premium/theme',
          fulfillResponse: {
            status: 200,
            body: { data: { theme: palette, isEntitled: true, themesEnabled: true } },
          },
        })
        const plannerRead = interceptNetworkCall({
          method: 'GET',
          url: '**/api/v1/commerce/premium/planner*',
          fulfillResponse: { status: 200, body: fixturePlannerWeek() },
        })

        await page.goto(SHELL_TABS.profile.path)
        expect((await themeRead).status).toBe(200)
        await waitForShellSettled(page, router)
        const html = page.locator('html')
        await expect(html).toHaveAttribute('data-theme', palette)
        expect(
          normal((await tokenTriples(page))['--cc-theme-card-bg']),
          'palette card token on the root'
        ).toBe(normal(expectedTriple))

        // Community, reached inside the same document: the palette stays applied.
        setScreen('community')
        await page.getByTestId(SHELL_TABS.community.nav).click()
        await expect(page).toHaveURL(/\/community$/)
        await waitForShellSettled(page, router)
        await expect(html).toHaveAttribute('data-theme', palette)
        const community = page.getByTestId('community-page')
        for (const id of ['shell-look-1', 'shell-look-2'])
          await expect(
            community.locator(`[data-testid$="lookbook-card-${id}"]`)
          ).toBeVisible()
        const cards = await community.locator('article[data-surface="card"]').all()
        expect(cards.length, 'Community lookbook cards').toBeGreaterThanOrEqual(2)
        for (const card of cards) {
          const name = (await card.getAttribute('data-testid')) ?? 'card'
          const computed = await card.evaluate(
            (el) => getComputedStyle(el).backgroundColor
          )
          expect(computed, `${name} computed surface`).toBe(expectedSurface)
          expect(computed, `${name} is not the ${other} variant`).not.toBe(otherSurface)
          // Painted: the top edge of the comments row, where nothing but the card shows.
          const comments = card.locator('[data-testid*="comments-button-"]').first()
          // On screen first: the pixel is shot in viewport coordinates.
          await comments.scrollIntoViewIfNeeded()
          expect(await surfacePixel(comments, 2), `${name} painted surface`).toBe(
            expectedSurface
          )
          expect(await textContrastFailures(card), `${name} text`).toEqual([])
        }

        // The planner, opened from Home in the same document.
        setScreen('home')
        await page.getByTestId(SHELL_TABS.home.nav).click()
        await expect(page).toHaveURL(/\/$/)
        await waitForShellSettled(page, router)
        await expect(html).toHaveAttribute('data-theme', palette)
        await page.getByTestId('planner-open-control').click()
        expect((await plannerRead).status).toBe(200)
        const rail = page.getByRole('complementary', {
          name: enUS.commerce.premium.planner.railLabel,
        })
        await expect(rail).toBeVisible()
        await expect(rail.getByTestId('planner-days')).toBeVisible()
        await expect(rail.locator('[data-testid^="planner-outfit-"]')).toHaveCount(21)
        const railSurface = await rail.evaluate(
          (el) => getComputedStyle(el).backgroundColor
        )
        expect(railSurface, 'planner computed surface').toBe(expectedSurface)
        expect(railSurface, `planner is not the ${other} variant`).not.toBe(otherSurface)
        expect(await surfacePixel(rail), 'planner painted surface').toBe(expectedSurface)
        expect(await textContrastFailures(rail), 'planner text').toEqual([])
      })
    }
  }
})
