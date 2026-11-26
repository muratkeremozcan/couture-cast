// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-E2E-020..022 (AC3, spec D4 amended by P6). Every visible
// Today control, the tab bar excepted, is clicked in a fresh load under each D1 fixture; one
// whose only effect is analytics fails unless `known` (owned by CC-7.13, which removes them).
// The known ones must still be detected, or their entries fail as fixed, so the probe proves
// itself on the three analytics-only actions while they exist.
// Probe rules: screen-budget-rules.spec.ts (7.10-RULE-060..066).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import { screenBudget } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  BUDGET_FIXTURES,
  expectWithinBudget,
  openBudgetScreen,
} from '../support/helpers/screen-budget'
import {
  analyticsOnly,
  probeErrors,
  probeScreen,
} from '../support/helpers/screen-budget-probe'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test.describe('CC-7.10 Today controls with an effect @local-lane', () => {
  BUDGET_FIXTURES.forEach((fixture, index) => {
    const testId = `7.10-E2E-0${20 + index}`
    test(`[P0] [${testId}] web today (${fixture}): no control whose only effect is analytics`, async ({
      page,
      interceptNetworkCall,
    }, testInfo) => {
      // One fresh load per control plus the observation windows: a long Today has many.
      test.setTimeout(240_000)
      const { reopen } = await openBudgetScreen(
        page,
        interceptNetworkCall,
        'today',
        fixture
      )
      const { targets, results } = await probeScreen(
        page,
        reopen,
        screenBudget.tabBarSelectors.web
      )
      expect(targets.length, 'Today controls probed').toBeGreaterThan(0)
      await testInfo.attach(`screen-budget-probe-web-today-${fixture}.json`, {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      })
      await expectWithinBudget(testInfo, 'today', fixture, {
        analyticsOnly: analyticsOnly(results),
        errors: probeErrors(results),
      })
    })
  })
})
