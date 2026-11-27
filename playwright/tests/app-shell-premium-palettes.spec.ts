// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-008, premium palettes follow the system scheme (spec D5,
// risk R3). Split from app-shell-visual-system.spec.ts so the burn-in shards spread the
// full-page contrast scans. Test design:
// _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
// Story CC-7.12 (Step 69): Plan week opens the Looks Plan segment (/looks?segment=plan).
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  measureThroughOverlays,
  openFixtureShell,
  rgbOf,
  SCHEMES,
  SHELL_TABS,
  tokenTriples,
  waitForShellSettled,
} from '../support/helpers/app-shell'
import { surfacePixel, textContrastFailures } from '../support/helpers/painted-contrast'
import { plannerResponseSchema } from '@couture/api-client/contracts/http'
import { hexToChannels, PREMIUM_PALETTE_KEYS, premiumPalettes } from '@couture/utils'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
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
          // Read painted card fill at the edge of the transparent title button.
          const title = card.getByRole('heading').getByRole('button')
          // On screen first: the pixel is shot in viewport coordinates.
          await title.scrollIntoViewIfNeeded()
          expect(await surfacePixel(title, 2), `${name} painted surface`).toBe(
            expectedSurface
          )
          await measureThroughOverlays(page)
          expect(await textContrastFailures(card), `${name} text`).toEqual([])
        }

        // The planner, reached from Home in the same document. Story CC-7.12 D11: Plan week links
        // to the Looks Plan segment, which keeps the palette through the client navigation.
        setScreen('home')
        await page.getByTestId(SHELL_TABS.home.nav).click()
        await expect(page).toHaveURL(/\/$/)
        await waitForShellSettled(page, router)
        await expect(html).toHaveAttribute('data-theme', palette)
        await page.getByTestId('home-plan-week').click()
        await expect(page).toHaveURL('/looks?segment=plan')
        await expect(html).toHaveAttribute('data-theme', palette)
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
        await measureThroughOverlays(page)
        expect(await textContrastFailures(rail), 'planner text').toEqual([])
      })
    }
  }
})
