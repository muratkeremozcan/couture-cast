// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Story CC-7.13: the responsive grid lives on the Community tab.
import { communityTest as test, expect } from '../support/helpers/community-session'

test('3.5-E2E-001 Community uses one column on a phone and multiple columns on desktop', async ({
  page,
  communitySession,
}) => {
  expect(communitySession.userId).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/community')
  const grid = page.getByTestId('community-card-grid')
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  await expect(grid).toHaveCSS('grid-template-columns', /^[\d.]+px$/)

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(grid).toHaveCSS('grid-template-columns', /^[\d.]+px(?: [\d.]+px)+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Community' })).toBeVisible()
})
