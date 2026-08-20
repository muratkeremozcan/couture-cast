// Story 3.8 Task 5 step 3 owner: implement reusable AxeBuilder accessibility scanning helper in playwright/support/helpers/accessibility.ts
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { contrastRatio as hexContrastRatio } from '@couture/utils'

export interface CheckA11yOptions {
  includeTags?: string[]
  includedImpacts?: ('critical' | 'serious' | 'moderate' | 'minor')[]
  disableRules?: string[]
  excludeSelectors?: string[]
}

export async function waitForAccessibilityReady(page: Page): Promise<void> {
  // Deliberately a DOM presence check, not a role query: `AccessibleModal` sets
  // `aria-hidden="true"` and `inert` on the app shell (and therefore this <main>)
  // while a modal is open, by design -- see accessible-modal.tsx. `checkA11y` calls
  // this readiness gate for pages that scan a page WITH an open modal covering it
  // (e.g. wardrobe-garment-capture.spec.ts), where `getByRole('main')` correctly
  // finds nothing, but the underlying element is still there and still what the
  // caller needs to wait for. `#main-content` is a load-bearing, stable id (the
  // skip-link target on every page, per settings/page.tsx's docblock), not a
  // fragile accident.
  await page.locator('main#main-content').waitFor({ state: 'visible' })
  await page.evaluate(async () => {
    await document.fonts?.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

/**
 * Performs automated WCAG 2.1 A and AA accessibility scans on the active page.
 */
export async function checkA11y(page: Page, options?: CheckA11yOptions): Promise<void> {
  await waitForAccessibilityReady(page)
  const builder = new AxeBuilder({ page }).withTags(
    options?.includeTags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
  )

  if (options?.disableRules) {
    builder.disableRules(options.disableRules)
  }

  if (options?.excludeSelectors) {
    for (const selector of options.excludeSelectors) {
      builder.exclude(selector)
    }
  }

  const results = await builder.analyze()

  const includedImpacts = options?.includedImpacts
  const violations = includedImpacts
    ? results.violations.filter((violation) => {
        const impact = violation.impact
        return (
          impact !== null &&
          impact !== undefined &&
          includedImpacts.includes(impact) === true
        )
      })
    : results.violations

  expect(
    violations,
    `Accessibility violations found:\n${JSON.stringify(violations, null, 2)}`
  ).toEqual([])
}

function parseRgb(value: string): [number, number, number] {
  const channels = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${value}`)
  }
  return channels as [number, number, number]
}

/** Encodes 0-255 sRGB channels as the `#RRGGBB` shape `@couture/utils` accepts. */
function toHex(channels: [number, number, number]): string {
  return `#${channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * WCAG relative-contrast ratio between two computed `rgb()` colors.
 *
 * Focus indicators are a non-text contrast requirement, which axe does not
 * evaluate, so a focus ring can vanish against its surface with a clean axe
 * report. Specs that care assert the ratio directly.
 *
 * Story 5.3 Decision 3 made `@couture/utils`'s hex-based `contrastRatio` the
 * one canonical WCAG luminance implementation in the repo. This function is
 * now an adapter over it rather than a second implementation: `parseRgb`
 * still does the `rgb()`-string parsing this helper's callers need (
 * `getComputedStyle` returns that shape, not hex, and
 * `commerce-affiliate-preferences.spec.ts:239` depends on this exact
 * signature), `toHex` re-encodes the three channels, and the gamma-correction
 * and luminance-weighting maths live in `@couture/utils` alone.
 * `accessibility.spec.ts` beside this file pins both entry points to the same
 * number for the same color.
 *
 * `accessibility-hardening.spec.ts` still carries its own inline copy of the
 * pre-Decision-3 maths. It gates every primary route and was not touched by
 * this rewrite, so it remains a second, deliberately-owned duplicate (see
 * `deferred-work.md`) rather than this file growing a third.
 */
export function contrastRatio(left: string, right: string): number {
  return hexContrastRatio(toHex(parseRgb(left)), toHex(parseRgb(right)))
}
