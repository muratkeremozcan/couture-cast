/**
 * Story 5.3 Decision 3 owner: `5.3-UTIL-007`, the "both entry points agree" test.
 *
 * `packages/utils/src/contrast.spec.ts` reserves this id but cannot host the test
 * itself: `packages/utils` is an isolated npm workspace package (its
 * `tsconfig.typecheck.json` pins `rootDir` to the package directory), and reaching
 * out to `playwright/support/helpers/accessibility.ts` would both violate that
 * rootDir and pull `@playwright/test` types into a package that has no reason to
 * depend on Playwright. `playwright/` is not an npm workspace at all, so this file
 * runs under the root `vitest` binary directly rather than through the Playwright
 * test runner, which only discovers files under `playwright/tests`
 * (`playwright/config/base.config.ts`'s `testDir`) and expects `@playwright/test`'s
 * `test`/`expect`, not vitest's. Wired into `npm run test:playwright-unit`, which
 * `prepare:playwright` runs before every Playwright entrypoint (local, preview,
 * and CI's `test:pw-local`) — not a file someone has to remember to run by hand.
 *
 * The proof itself: `accessibility.ts`'s `contrastRatio` takes CSS `rgb()` strings
 * and is now a thin adapter that converts to hex and delegates to
 * `@couture/utils`'s `contrastRatio`. This asserts the two entry points return the
 * same number for the same color, so the adapter rewrite is provably a pure
 * delegation and not a second implementation with its own rounding drift.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio as hexContrastRatio } from '@couture/utils'
import { contrastRatio as rgbContrastRatio } from './accessibility'

describe('accessibility.ts contrastRatio adapter (5.3-UTIL-007)', () => {
  it('returns the same ratio as the @couture/utils hex entry point for the same color', () => {
    // Sapphire on Pearl, the 5.3-UTIL-001 fixture pinned in
    // packages/utils/src/contrast.spec.ts, reused here so both suites are proving
    // the same real-world pairing rather than an arbitrary throwaway color.
    const foregroundHex = '#1F4E79'
    const backgroundHex = '#F4F6FB'

    const viaHex = hexContrastRatio(foregroundHex, backgroundHex)
    const viaRgb = rgbContrastRatio('rgb(31, 78, 121)', 'rgb(244, 246, 251)')

    expect(viaRgb).toBeCloseTo(viaHex, 10)
    expect(viaRgb).toBeCloseTo(8.01, 2)
  })

  it('agrees for the focus-ring pairing commerce-affiliate-preferences.spec.ts asserts', () => {
    // The gold focus ring (`#C9A14A`, the box-shadow color that spec checks
    // separately) against the dark settings surface it actually renders on.
    const ringHex = '#C9A14A'
    const darkSurfaceHex = '#0A0A0A'

    const viaHex = hexContrastRatio(ringHex, darkSurfaceHex)
    const viaRgb = rgbContrastRatio('rgb(201, 161, 74)', 'rgb(10, 10, 10)')

    expect(viaRgb).toBeCloseTo(viaHex, 10)
  })
})
