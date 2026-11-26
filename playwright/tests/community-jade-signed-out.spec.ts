// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade, 2026-11-19: "community is empty" and "what is Cold and wet?". The bottom-nav Community tab
// showed a Story 3.6 placeholder, so the lookbook, its heading and its climate explainer never
// appeared. 3.6-E2E-007 proves the member view, but it needs a seeded member and skips outside
// the local stack. This file needs no member, so it runs in every environment, including the
// daily production status run: a stub, a missing explainer or a dead tab turns that run red.
import type { Page } from '@playwright/test'
import enUS from '../../apps/web/src/i18n/locales/en-US.json'
import { expect, test } from '../support/fixtures/merged-fixtures'

// Pixel 7 Chrome on Android, minus defaultBrowserType, which a describe block cannot set.
test.use({
  authSessionEnabled: false,
  viewport: { width: 412, height: 839 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2.625,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
})

async function expectLookbookVocabulary(page: Page) {
  const community = page.getByTestId('community-page')
  // CC-7.9 D6: the title is the top bar's h1, above the page's main column.
  await expect(
    page.getByTestId('app-header').getByRole('heading', { level: 1 })
  ).toHaveText('Community')

  const filters = community.getByRole('navigation', { name: 'Community filters' })
  // Jade asked for the title to change from "Living Community Look book".
  await expect(filters.getByRole('heading', { level: 2 })).toHaveText(
    enUS.community.heading
  )
  await expect(page.getByText('Living Community Lookbook')).toHaveCount(0)
  // Jade asked what "Cold and wet" means: the explainer sits beside the band chips.
  await expect(filters.getByTestId('community-filters-explainer')).toHaveText(
    enUS.community.filters.explainer
  )
  await expect(filters).toHaveAccessibleDescription(enUS.community.filters.explainer)
  await expect(filters.getByTestId('community-filter-cold_wet')).toHaveText(
    'Cold and wet'
  )
}

test.describe('Jade community items, signed out, every environment', () => {
  test('JADE-COMMUNITY-001: the bottom-nav Community tab opens the real lookbook on Android Chrome width', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('bottom-nav-community').click()
    await expect(page).toHaveURL(/\/community$/)
    await expect(page.getByTestId('bottom-nav-community')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expectLookbookVocabulary(page)
  })

  test('JADE-COMMUNITY-002: /community answers on its own address with the same lookbook', async ({
    page,
  }) => {
    const response = await page.goto('/community')
    expect(response?.status()).toBe(200)
    await expectLookbookVocabulary(page)
    // A page that never overflows sideways at phone width.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    expect(overflows).toBe(false)
  })
})
