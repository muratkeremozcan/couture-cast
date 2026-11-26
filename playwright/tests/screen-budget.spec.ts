// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-E2E-001..014. Each web tab under each spec D1 fixture at
// 390 x 844 runs the shared measure and verdict (AC1, AC2); the limits and the `known` ratchet
// live in packages/utils/src/screen-budget.json. The home actions probe (AC3) is in
// screen-budget-home-actions.spec.ts, so smart sharding spreads the two (P10).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import {
  evaluateScreenBudget,
  screenBudgetMeasureConfig,
  measureScreenBudget,
} from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  BUDGET_FIXTURES,
  BUDGET_SCREENS,
  expectMeasureFloors,
  expectWithinBudget,
  measureWebScreen,
  openBudgetScreen,
} from '../support/helpers/screen-budget'
import { POPULATED_GARMENTS } from '../support/helpers/shell-fixtures'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test.describe('CC-7.10 screen budget on web @local-lane', () => {
  let id = 0
  for (const fixture of BUDGET_FIXTURES) {
    for (const screen of BUDGET_SCREENS) {
      id += 1
      const testId = `7.10-E2E-${String(id).padStart(3, '0')}`
      test(`[P0] [${testId}] web ${screen} (${fixture}) is within the screen budget`, async ({
        page,
        interceptNetworkCall,
      }, testInfo) => {
        const { router } = await openBudgetScreen(
          page,
          interceptNetworkCall,
          screen,
          fixture
        )
        const measurement = await measureWebScreen(page, screen)
        expectMeasureFloors(measurement, screen)
        expect(
          router.unknown().filter((request) => request.startsWith('GET ')),
          'reads the shell fixtures do not serve: add them to helpers/shell-fixtures.ts'
        ).toEqual([])
        expect(router.unauthenticated(), 'member reads sent without the bearer').toEqual(
          []
        )
        await expectWithinBudget(testInfo, screen, fixture, measurement)
      })
    }
  }

  test('[P0] [7.10-E2E-013] a second gold button on Closet fails naming closet, the fixture, primary-buttons, 2 > 1 and the element', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openBudgetScreen(page, interceptNetworkCall, 'closet', 'populated')
    // A copy of the one gold action, so the injected button paints exactly as the app paints it.
    await page.evaluate(() => {
      const gold = getComputedStyle(document.documentElement).getPropertyValue(
        '--cc-primary'
      )
      const button = document.createElement('button')
      button.dataset.testid = 'injected-second-primary'
      button.textContent = 'Second primary'
      button.style.background = `rgb(${gold.trim()})`
      button.style.minHeight = '44px'
      document.querySelector('main')?.prepend(button)
    })
    const measurement = await page.evaluate(
      measureScreenBudget,
      screenBudgetMeasureConfig('web', 'closet')
    )
    const evaluation = evaluateScreenBudget({
      platform: 'web',
      screen: 'closet',
      fixture: 'populated',
      measurement,
    })
    const primary = evaluation.failures.find(
      (failure) => failure.rule === 'primary-buttons'
    )
    expect(primary?.message).toMatch(
      /^web closet \(populated\) primary-buttons: 2 > 1: .*injected-second-primary/
    )
  })

  test('[P1] [7.10-E2E-014] populated Closet: garment tiles above the fold count as no target', async ({
    page,
    interceptNetworkCall,
  }) => {
    await openBudgetScreen(page, interceptNetworkCall, 'closet', 'populated')
    await expect(
      page.locator('[data-testid^="garment-card-shell-garment-"]')
    ).toHaveCount(POPULATED_GARMENTS)
    const config = screenBudgetMeasureConfig('web', 'closet')
    const measured = await page.evaluate(measureScreenBudget, config)
    // Negative control: the same screen without the tile opt-out counts the tiles' controls.
    const withoutTiles = await page.evaluate(measureScreenBudget, {
      ...config,
      tileSelectors: [],
    })
    expect(measured.stats.tileTargets, 'tile targets found and excluded').toBeGreaterThan(
      0
    )
    expect(withoutTiles.stats.tileTargets).toBe(0)
    expect(
      withoutTiles.targetsAboveFold.length - measured.targetsAboveFold.length,
      'tile targets above the fold left out of the count'
    ).toBeGreaterThanOrEqual(2)
  })
})
