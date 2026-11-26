// Learning path Step 67: Screen budget guard.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-67-screen-budget-guard
// Story CC-7.10 test owner (TEA): 7.10-E2E-020..022 (AC3, spec D4 amended by P6). Every visible
// Today control, the tab bar excepted, is clicked in a fresh load under each D1 fixture; one
// whose only effect is analytics fails unless `known` (owned by CC-7.13, which removes them).
// The known ones must still be detected, or their entries fail, so the probe proves itself on
// the analytics-only actions while they exist.
//
// Each fixture's controls are split into PROBE_CHUNKS tests by position (control i goes to chunk
// i % PROBE_CHUNKS), so smart sharding can spread one fresh load per control over the shards
// (CI a45f15a1: three whole-screen probes, retried, ran one shard past 20 minutes). A chunk is
// judged against the known entries for its own controls; chunk 1 also fails on a known control
// that no longer exists at all, which no chunk would otherwise see.
// Probe rules: screen-budget-rules.spec.ts (7.10-RULE-060..066).
// Test design: _bmad-output/test-artifacts/test-design-7-10-screen-budget-guard.md.
import { screenBudget, type ScreenBudgetKnownViolation } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  BUDGET_FIXTURES,
  expectWithinBudget,
  openBudgetScreen,
} from '../support/helpers/screen-budget'
import {
  analyticsOnly,
  listProbeTargets,
  probeErrors,
  probeTarget,
} from '../support/helpers/screen-budget-probe'

const PROBE_CHUNKS = 4

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

/** The known analytics-only entry for this fixture, cut down to the keys `chunkKeys` holds. */
function knownForChunk(
  fixture: (typeof BUDGET_FIXTURES)[number],
  chunkKeys: ReadonlySet<string>
): ScreenBudgetKnownViolation[] {
  return screenBudget.known.flatMap((entry) => {
    const ours =
      entry.platform === 'web' &&
      entry.screen === 'today' &&
      entry.fixture === fixture &&
      entry.rule === 'analytics-only'
    if (!ours) return [entry]
    const elements = (entry.elements ?? []).filter((key) => chunkKeys.has(key))
    return elements.length ? [{ ...entry, value: elements.length, elements }] : []
  })
}

test.describe('CC-7.10 Today controls with an effect @local-lane', () => {
  // The verdict is deterministic (CI a45f15a1: identical values on all three attempts), so a
  // retry cannot change it and only triples a red run: a budget failure fails once.
  test.describe.configure({ retries: 0 })

  BUDGET_FIXTURES.forEach((fixture, fixtureIndex) => {
    const testId = `7.10-E2E-0${20 + fixtureIndex}`
    for (let chunk = 0; chunk < PROBE_CHUNKS; chunk += 1) {
      test(`[P0] [${testId}] web today (${fixture}) controls ${chunk + 1}/${PROBE_CHUNKS}: no control whose only effect is analytics`, async ({
        page,
        interceptNetworkCall,
      }, testInfo) => {
        // One fresh load per control plus the observation windows.
        test.setTimeout(180_000)
        const { reopen } = await openBudgetScreen(
          page,
          interceptNetworkCall,
          'today',
          fixture
        )
        const all = await listProbeTargets(page, screenBudget.tabBarSelectors.web)
        expect(all.length, 'Today controls found').toBeGreaterThan(0)

        if (chunk === 0) {
          const listed = new Set(all.map((target) => target.key))
          const vanished = screenBudget.known
            .filter(
              (entry) =>
                entry.platform === 'web' &&
                entry.screen === 'today' &&
                entry.fixture === fixture &&
                entry.rule === 'analytics-only'
            )
            .flatMap((entry) => (entry.elements ?? []).filter((key) => !listed.has(key)))
          expect(
            vanished,
            `known analytics-only controls no longer on web today (${fixture}): delete them from known`
          ).toEqual([])
        }

        const mine = all.filter((_, index) => index % PROBE_CHUNKS === chunk)
        const results = []
        for (const target of mine) results.push(await probeTarget(page, reopen, target))
        await testInfo.attach(
          `screen-budget-probe-web-today-${fixture}-${chunk + 1}.json`,
          { body: JSON.stringify(results, null, 2), contentType: 'application/json' }
        )
        await expectWithinBudget(
          testInfo,
          'today',
          fixture,
          { analyticsOnly: analyticsOnly(results), errors: probeErrors(results) },
          {
            known: knownForChunk(fixture, new Set(mine.map((target) => target.key))),
            label: `-probe-${chunk + 1}`,
          }
        )
      })
    }
  })
})
