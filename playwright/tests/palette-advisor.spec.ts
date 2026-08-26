// Story 5.4 Task 9 owner: the Playwright half of the colour palette &
// beauty/accessory advisor (`/palette`, `palette-advisor-panel.tsx`,
// `apps/web/src/lib/palette-advisor.ts`).
//
// STRUCTURE MIRRORS `premium-theme-switcher.spec.ts` (same domain, same
// fixtures): the same network-first `open*` helper built on
// `interceptNetworkCall`, the same `log.step` narration, and the same
// `page.route` + `route.fallback()` pattern for the signed-out zero-call
// assertion (an `interceptNetworkCall` promise only resolves once a matching
// call happens, so it cannot prove the ABSENCE of one).
//
// WRITE SAFETY. This suite writes for real, against a seeded user shared across
// parallel workers, and it writes MORE than 5.3 did: `PaletteProfile` (consent,
// the derived palette, the analysis lifecycle) and `AdvisorRecommendationState`
// rows. Both are erased by a single `DELETE /api/v1/commerce/premium/palette`,
// which is the same path the UI's own withdraw control runs, so cleanup needs no
// private access. The writing block runs under
// `test.describe.configure({ mode: 'serial' })` and resets in BOTH `beforeEach`
// and `afterEach`, so a run that crashes mid-test still leaves the fixture clean
// for the next one and a fresh checkout starts from a known state.
//
// THE WARDROBE JOURNEY IS REAL, NOT STUBBED. `POST /analyze` enqueues a BullMQ
// job that the E2E stack's own wardrobe worker consumes
// (`scripts/start-api-e2e-with-workers.mjs`), reading the `PaletteInsights` rows
// `seedPaletteAdvisorWardrobe` writes for this account -- ten garments, every
// one carrying `#C9A14A`, whose CIELAB hue of 84.1 degrees puts it in the olive
// wedge. The derived undertone is therefore a fixed value to assert, not a
// range, and `depth` is null because garment colour is not evidence of skin
// depth (AC 2/AC 4).
import type { Locator, Page } from '@playwright/test'
import type { ApiRequestFixtureParams } from '@seontechnologies/playwright-utils/api-request'
import { log } from '@seontechnologies/playwright-utils/log'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { ADVISOR_RULES } from '@couture/api-client/contracts/http'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import {
  expect,
  premiumFreshTest,
  premiumSeededTest,
  type PremiumSession,
} from '../support/helpers/premium-session'
import { test as anonymousTest } from '../support/fixtures/merged-fixtures'

const PALETTE_PATH = '/api/v1/commerce/premium/palette'
const PALETTE_URL = `**${PALETTE_PATH}`

/** The classification the seeded `#C9A14A` wardrobe produces, pinned. */
const SEEDED_UNDERTONE = 'olive'
const SEEDED_FOUNDATION_ITEM_KEY = ADVISOR_RULES.olive.foundation.withoutDepth.itemKey

type PaletteExchange = {
  status: number
  requestJson: unknown
  responseJson: { data: Record<string, unknown> } | null
}

function watchPaletteCall(
  interceptNetworkCall: InterceptNetworkCallFn,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string = PALETTE_URL
): Promise<PaletteExchange> {
  return interceptNetworkCall({ method, url }).then((result) => ({
    status: result.status,
    requestJson: result.requestJson,
    responseJson: result.responseJson as { data: Record<string, unknown> } | null,
  }))
}

/**
 * Network-first, like the theme and subscription suites' own `open*` helpers:
 * the profile read is registered before the navigation that triggers it, so the
 * spec never races the page.
 */
async function openPalette(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<PaletteExchange> {
  const load = watchPaletteCall(interceptNetworkCall, 'GET')

  await page.goto('/palette')

  const exchange = await load
  await waitForAccessibilityReady(page)

  return exchange
}

type ApiRequestFn = <T = unknown>(
  params: ApiRequestFixtureParams
) => Promise<{ status: number; body: T }>

/**
 * Erases everything this suite can write, through the same public `DELETE` the
 * withdraw control uses.
 *
 * Asserted rather than fire-and-forget: this row is shared across parallel
 * workers, so a silently failed reset would leave the next run's first assertion
 * pointing at the wrong symptom instead of at the cleanup failure.
 */
async function resetSeededPalette(
  apiRequest: ApiRequestFn,
  session: PremiumSession
): Promise<void> {
  const response = await apiRequest({
    method: 'DELETE',
    path: PALETTE_PATH,
    baseUrl: session.apiBaseUrl,
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  expect(response.status).toBe(200)
}

function panel(page: Page): Locator {
  return page.getByTestId('palette-advisor-panel')
}

function lockedPanel(page: Page): Locator {
  return page.getByTestId('palette-advisor-locked')
}

function consentBlock(page: Page): Locator {
  return page.getByTestId('palette-advisor-consent')
}

function recommendations(page: Page): Locator {
  return page.getByTestId('palette-advisor-recommendations')
}

anonymousTest.describe('Story 5.4 palette advisor, signed out', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 375, height: 812 },
  ] as const) {
    anonymousTest(
      `[P0] 5.4-E2E-011 shows the locked upsell signed out with no palette read, +axe (${viewport.name})`,
      async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })

        let paletteRequests = 0
        // playwright-utils deviation: interceptNetworkCall's promise only
        // resolves on a matching call, so it cannot structurally prove an
        // absence of one; see the file header.
        await page.route(PALETTE_URL, async (route) => {
          paletteRequests += 1
          await route.fallback()
        })

        await log.step('Load /palette signed out')
        await page.goto('/palette')
        await waitForAccessibilityReady(page)

        await log.step('Assert the locked panel shows the signed-out copy, no advisor')
        await expect(panel(page)).toBeVisible()
        await expect(lockedPanel(page)).toBeVisible()
        await expect(lockedPanel(page)).toContainText('Color advice is a Premium feature')
        await expect(lockedPanel(page)).toContainText('Sign in and subscribe to Premium')
        await expect(consentBlock(page)).toHaveCount(0)
        await expect(page.getByTestId('palette-advisor-sources')).toHaveCount(0)

        // There is no session to spend a call on: the panel checks
        // `hasWebSession()` before it reads, exactly as the theme section does.
        expect(paletteRequests).toBe(0)

        await log.step('Scan the locked page for accessibility violations')
        await checkA11y(page, {
          includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
        })
      }
    )
  }

  /**
   * Decision 14. `/palette` is a destination route that belongs to no bottom-nav
   * tab, and the exact-equality active-tab match this story replaced would have
   * highlighted Home here -- telling the reader they were somewhere they are not.
   */
  anonymousTest(
    '[P1] 5.4-E2E-014 highlights no bottom-nav tab on /palette',
    async ({ page }) => {
      // The bottom nav is `min-[768px]:hidden`, so it exists in the DOM at
      // every width and is only VISIBLE on a phone viewport. Asserting it at
      // the default 1280-wide viewport resolved the element fourteen times and
      // read "hidden" every time. 375x812 is the width story 3.6's own
      // bottom-nav spec uses for exactly this reason.
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto('/palette')
      await waitForAccessibilityReady(page)

      await expect(page.getByTestId('sticky-bottom-nav')).toBeVisible()
      for (const tab of ['home', 'wardrobe', 'community', 'settings']) {
        await expect(page.getByTestId(`bottom-nav-${tab}`)).not.toHaveAttribute(
          'aria-current',
          'page'
        )
      }
    }
  )
})

premiumFreshTest.describe(
  'Story 5.4 palette advisor, signed-in non-entitled user',
  () => {
    premiumFreshTest(
      '[P0] 5.4-E2E-013 shows the locked upsell for a signed-in reader with no Premium entitlement',
      async ({
        premiumFreshSession: _premiumFreshSession,
        page,
        interceptNetworkCall,
      }) => {
        await log.step('Load /palette and capture the profile read for a fresh account')
        const loaded = await openPalette(page, interceptNetworkCall)

        expect(loaded.status).toBe(200)
        expect(loaded.responseJson?.data).toMatchObject({
          isEntitled: false,
          hasConsent: false,
          analysis: null,
          recommendations: [],
        })

        await log.step(
          'Assert the locked panel shows the signed-in copy, and no consent control'
        )
        await expect(lockedPanel(page)).toBeVisible()
        await expect(lockedPanel(page)).toContainText(
          'Subscribe to Premium from Settings'
        )
        // The consent gate must never be reachable for a non-entitled reader: it
        // would invite a grant the guard rejects pre-handler.
        await expect(consentBlock(page)).toHaveCount(0)
      }
    )
  }
)

premiumSeededTest.describe(
  'Story 5.4 palette advisor, seeded active subscriber (serial write journey)',
  () => {
    premiumSeededTest.use({ premiumSeedUser: 'active' })
    // See the file header: this account is shared across parallel workers and
    // this block writes consent, an analysis and recommendation state for real.
    premiumSeededTest.describe.configure({ mode: 'serial' })

    premiumSeededTest.beforeEach(async ({ premiumSession, apiRequest }) => {
      await resetSeededPalette(apiRequest, premiumSession)
    })

    premiumSeededTest.afterEach(async ({ premiumSession, apiRequest }) => {
      await resetSeededPalette(apiRequest, premiumSession)
    })

    premiumSeededTest(
      '[P0] 5.4-E2E-010 grants consent, derives a wardrobe palette, dismisses a card, and survives reload',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        await log.step('Load /palette and capture the initial (no consent) read')
        const loaded = await openPalette(page, interceptNetworkCall)

        expect(loaded.status).toBe(200)
        expect(loaded.responseJson?.data).toMatchObject({
          isEntitled: true,
          analysisEnabled: true,
          hasConsent: false,
          analysis: null,
        })

        await log.step('Assert the consent gate hides both sources until it is granted')
        await expect(consentBlock(page)).toBeVisible()
        await expect(page.getByTestId('palette-advisor-sources')).toHaveCount(0)

        await log.step('Grant consent and assert the request and its response')
        const consent = watchPaletteCall(
          interceptNetworkCall,
          'POST',
          `**${PALETTE_PATH}/consent`
        )
        await page.getByTestId('palette-advisor-consent-grant').click()
        const consentResult = await consent

        expect(consentResult.status).toBe(200)
        expect(consentResult.requestJson).toEqual({ granted: true })
        expect(consentResult.responseJson?.data).toMatchObject({ hasConsent: true })
        await expect(page.getByTestId('palette-advisor-consent-granted')).toBeVisible()
        await expect(page.getByTestId('palette-advisor-source-wardrobe')).toBeVisible()

        await log.step('Derive a palette from the seeded wardrobe')
        const analyze = watchPaletteCall(
          interceptNetworkCall,
          'POST',
          `**${PALETTE_PATH}/analyze`
        )
        await page.getByTestId('palette-advisor-source-wardrobe').click()
        const analyzeResult = await analyze

        // 202, not 200: the analysis is enqueued for the worker, not performed
        // inline, and the body carries `processing` rather than a result.
        expect(analyzeResult.status).toBe(202)
        expect(analyzeResult.requestJson).toEqual({ source: 'wardrobe' })

        await log.step('Poll until the worker publishes a ready palette')
        // The worker is a real process here. Reloading rather than waiting for a
        // push: no socket carries analysis completion (stated deferral), so the
        // client's own answer to "is it done" is another read.
        await expect
          .poll(
            async () => {
              await page.reload()
              await waitForAccessibilityReady(page)
              return page.getByTestId('palette-advisor-undertone').textContent()
            },
            { timeout: 30_000, intervals: [500, 1_000, 2_000] }
          )
          .toBeTruthy()

        await log.step('Assert the derived palette is the pinned wardrobe classification')
        await expect(page.getByTestId('palette-advisor-undertone')).toHaveText('Olive')
        // AC 2/AC 4: clothing colour cannot evidence skin depth, so `depth` is
        // null and foundation degrades to family guidance that says why.
        await expect(page.getByTestId('palette-advisor-depth')).toHaveText('Not measured')
        await expect(
          page.getByTestId('palette-advisor-foundation-depth-unknown')
        ).toBeVisible()

        await log.step('Assert the sponsored disclosure renders before its CTA')
        const foundationCard = page.getByTestId(
          `palette-advisor-card-${SEEDED_FOUNDATION_ITEM_KEY}`
        )
        await expect(foundationCard).toBeVisible()
        const disclosure = page.getByTestId(
          `palette-advisor-sponsored-disclosure-${SEEDED_FOUNDATION_ITEM_KEY}`
        )
        await expect(
          page.getByTestId(`palette-advisor-sponsored-cta-${SEEDED_FOUNDATION_ITEM_KEY}`)
        ).toBeVisible()
        await expect(disclosure).toBeVisible()
        await expect(disclosure).toContainText('CoutureCast earns a commission')
        // Reading order, not merely presence: a CSS reorder would move the
        // control visually while leaving both elements on the page.
        const disclosurePrecedesCta = await page.evaluate(
          ([disclosureId, ctaId]) => {
            const a = document.querySelector(`[data-testid="${disclosureId}"]`)
            const b = document.querySelector(`[data-testid="${ctaId}"]`)
            if (!a || !b) return false
            return Boolean(
              a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            )
          },
          [
            `palette-advisor-sponsored-disclosure-${SEEDED_FOUNDATION_ITEM_KEY}`,
            `palette-advisor-sponsored-cta-${SEEDED_FOUNDATION_ITEM_KEY}`,
          ]
        )
        expect(disclosurePrecedesCta).toBe(true)

        await log.step('Save the foundation card and assert it persists across reload')
        const save = watchPaletteCall(
          interceptNetworkCall,
          'PUT',
          `**${PALETTE_PATH}/recommendations`
        )
        await page
          .getByTestId(`palette-advisor-save-${SEEDED_FOUNDATION_ITEM_KEY}`)
          .click()
        const saveResult = await save

        expect(saveResult.status).toBe(200)
        expect(saveResult.requestJson).toEqual({
          itemKey: SEEDED_FOUNDATION_ITEM_KEY,
          slot: 'foundation',
          action: 'saved',
        })
        await expect(
          page.getByTestId(`palette-advisor-saved-${SEEDED_FOUNDATION_ITEM_KEY}`)
        ).toBeVisible()

        const afterSave = await openPalette(page, interceptNetworkCall)
        expect(afterSave.status).toBe(200)
        await expect(
          page.getByTestId(`palette-advisor-saved-${SEEDED_FOUNDATION_ITEM_KEY}`)
        ).toBeVisible()

        await log.step('Dismiss a card and assert it does not reappear on the next read')
        const jewelryItemKey = ADVISOR_RULES[SEEDED_UNDERTONE].jewelry.itemKey
        const dismiss = watchPaletteCall(
          interceptNetworkCall,
          'PUT',
          `**${PALETTE_PATH}/recommendations`
        )
        await page.getByTestId(`palette-advisor-dismiss-${jewelryItemKey}`).click()
        const dismissResult = await dismiss

        expect(dismissResult.status).toBe(200)
        await expect(
          page.getByTestId(`palette-advisor-card-${jewelryItemKey}`)
        ).toHaveCount(0)

        const afterDismiss = await openPalette(page, interceptNetworkCall)
        expect(afterDismiss.status).toBe(200)
        await expect(recommendations(page)).toBeVisible()
        // AC 6's whole point: the server omits it, so it is gone after a full
        // reload rather than only hidden by client state.
        await expect(
          page.getByTestId(`palette-advisor-card-${jewelryItemKey}`)
        ).toHaveCount(0)
        await expect(
          page.getByTestId(`palette-advisor-saved-${SEEDED_FOUNDATION_ITEM_KEY}`)
        ).toBeVisible()
      }
    )
  }
)

premiumSeededTest.describe('Story 5.4 palette advisor, stale analysis version', () => {
  premiumSeededTest.use({ premiumSeedUser: 'active' })
  // No serial lock: the GET is fully stubbed below and no real write touches
  // the shared account, so this is safe alongside the serial block above.

  premiumSeededTest(
    '[P0] 5.4-E2E-012 renders a ready palette whose analysis_version this build does not know',
    async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
      /*
       * ARRANGEMENT NOTE, and the same wall story 5.3 hit. Every enum on this
       * row is a real Postgres enum, so the database physically cannot hold an
       * out-of-enum `undertone` or `status` to seed. `analysis_version` IS a
       * free-text column, but the only writer is the processor, which always
       * stamps `ADVISOR_RULES_VERSION`; there is no INSERT path in this
       * codebase that produces a genuinely retired version. Stubbing the GET is
       * therefore the real client path AC 4 protects: the server skips an
       * `item_key` it can no longer resolve, so the client receives a `ready`
       * palette with an empty card list and must render a result rather than a
       * crash or an error state.
       */
      const pageErrors: string[] = []
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })

      const stubbedLoad = interceptNetworkCall({
        method: 'GET',
        url: PALETTE_URL,
        fulfillResponse: {
          status: 200,
          body: {
            data: {
              profileId: 'stubbed-profile',
              isEntitled: true,
              analysisEnabled: true,
              hasConsent: true,
              analysis: {
                status: 'ready',
                failureReason: null,
                source: 'selfie',
                undertone: 'warm',
                depth: 'medium',
                confidence: 0.9,
                // A version this build has never shipped: every stored
                // `item_key` from it resolves to nothing server-side.
                analysisVersion: 'palette-advisor-v0-retired',
                analyzedAt: '2026-01-01T00:00:00.000Z',
              },
              recommendations: [],
            },
          },
        },
      })

      await page.goto('/palette')
      const stubbed = await stubbedLoad
      expect(stubbed.status).toBe(200)
      await waitForAccessibilityReady(page)

      await log.step('Assert the result renders with no cards and no error')
      await expect(page.getByTestId('palette-advisor-result')).toBeVisible()
      await expect(page.getByTestId('palette-advisor-undertone')).toHaveText('Warm')
      await expect(page.getByTestId('palette-advisor-error')).toHaveCount(0)
      await expect(lockedPanel(page)).toHaveCount(0)
      // `toBeAttached`, not `toBeVisible`. The claim is that the list RENDERS
      // and is empty, which is the whole point of a retired `analysis_version`:
      // the result panel stays, no card resolves, and nothing errors. An empty
      // `<ul>` has no content and therefore no bounding box, so Playwright
      // reports it `hidden` however correct the DOM is -- asserting visibility
      // here asserts something the fixture makes impossible by construction.
      await expect(recommendations(page)).toBeAttached()
      await expect(recommendations(page).getByRole('listitem')).toHaveCount(0)

      expect(pageErrors).toEqual([])
    }
  )
})
