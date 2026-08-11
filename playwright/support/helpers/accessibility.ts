// Story 3.8 Task 5 step 3 owner: implement reusable AxeBuilder accessibility scanning helper in playwright/support/helpers/accessibility.ts
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export interface CheckA11yOptions {
  includeTags?: string[]
  includedImpacts?: ('critical' | 'serious' | 'moderate' | 'minor')[]
  disableRules?: string[]
  excludeSelectors?: string[]
}

export async function waitForAccessibilityReady(page: Page): Promise<void> {
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

/**
 * WCAG relative-contrast ratio between two computed `rgb()` colors.
 *
 * Focus indicators are a non-text contrast requirement, which axe does not
 * evaluate, so a focus ring can vanish against its surface with a clean axe
 * report. Specs that care assert the ratio directly.
 *
 * `accessibility-hardening.spec.ts` carries its own inline copy that predates
 * this helper. It is the gate for every primary route, so it is deliberately
 * left alone here rather than refactored in a change that cannot run it.
 */
export function contrastRatio(left: string, right: string): number {
  const luminance = (color: string) => {
    const channels = parseRgb(color).map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
