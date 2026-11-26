// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): 7.9-E2E-001..006 in dark, one test per tab. Split from
// app-shell-visual-system.spec.ts, one file per scheme, so the burn-in shards spread the
// full-page contrast scans (CI 46f09ae8: in one file they filled a 20-minute burn-in shard).
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md.
import { test } from '../support/fixtures/merged-fixtures'
import { checkShellTab, SHELL_SCREENS } from '../support/helpers/app-shell'

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test.describe('CC-7.9 one app shell in dark @local-lane', () => {
  for (const screen of SHELL_SCREENS) {
    test(`[P0] [7.9-E2E-001..006] ${screen} in dark: 56 px top bar, one surface, token colours, gold only by role, readable text`, async ({
      page,
      interceptNetworkCall,
    }) => {
      await checkShellTab(page, interceptNetworkCall, screen, 'dark')
    })
  }
})
