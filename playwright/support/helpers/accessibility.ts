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
