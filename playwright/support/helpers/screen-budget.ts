// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): opens a tab under a spec D1 fixture and runs the shared measure
// and verdict, for screen-budget.spec.ts (7.10-E2E-001..017) and
// screen-budget-home-actions.spec.ts (7.10-E2E-020..022).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import {
  evaluateScreenBudget,
  measureScreenBudget,
  screenBudget,
  screenBudgetMeasureConfig,
  type ScreenBudgetAuditMeasurement,
  type ScreenBudgetEvaluation,
  type ScreenBudgetFixture,
  type ScreenBudgetKnownViolation,
  type ScreenBudgetMeasurement,
  type ScreenBudgetScreen,
} from '@couture/utils'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { FIXED_NOW, openFixtureShell, SHELL_TABS, waitForShellSettled } from './app-shell'
import type { ShellScreen } from './shell-fixtures'

/** The budget's screen names (CC-7.11 renames) and the shell tabs they open. */
export const BUDGET_SHELL: Record<ScreenBudgetScreen, ShellScreen> = {
  today: 'home',
  closet: 'closet',
  // Story CC-7.11 D8: Looks joins the budget's screens.
  looks: 'looks',
  community: 'community',
  profile: 'profile',
}

/** Every tab bar target the web shell renders (Today, Closet, Looks, Community, Profile). */
const WEB_TAB_COUNT = Object.keys(SHELL_TABS).length

/**
 * Signs a fixture member in, serves the D1 fixture and opens `screen` settled: the CC-7.7 gate
 * open, no fixture read in flight, fonts loaded, the member session confirmed. `reopen` loads
 * the same screen again in a fresh document (the home actions probe).
 */
export async function openBudgetScreen(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  screen: ScreenBudgetScreen,
  fixture: ScreenBudgetFixture
) {
  const shell = BUDGET_SHELL[screen]
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.clock.setFixedTime(FIXED_NOW)
  const { router } = await openFixtureShell(page, interceptNetworkCall, {
    mode: fixture,
    screen: shell,
  })
  const reopen = async () => {
    await page.goto(SHELL_TABS[shell].path)
    await waitForShellSettled(page, router)
    await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
  }
  await reopen()
  return { router, reopen }
}

/** The shared measure on the open screen, with the web config for it (D3, P4). */
export function measureWebScreen(
  page: Page,
  screen: ScreenBudgetScreen
): Promise<ScreenBudgetMeasurement> {
  return page.evaluate(measureScreenBudget, screenBudgetMeasureConfig('web', screen))
}

/**
 * Floors so an audit cannot pass on a measure that saw nothing (risk R1): the tab bar was found
 * and excluded, something above the fold counted, the screen's anchor was found, and Closet
 * shows its one gold Add (CC-7.9 D3).
 */
export function expectMeasureFloors(
  measurement: ScreenBudgetMeasurement,
  screen: ScreenBudgetScreen
) {
  expect(measurement.stats.tabBarTargets, 'tab bar targets found and excluded').toBe(
    WEB_TAB_COUNT
  )
  expect(
    measurement.targetsAboveFold.length,
    'targets counted above the fold'
  ).toBeGreaterThan(0)
  if (screen === 'today')
    expect(measurement.todayHeight, 'Today height').toBeGreaterThan(0)
  if (screen === 'closet') {
    expect(measurement.closetChrome, 'Closet anchor top').toBeGreaterThanOrEqual(56)
    expect(measurement.primaryButtons.length, 'Closet gold Add').toBeGreaterThan(0)
  }
}

/** Runs the verdict, attaches it to the report (the CI source of the `known` list) and asserts it. */
export async function expectWithinBudget(
  testInfo: TestInfo,
  screen: ScreenBudgetScreen,
  fixture: ScreenBudgetFixture,
  measurement: ScreenBudgetAuditMeasurement,
  options: { known?: readonly ScreenBudgetKnownViolation[]; label?: string } = {}
): Promise<ScreenBudgetEvaluation> {
  const evaluation = evaluateScreenBudget(
    { platform: 'web', screen, fixture, measurement },
    screenBudget.limits,
    options.known ?? screenBudget.known
  )
  await testInfo.attach(
    `screen-budget-web-${screen}-${fixture}${options.label ?? ''}.json`,
    {
      body: JSON.stringify({ evaluation, measurement }, null, 2),
      contentType: 'application/json',
    }
  )
  const messages = evaluation.failures.map((failure) => failure.message)
  expect(messages, `screen budget: web ${screen} (${fixture})`).toEqual([])
  return evaluation
}

export const BUDGET_SCREENS = screenBudget.screens
export const BUDGET_FIXTURES = screenBudget.fixtures
