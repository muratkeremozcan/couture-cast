// Story 4.1 Task 8 step 4 owner: E2E Playwright test for wardrobe capture modal accessibility and landmark visibility
import { expect, test } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'

test.describe('Wardrobe Garment Capture Flow', () => {
  test('opens wardrobe hub, launches capture modal, and checks accessibility', async ({
    page,
  }) => {
    await page.goto('/wardrobe')
    await waitForAccessibilityReady(page)

    // Verify page landmark & title
    const mainLandmark = page.locator('#main-content')
    await expect(mainLandmark).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Wardrobe Hub' })
    ).toBeVisible()

    // Open capture modal
    const addGarmentButton = page.getByRole('button', { name: '+ Add Garment' })
    await addGarmentButton.click()

    // Verify modal dialog
    const modalDialog = page.getByRole('dialog')
    await expect(modalDialog).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Garment Capture Flow' })
    ).toBeVisible()

    // Run axe accessibility check on open modal dialog
    await checkA11y(page, '#main-content', {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })

    // Close modal
    const closeBtn = page.getByLabel('Close capture modal')
    await closeBtn.click()
    await expect(modalDialog).not.toBeVisible()
  })
})
