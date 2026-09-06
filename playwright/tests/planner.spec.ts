// Story 5.5: the web premium 7-day outfit planner (AC 1, 3, 4, 7) against the real
// running web+API+DB stack. `planner-rail.test.tsx` proves every state at the
// component layer with a mocked network; this spec proves the same journeys survive
// the real `PlannerRail` -> `apps/web/src/lib/planner.ts` -> Next.js rewrite ->
// `PlannerController`/`PlannerService` -> Postgres round trip, using the seeded
// `premium-active-user` account (`packages/db/prisma/seeds/commerce.ts`).
//
// WRITE SAFETY. `premium-active-user` is shared across every spec file and worker
// (see `premium-session.ts`'s file header). The reshuffle/reload test below writes a
// real `PlannerDayPlan` row for it, so this file's tests run under
// `test.describe.configure({ mode: 'serial' })`. There is no reset step: every
// assertion reads its expectation from the live response it just captured, so a row
// left behind by an earlier run is a valid starting point.
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  plannerResponseSchema,
  type PlannerDayResult,
  type PlannerReadyDay,
  type PlannerResponse,
} from '@couture/api-client/contracts/http'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment, resolveApiBaseUrl } from '../support/helpers/api-test'
import {
  ensurePremiumSeedLocation,
  expect,
  premiumSeededTest,
  PREMIUM_SEED_USERS,
} from '../support/helpers/premium-session'

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const PLANNER_URL = `**${PLANNER_PATH}`
const RESHUFFLE_URL = `**${PLANNER_PATH}/*/reshuffle`

function plannerDayLocator(page: Page, planDate: string) {
  return page.getByTestId(`planner-day-${planDate}`)
}

/** The first garment id a ready day's cards render, if any. A
 * starter-wardrobe-only day may legitimately have none: this seeded account owns
 * ten `top` garments and nothing else. */
function firstDisplayGarmentId(day: PlannerReadyDay): string | null {
  for (const outfit of day.outfits) {
    const garment = outfit.displayGarments[0]
    if (garment) return garment.id
  }
  return null
}

/**
 * Clicks the hero "Plan week" control and returns the real GET it triggers. The
 * watch is registered right before the click: Decision 7 fetches nothing until the
 * rail opens, so there is no page-load race to protect against.
 */
async function openPlanner(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<{ status: number; data: PlannerResponse['data'] | undefined }> {
  const load = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
  await page.getByTestId('planner-open-control').click()
  const loaded = await load
  const body = loaded.responseJson as { data: PlannerResponse['data'] } | null
  return { status: loaded.status, data: body?.data }
}

/**
 * Asserts the rendered week is the LIVE response just captured over the network.
 * Every assertion below reads its expectation off `data` itself, garment ids
 * included: a static fixture could never echo back this seeded account's real
 * `GarmentItem` ids.
 */
async function assertLiveWeekRendered(page: Page, data: PlannerResponse['data']) {
  await expect(page.getByTestId('planner-days')).toBeVisible()
  await expect(page.locator('[data-testid^="planner-day-"]')).toHaveCount(7)

  const planDates = data.days.map((day) => day.planDate)
  expect(new Set(planDates).size).toBe(7)

  for (const [index, day] of data.days.entries()) {
    const dayLocator = plannerDayLocator(page, day.planDate)
    await expect(dayLocator).toBeVisible()

    if (day.status !== 'ready') continue

    if (index === 0) await expect(dayLocator).toContainText('Today')
    if (index === 1) await expect(dayLocator).toContainText('Tomorrow')

    for (const scenario of ['morning', 'midday', 'evening'] as const) {
      await expect(dayLocator.getByTestId(`planner-outfit-${scenario}`)).toBeVisible()
    }

    if (day.weather.confidence === 'unavailable') {
      await expect(dayLocator.getByTestId('planner-weather-unavailable')).toBeVisible()
    } else {
      await expect(dayLocator.getByTestId('planner-weather')).toBeVisible()
    }

    if (day.isStarterWardrobe) {
      await expect(
        dayLocator.getByTestId(`planner-starter-${day.planDate}`)
      ).toBeVisible()
    }

    const garmentId = firstDisplayGarmentId(day)
    if (garmentId) {
      // `.first()`: the seeded account's eligible wardrobe is narrow enough
      // (`packages/db/prisma/seeds/commerce.ts`'s `seedPaletteAdvisorWardrobe`
      // gives it `top` garments only) that the SAME garment id legitimately
      // renders once per scenario, up to three times in one day's card. A bare
      // `getByTestId` here is a strict-mode violation against real seeded data.
      await expect(
        dayLocator.getByTestId(`planner-garment-${garmentId}`).first()
      ).toBeVisible()
    }
  }
}

premiumSeededTest.describe(
  'Story 5.5 premium 7-day planner, seeded active subscriber (serial journey)',
  () => {
    premiumSeededTest.use({ premiumSeedUser: 'active' })
    premiumSeededTest.describe.configure({ mode: 'serial' })

    premiumSeededTest.beforeAll(async ({ request }, testInfo) => {
      // Off the local stack there may be no reachable API base URL, so skip.
      if (isNonLocalEnvironment(testInfo)) return
      const apiBaseUrl = resolveApiBaseUrl(testInfo, {
        fallback: 'http://localhost:4000',
      })
      // AC 1 needs an owned saved location to resolve a window against, and nothing
      // in the seed graph gives this account one. `ensurePremiumSeedLocation`'s
      // docblock says why it is check-then-create.
      await ensurePremiumSeedLocation(request, apiBaseUrl, PREMIUM_SEED_USERS.active.id)
    })

    premiumSeededTest(
      '[P0] 5.5-E2E-01 opens as a focus-trapped overlay below 1440px and renders the live seven-day week, +axe',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        // Matches `lookbook-prism.spec.ts`'s own overlay-boundary width.
        await page.setViewportSize({ width: 1280, height: 900 })

        await log.step('Load / and assert the planner is closed by default')
        await page.goto('/')
        await waitForAccessibilityReady(page)
        const planner = page.getByRole('complementary', { name: 'Planner Rail' })
        await expect(planner).toBeHidden()

        await log.step('Open the planner and capture the live GET')
        const { status, data } = await openPlanner(page, interceptNetworkCall)
        expect(status).toBe(200)
        if (!data) throw new Error('Planner GET returned no data')
        await expect(planner).toBeVisible()

        await log.step(
          'Assert the overlay renders outside the layout grid and traps focus on open'
        )
        await expect(
          page
            .getByTestId('lookbook-prism-grid')
            .getByRole('complementary', { name: 'Planner Rail' })
        ).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Close planner' })).toBeFocused()

        await log.step('Assert the live seven-day week rendered, not a static fixture')
        await assertLiveWeekRendered(page, data)

        await log.step('Scan the open, entitled, week-loaded overlay for a11y violations')
        await checkA11y(page)
      }
    )

    premiumSeededTest(
      '[P0] 5.5-E2E-02 opens as an inline rail at 1440px and wider and renders the live seven-day week, +axe',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        await page.setViewportSize({ width: 1440, height: 900 })

        await log.step('Load / and assert the planner is closed by default')
        await page.goto('/')
        await waitForAccessibilityReady(page)
        const planner = page.getByRole('complementary', { name: 'Planner Rail' })
        await expect(planner).toBeHidden()

        await log.step('Open the planner and capture the live GET')
        const { status, data } = await openPlanner(page, interceptNetworkCall)
        expect(status).toBe(200)
        if (!data) throw new Error('Planner GET returned no data')
        await expect(planner).toBeVisible()

        await log.step(
          'Assert the rail renders inline as the third grid column, not focus-trapped'
        )
        await expect(
          page
            .getByTestId('lookbook-prism-grid')
            .getByRole('complementary', { name: 'Planner Rail' })
        ).toBeVisible()
        // Decision 7: the rail variant is ordinary page content, so opening it must
        // never steal focus onto a close control the way the overlay does.
        await expect(page.getByTestId('planner-open-control')).toBeFocused()

        await log.step('Assert the live seven-day week rendered, not a static fixture')
        await assertLiveWeekRendered(page, data)

        await log.step('Scan the open, entitled, week-loaded rail for a11y violations')
        await checkA11y(page)
      }
    )

    premiumSeededTest(
      '[P0] 5.5-E2E-03 reshuffles a day, announces the update, and the result survives a full reload',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        await page.setViewportSize({ width: 1440, height: 900 })

        await log.step('Open the planner and pick the first ready day')
        await page.goto('/')
        await waitForAccessibilityReady(page)
        const { status: loadStatus, data } = await openPlanner(page, interceptNetworkCall)
        expect(loadStatus).toBe(200)
        if (!data) throw new Error('Planner GET returned no data')
        const target = data.days.find(
          (day): day is PlannerReadyDay => day.status === 'ready'
        )
        if (!target) throw new Error('Seeded account has no ready day to reshuffle')
        const dayLocator = plannerDayLocator(page, target.planDate)

        await log.step('Reshuffle it and capture the real response')
        const reshuffle = interceptNetworkCall({ method: 'POST', url: RESHUFFLE_URL })
        await dayLocator.getByTestId(`planner-reshuffle-${target.planDate}`).click()
        const reshuffled = await reshuffle
        expect(reshuffled.status).toBe(200)
        const { day: updated, unchanged } = (
          reshuffled.responseJson as {
            data: { day: PlannerReadyDay; unchanged: boolean }
          }
        ).data
        // Decision 4: version increments on every successful reshuffle, whether or
        // not the outfit content changed.
        expect(updated.version).toBe(target.version + 1)

        await log.step(
          'Assert the announcement matches what the server actually reported'
        )
        // Scoped to the planner landmark: the page carries other unrelated
        // `role="status"` live regions (the lookbook feed's own "Showing ..."
        // announcements), so an unscoped `page.getByRole('status')` is a
        // strict-mode violation against the real page.
        const liveRegion = page
          .getByRole('complementary', { name: 'Planner Rail' })
          .getByRole('status')
        if (unchanged) {
          await expect(liveRegion).toHaveText(
            'No new combination available for this day.'
          )
        } else {
          await expect(liveRegion).toContainText('outfit updated.')
          const newGarmentId = firstDisplayGarmentId(updated)
          if (newGarmentId) {
            // `.first()`: see `assertLiveWeekRendered`. The narrow seeded wardrobe
            // can legitimately place the same garment in more than one scenario.
            await expect(
              dayLocator.getByTestId(`planner-garment-${newGarmentId}`).first()
            ).toBeVisible()
          }
        }
        await expect(
          dayLocator.getByTestId(`planner-reshuffle-${target.planDate}`)
        ).not.toBeDisabled()

        await log.step('Reload, reopen the planner, and assert the reshuffle persisted')
        await page.reload()
        await waitForAccessibilityReady(page)
        const { status: reloadStatus, data: reloadedData } = await openPlanner(
          page,
          interceptNetworkCall
        )
        expect(reloadStatus).toBe(200)
        if (!reloadedData) throw new Error('Planner GET returned no data on reload')
        const persisted = reloadedData.days.find(
          (day) => day.planDate === target.planDate
        )
        expect(persisted?.status).toBe('ready')
        if (persisted?.status === 'ready') {
          // An unchanged dependency fingerprint returns the exact same version
          // (Decision 9/AC 9), so a mismatch here means the reshuffle never
          // reached the database.
          expect(persisted.version).toBe(updated.version)
        }
        await expect(plannerDayLocator(page, target.planDate)).toBeVisible()
        const persistedGarmentId =
          persisted?.status === 'ready' ? firstDisplayGarmentId(persisted) : null
        if (persistedGarmentId) {
          await expect(
            plannerDayLocator(page, target.planDate)
              .getByTestId(`planner-garment-${persistedGarmentId}`)
              .first()
          ).toBeVisible()
        }
      }
    )

    premiumSeededTest(
      '[P1] 5.5-E2E-04 recovers an isolated day error via retry without disturbing the other six ready days',
      async ({ premiumSession, page, apiRequest, interceptNetworkCall }) => {
        await page.setViewportSize({ width: 1440, height: 900 })

        // AC 3/4's per-day 'error' result only comes from an exception thrown inside
        // `PlannerService#resolveOneDay` (see `planner.service.ts`'s
        // `buildErrorDay`). `planner.service.spec.ts` reaches that branch by poking
        // a hole in `JSON.stringify` for one call; no request shape, header or
        // seeded state reaches it through the real API, and this story rules out
        // touching `packages/db` to fabricate a malformed row. So this test fetches
        // the REAL live week first, then swaps exactly one date to 'error' before
        // the first render. The stub is one-shot: the retry below is a real request
        // that reaches the real backend and gets the real, fully-ready week back.
        const real = (await apiRequest({
          method: 'GET',
          path: PLANNER_PATH,
          baseUrl: premiumSession.apiBaseUrl,
          headers: {
            Authorization: `Bearer ${premiumSession.accessToken}`,
            'x-couture-platform': 'web',
          },
        })) as { status: number; body: { data: PlannerResponse['data'] } }
        expect(real.status).toBe(200)
        const realData = real.body.data
        const targetIndex = realData.days.findIndex((day) => day.status === 'ready')
        expect(targetIndex).toBeGreaterThanOrEqual(0)
        const targetDate = realData.days[targetIndex]!.planDate
        const injectedDays: PlannerDayResult[] = realData.days.map((day, index) =>
          index === targetIndex
            ? {
                status: 'error',
                planDate: targetDate,
                errorCode: 'generation_failed',
                retryable: true,
              }
            : day
        )
        // Validated through the real published schema before it goes on the wire,
        // which proves the injected fixture is contract-shaped, seven unique
        // consecutive dates included.
        const injected = plannerResponseSchema.parse({
          data: {
            ...realData,
            daysReady: injectedDays.filter((day) => day.status === 'ready').length,
            days: injectedDays,
          },
        })

        let firstRequestServed = false
        await page.route(`**${PLANNER_PATH}`, async (route, request) => {
          if (firstRequestServed || request.method() !== 'GET') {
            await route.fallback()
            return
          }
          firstRequestServed = true
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(injected),
          })
        })

        await log.step(
          'Open the planner and assert the isolated error card beside six ready days'
        )
        await page.goto('/')
        await waitForAccessibilityReady(page)
        await page.getByTestId('planner-open-control').click()
        await expect(page.getByTestId('planner-days')).toBeVisible()

        const errorCard = plannerDayLocator(page, targetDate)
        await expect(errorCard).toContainText("This day couldn't be generated.")
        const retryButton = page.getByTestId(`planner-retry-${targetDate}`)
        await expect(retryButton).toBeVisible()
        for (const day of realData.days) {
          if (day.planDate === targetDate) continue
          await expect(plannerDayLocator(page, day.planDate)).toBeVisible()
        }
        await expect(page.locator('[data-testid^="planner-day-"]')).toHaveCount(7)

        await log.step(
          'Retry the failed date; the stub is spent, so this hits the real API'
        )
        const retry = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
        await retryButton.click()
        const retried = await retry
        expect(retried.status).toBe(200)
        const retriedData = (retried.responseJson as { data: PlannerResponse['data'] })
          .data
        const recoveredDay = retriedData.days.find((day) => day.planDate === targetDate)
        expect(recoveredDay?.status).toBe('ready')
        await expect(page.getByTestId(`planner-retry-${targetDate}`)).not.toBeVisible()
        await expect(page.locator('[data-testid^="planner-day-"]')).toHaveCount(7)
        for (const day of retriedData.days) {
          await expect(plannerDayLocator(page, day.planDate)).toBeVisible()
        }
      }
    )

    premiumSeededTest(
      '[P1] 5.5-E2E-05 restores focus to the opener when the overlay closes, via Escape and the close control',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.goto('/')
        await waitForAccessibilityReady(page)

        const openControl = page.getByTestId('planner-open-control')
        const planner = page.getByRole('complementary', { name: 'Planner Rail' })

        await log.step('Open the overlay and assert focus moves into it')
        const firstLoad = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
        await openControl.click()
        await firstLoad
        await expect(planner).toBeVisible()
        await expect(page.getByRole('button', { name: 'Close planner' })).toBeFocused()

        await log.step('Escape closes the overlay and restores focus to the opener')
        await page.keyboard.press('Escape')
        await expect(planner).toBeHidden()
        await expect(openControl).toBeFocused()

        await log.step('The close control also restores focus to the opener')
        const secondLoad = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
        await openControl.click()
        await secondLoad
        await expect(planner).toBeVisible()
        await page.getByRole('button', { name: 'Close planner' }).click()
        await expect(planner).toBeHidden()
        await expect(openControl).toBeFocused()
      }
    )
  }
)
