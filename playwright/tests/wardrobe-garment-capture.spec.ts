// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Story 4.1 Task 8 step 4 owner: E2E Playwright test for wardrobe capture modal accessibility and landmark visibility
import { expect, test } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'

test.describe('Wardrobe Garment Capture Flow', () => {
  test('opens wardrobe hub, launches capture modal, and checks accessibility', async ({
    page,
    interceptNetworkCall,
  }) => {
    // Network-first readiness signal: intercept navigation/readiness response before navigating
    const responsePromise = interceptNetworkCall({
      method: 'GET',
      url: '**/wardrobe*',
    })
    await page.goto('/wardrobe')
    await responsePromise
    await waitForAccessibilityReady(page)

    // Verify page landmark & title
    const mainLandmark = page.locator('#main-content')
    await expect(mainLandmark).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Wardrobe Hub' })
    ).toBeVisible()

    // Open capture modal via accessible semantic button
    const addGarmentButton = page.getByRole('button', {
      name: /\+ Add Garment|Add Garment/i,
    })
    await expect(addGarmentButton).toBeVisible()
    await addGarmentButton.click()

    // Verify modal dialog
    const modalDialog = page.getByRole('dialog')
    await expect(modalDialog).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Garment Capture Flow' })
    ).toBeVisible()

    // Run axe accessibility check on open modal dialog
    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })

    // Close modal
    const closeBtn = page.getByLabel('Close capture modal')
    await closeBtn.click()
    await expect(modalDialog).not.toBeVisible()
  })
})
