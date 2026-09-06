// Story 5.3: the Playwright half of the premium theme switcher
// (`premium-theme-section.tsx`, `apps/web/src/lib/premium-theme.ts`). 5.3-E2E-010 and
// 5.3-E2E-011 come from the story's own coverage matrix; 5.3-E2E-012 and 5.3-E2E-013
// are minted here for the two scenarios Task 7 never assigned ids to: the signed-in
// non-entitled locked state and the unrecognized-stored-value fallback.
//
// WRITE SAFETY (read `premium-session.ts`'s doc-comment before touching this file).
// `PremiumEntitlement` is worker-only, so Story 5.2's seeded-user fixtures are
// read-only by construction. `PremiumThemePreference` is the one row an entitled user
// can write through the public API, which is the feature under test. The seeded
// `'active'` user is shared across parallel workers (`PREMIUM_SEED_USERS`,
// `packages/db/prisma/seeds/commerce.ts`), so the one test that writes a real palette
// to it runs in its own `describe` block under
// `test.describe.configure({ mode: 'serial' })`: one shared row, one writer at a time.
// `beforeEach`/`afterEach` both reset the row to Default via a direct
// `PUT { theme: null }`, and Decision 8 forbids deleting it, so a run that crashes
// mid-test still leaves the fixture clean for the next one.
import type { Locator, Page } from '@playwright/test'
import type { ApiRequestFixtureParams } from '@seontechnologies/playwright-utils/api-request'
import { log } from '@seontechnologies/playwright-utils/log'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import {
  expect,
  premiumFreshTest,
  premiumSeededTest,
  type PremiumSession,
} from '../support/helpers/premium-session'
import { test as anonymousTest } from '../support/fixtures/merged-fixtures'

const THEME_PATH = '/api/v1/commerce/premium/theme'
const THEME_URL = `**${THEME_PATH}`

type ThemeKey = 'jewel_radiance' | 'autumn_umber' | 'winter_metallic'

type ThemeData = {
  theme: ThemeKey | null
  isEntitled: boolean
  themesEnabled: boolean
}

type ThemeWriteRequest = { theme: ThemeKey | null }

type ThemeExchange = {
  status: number
  requestJson: ThemeWriteRequest | null
  responseJson: { data: ThemeData } | null
}

function watchThemeCall(
  interceptNetworkCall: InterceptNetworkCallFn,
  method: 'GET' | 'PUT'
): Promise<ThemeExchange> {
  return interceptNetworkCall({ method, url: THEME_URL }).then((result) => ({
    status: result.status,
    requestJson: result.requestJson as ThemeWriteRequest | null,
    responseJson: result.responseJson as { data: ThemeData } | null,
  }))
}

/**
 * Network-first: the theme read is registered before the navigation that triggers
 * it, so the spec never races the page.
 */
async function openThemeSettings(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<ThemeExchange> {
  const load = watchThemeCall(interceptNetworkCall, 'GET')

  await page.goto('/settings')

  const exchange = await load
  await waitForAccessibilityReady(page)

  return exchange
}

/**
 * The apiRequest fixture is overloaded (classic and operation-based), so the classic
 * parameter shape is referenced directly. Mirrors `capsule-session.ts`.
 */
type ApiRequestFn = <T = unknown>(
  params: ApiRequestFixtureParams
) => Promise<{ status: number; body: T }>

async function resetSeededTheme(
  apiRequest: ApiRequestFn,
  session: PremiumSession
): Promise<void> {
  // `{ theme: null }` upserts to Default; per Decision 8 the row is never deleted.
  // The response is asserted because the row is shared across parallel workers: a
  // silently failed reset would point the next run's first assertion at the wrong
  // symptom.
  const response = await apiRequest({
    method: 'PUT',
    path: THEME_PATH,
    baseUrl: session.apiBaseUrl,
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: { theme: null },
  })
  expect(response.status).toBe(200)
}

function lockedPanel(page: Page): Locator {
  return page.getByTestId('premium-theme-locked')
}

function gallery(page: Page): Locator {
  return page.getByTestId('premium-theme-gallery')
}

function paletteOption(page: Page, dataTheme: string): Locator {
  return page.getByTestId(`premium-theme-option-${dataTheme}`)
}

function paletteState(page: Page, dataTheme: string): Locator {
  return page.getByTestId(`premium-theme-state-${dataTheme}`)
}

/**
 * Every `PaletteCard` pins its own `data-theme`, so a card rendering correctly proves
 * nothing about whether the attribute reached `<html>`. This is the DOM proof that it
 * did.
 */
async function htmlDataTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

anonymousTest.describe('Story 5.3 premium theme switcher, signed out', () => {
  anonymousTest(
    '[P0] 5.3-E2E-011 shows the locked upsell signed out with no theme read, +axe',
    async ({ page }) => {
      let themeRequests = 0
      // playwright-utils deviation: `interceptNetworkCall`'s promise resolves only on
      // a matching call, so it cannot prove the ABSENCE of one. Counting through
      // `page.route` + `route.fallback()` can.
      await page.route(THEME_URL, async (route) => {
        themeRequests += 1
        await route.fallback()
      })

      await log.step('Load settings signed out')
      await page.goto('/settings')
      await waitForAccessibilityReady(page)

      await log.step('Assert the locked panel shows the signed-out copy, no gallery')
      await expect(lockedPanel(page)).toBeVisible()
      await expect(lockedPanel(page)).toContainText(
        'Interface palettes are a Premium feature'
      )
      await expect(lockedPanel(page)).toContainText(
        'Sign in and subscribe to Premium to unlock Jewel Radiance, Autumn Umber, and Winter Metallic.'
      )
      await expect(gallery(page)).toHaveCount(0)

      // Theme reads are not entitlement-gated, and there is still no session to spend
      // a call on.
      expect(themeRequests).toBe(0)

      await log.step('Scan the locked settings page for accessibility violations')
      await checkA11y(page, {
        includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
      })
    }
  )
})

premiumFreshTest.describe(
  'Story 5.3 premium theme switcher, signed-in non-entitled user',
  () => {
    premiumFreshTest(
      '[P1] 5.3-E2E-012 shows the locked upsell for a signed-in reader with no Premium entitlement',
      async ({
        premiumFreshSession: _premiumFreshSession,
        page,
        interceptNetworkCall,
      }) => {
        await log.step('Load settings and capture the theme read for a fresh account')
        const loaded = await openThemeSettings(page, interceptNetworkCall)

        expect(loaded.status).toBe(200)
        // A brand-new account has no entitlement, so the server resolves Default
        // regardless of the (empty) stored row.
        expect(loaded.responseJson).toEqual({
          data: { theme: null, isEntitled: false, themesEnabled: true },
        })

        await log.step(
          'Assert the locked panel shows the signed-in copy, not the signed-out one'
        )
        await expect(lockedPanel(page)).toBeVisible()
        await expect(lockedPanel(page)).toContainText(
          'Subscribe to Premium with the controls above to unlock Jewel Radiance, Autumn Umber, and Winter Metallic.'
        )
        await expect(gallery(page)).toHaveCount(0)
      }
    )
  }
)

premiumSeededTest.describe(
  'Story 5.3 premium theme switcher, seeded active subscriber (serial write journey)',
  () => {
    premiumSeededTest.use({ premiumSeedUser: 'active' })
    // This row is shared across parallel workers and this is the one test in the file
    // that writes to it for real, so it runs alone. See the file header.
    premiumSeededTest.describe.configure({ mode: 'serial' })

    premiumSeededTest.beforeEach(async ({ premiumSession, apiRequest }) => {
      await resetSeededTheme(apiRequest, premiumSession)
    })

    premiumSeededTest.afterEach(async ({ premiumSession, apiRequest }) => {
      await resetSeededTheme(apiRequest, premiumSession)
    })

    premiumSeededTest(
      '[P0] 5.3-E2E-010 selects a palette, applies it instantly, and persists across reload',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        await log.step('Load settings and capture the initial (Default) theme read')
        const loaded = await openThemeSettings(page, interceptNetworkCall)

        expect(loaded.status).toBe(200)
        expect(loaded.responseJson).toEqual({
          data: { theme: null, isEntitled: true, themesEnabled: true },
        })

        await log.step(
          'Assert the gallery renders exactly the three named palettes plus Default'
        )
        await expect(gallery(page)).toBeVisible()
        await expect(paletteOption(page, 'jewel_radiance')).toBeVisible()
        await expect(paletteOption(page, 'autumn_umber')).toBeVisible()
        await expect(paletteOption(page, 'winter_metallic')).toBeVisible()
        await expect(paletteOption(page, 'default')).toBeVisible()
        await expect(gallery(page).getByRole('button')).toHaveCount(4)
        // 5.3-WEB-001: Spring Bloom is explicitly out of scope (UX spec marks it
        // "future"); it must never render as a fifth option.
        await expect(paletteOption(page, 'spring_bloom')).toHaveCount(0)

        await log.step('Select Autumn Umber and assert the PUT and its response')
        const select = watchThemeCall(interceptNetworkCall, 'PUT')
        await paletteOption(page, 'autumn_umber').click()
        const selectResult = await select

        expect(selectResult.status).toBe(200)
        expect(selectResult.requestJson).toEqual({ theme: 'autumn_umber' })
        expect(selectResult.responseJson).toEqual({
          data: { theme: 'autumn_umber', isEntitled: true, themesEnabled: true },
        })

        await log.step('Assert the card, the preview, and the <html> attribute all moved')
        await expect(paletteOption(page, 'autumn_umber')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await expect(paletteState(page, 'autumn_umber')).toHaveText('Selected')
        await expect(page.getByTestId('premium-theme-preview')).toBeVisible()
        // The one element that pins no palette of its own, so this is the proof the
        // attribute write reached the DOM and not only the wire.
        expect(await htmlDataTheme(page)).toBe('autumn_umber')

        await log.step(
          'Reload and assert the server, not the client, remembers the choice'
        )
        const reloaded = await openThemeSettings(page, interceptNetworkCall)

        expect(reloaded.status).toBe(200)
        expect(reloaded.responseJson).toEqual({
          data: { theme: 'autumn_umber', isEntitled: true, themesEnabled: true },
        })
        await expect(paletteOption(page, 'autumn_umber')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        expect(await htmlDataTheme(page)).toBe('autumn_umber')

        await log.step('Reset to Default via the Default card and assert it round-trips')
        const reset = watchThemeCall(interceptNetworkCall, 'PUT')
        await paletteOption(page, 'default').click()
        const resetResult = await reset

        expect(resetResult.status).toBe(200)
        expect(resetResult.requestJson).toEqual({ theme: null })
        expect(resetResult.responseJson).toEqual({
          data: { theme: null, isEntitled: true, themesEnabled: true },
        })
        await expect(paletteOption(page, 'default')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await expect(paletteOption(page, 'autumn_umber')).toHaveAttribute(
          'aria-pressed',
          'false'
        )
        // `applyWebThemeAttribute(null)` writes `dataset.theme = ''`, which sets the
        // attribute to an empty string rather than removing it.
        expect(await htmlDataTheme(page)).toBe('')
      }
    )
  }
)

premiumSeededTest.describe(
  'Story 5.3 premium theme switcher, unrecognized stored value',
  () => {
    premiumSeededTest.use({ premiumSeedUser: 'active' })
    // No serial lock: the GET is fully stubbed below and no real write touches the
    // shared row, so this is safe alongside the serial block above.

    premiumSeededTest(
      '[P0] 5.3-E2E-013 falls back to Default when the stored theme is not one this build recognizes',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        /*
         * WHY THE GET IS STUBBED. `PremiumThemeKey` is a real Postgres enum
         * (`jewel_radiance | autumn_umber | winter_metallic`, `schema.prisma:192`), so
         * the database physically cannot hold a value outside that set and no `INSERT`
         * or migration path in this codebase produces a genuinely stale row to seed.
         * The server's own defense (`premium-theme.service.ts`'s
         * `isEnumConversionError` catching Prisma's P2023) only fires against a
         * database that predates a palette this build still expects, which seeding
         * cannot reproduce either. The stub exercises the client path AC 6 protects:
         * `resolvePremiumThemeKey`'s `safeParse` fallback in
         * `apps/web/src/lib/premium-theme.ts`.
         */
        await log.step(
          'Stub the GET with a theme value from a since-deferred palette (see note above)'
        )
        // Page errors only. An unrelated console.error (a failed asset request, a
        // third-party script, a warning logged at error level) would fail this test
        // with no defect in the theme fallback, and the error-panel and
        // Default-selected assertions below already prove the fallback.
        const pageErrors: string[] = []
        page.on('pageerror', (error) => {
          pageErrors.push(error.message)
        })

        const stubbedLoad = interceptNetworkCall({
          method: 'GET',
          url: THEME_URL,
          fulfillResponse: {
            status: 200,
            body: {
              // Spring Bloom is a real named palette (UX spec, "future") that this
              // build's contract enum does not include, so it stands in for a key
              // from a palette that no longer exists.
              data: { theme: 'spring_bloom', isEntitled: true, themesEnabled: true },
            },
          },
        })

        await page.goto('/settings')
        const stubbed = await stubbedLoad
        expect(stubbed.status).toBe(200)
        await waitForAccessibilityReady(page)

        await log.step('Assert the page renders Default selected, not a crash')
        await expect(gallery(page)).toBeVisible()
        await expect(page.getByTestId('premium-theme-error')).toHaveCount(0)
        await expect(lockedPanel(page)).toHaveCount(0)

        // `resolvePremiumThemeKey('spring_bloom')` fails the enum `safeParse` and
        // resolves to `null`, which is also the Default card's own `key`, so Default
        // reads as selected.
        await expect(paletteOption(page, 'default')).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await expect(paletteState(page, 'default')).toHaveText('Selected')
        await expect(paletteOption(page, 'jewel_radiance')).toHaveAttribute(
          'aria-pressed',
          'false'
        )
        await expect(paletteOption(page, 'autumn_umber')).toHaveAttribute(
          'aria-pressed',
          'false'
        )
        await expect(paletteOption(page, 'winter_metallic')).toHaveAttribute(
          'aria-pressed',
          'false'
        )

        expect(pageErrors).toEqual([])
      }
    )
  }
)
