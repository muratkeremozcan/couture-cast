// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Story 4.1 Task 8 step 4 owner: E2E Playwright test for wardrobe capture modal accessibility and landmark visibility in `playwright/tests/wardrobe-garment-capture.spec.ts`
import { randomUUID } from 'node:crypto'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { seedWebSession } from '../support/helpers/commerce-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'

// CC-7.9 add-on B: capture is a member action; a visitor's Add leads to sign in (covered on every
// lane by wardrobe-signed-out.spec.ts). This case signs a local fixture member in first: before
// add-on B it reached the modal as a visitor, which the Closet no longer offers.
test.describe('Wardrobe Garment Capture Flow @local-lane', () => {
  test('opens wardrobe hub, launches capture modal, and checks accessibility', async ({
    page,
    interceptNetworkCall,
  }) => {
    await seedWebSession(page, localE2EAccessToken(`capture-${randomUUID()}`))
    // Network-first: the readiness response is intercepted before navigating.
    const responsePromise = interceptNetworkCall({
      method: 'GET',
      url: '**/wardrobe*',
    })
    await page.goto('/wardrobe')
    await responsePromise
    await waitForAccessibilityReady(page)

    const mainLandmark = page.locator('#main-content')
    await expect(mainLandmark).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Wardrobe' })).toBeVisible()

    const addGarmentButton = page.getByRole('button', {
      name: /\+ Add Garment|Add Garment/i,
    })
    await expect(addGarmentButton).toBeVisible()
    await addGarmentButton.click()

    const modalDialog = page.getByRole('dialog')
    await expect(modalDialog).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Garment Capture Flow' })
    ).toBeVisible()

    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })

    const closeBtn = page.getByLabel('Close capture modal')
    await closeBtn.click()
    await expect(modalDialog).not.toBeVisible()
  })
})
