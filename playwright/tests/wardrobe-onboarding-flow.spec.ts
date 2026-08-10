// Story 4.4 Task 8 owner: end-to-end coverage for the guided wardrobe onboarding
// flow (AC 1, AC 3): permission, capture-and-tag one real garment through the
// existing Story 4.1/4.2 components, the silhouette step, completion redirect,
// and resuming mid-flow after a reload against the real server-authoritative
// state machine (decision 3).
import path from 'node:path'
import { garmentListResponseSchema } from '@couture/api-client/contracts/http'
import type { Page } from '@playwright/test'
import { expect } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as onboardingTest,
} from '../support/helpers/wardrobe-onboarding-session'

const test = onboardingTest
const environment = resolveEnvironmentConfig('local')
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

/**
 * Clicks the step's "Continue" button and waits for the onboarding PATCH to
 * resolve successfully. The capture/tagging UI phase covers two distinct
 * server steps (`capture` then `tagging`) sharing one component, so
 * advancing from a captured-and-tagged garment to the silhouette step takes
 * two of these in a row -- the first moves `capture -> tagging`, the second
 * `tagging -> silhouette` (AC1's forward-only state machine, decision 3).
 * Asserting the status here (not just that some response arrived) surfaces a
 * real rejected transition as its own failure instead of an unrelated
 * downstream timeout.
 */
async function clickContinueAndWaitForAdvance(page: Page) {
  const advanceResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/wardrobe/onboarding') &&
      response.request().method() === 'PATCH'
  )
  await page.getByRole('button', { name: 'Continue' }).click()
  expect((await advanceResponse).status()).toBe(200)
}

async function captureAndTagOneGarment(page: Page) {
  await test.step('Capture and tag one garment', async () => {
    await page.getByRole('button', { name: 'Add another garment' }).click()
    const captureDialog = page.getByRole('dialog')
    await expect(captureDialog).toBeVisible()
    await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
    await page.getByRole('button', { name: 'Use This Image' }).click()
    await expect(page.getByText('Garment Upload Complete!')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()

    const taggingDialog = page.getByRole('dialog', { name: 'Organize Garment Tags' })
    await expect(taggingDialog).toBeVisible()
    await taggingDialog
      .getByRole('radiogroup', { name: 'Garment Category' })
      .getByRole('radio', { name: 'Top', exact: true })
      .click()
    await taggingDialog.getByRole('button', { name: 'Confirm & Save Tags' }).click()
    await expect(taggingDialog).not.toBeVisible()

    await expect(
      page.getByTestId('onboarding-garment-checklist').getByText(/tags confirmed/)
    ).toBeVisible()
  })
}

onboardingTest.describe('Wardrobe Onboarding Guided Flow', () => {
  // This journey authenticates as its own API-created user, not the default persisted session.
  onboardingTest.use({ authSessionEnabled: false })

  onboardingTest.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The onboarding journey requires the supervised local API and wardrobe worker.'
    )
  })

  onboardingTest(
    '[P0] [4.4-E2E-001] completes the guided path: permission, capture-and-tag one garment, silhouette sliders, and the completion redirect',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-onboarding-flow'
      )

      await test.step('Land on the permission step', async () => {
        await page.goto('/wardrobe/onboarding')
        await waitForAccessibilityReady(page)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Set up your closet' })
        ).toBeVisible()
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: 'Allow camera and photo access',
          })
        ).toBeVisible()
      })

      await test.step('Allow permission and move to the capture step', async () => {
        await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
        await expect(
          page.getByRole('button', { name: 'Add another garment' })
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Use starter wardrobe' })
        ).toBeVisible()
      })

      await captureAndTagOneGarment(page)

      await test.step('The starter-wardrobe skip is withdrawn once a real garment exists', async () => {
        await expect(
          page.getByRole('button', { name: 'Use starter wardrobe' })
        ).toHaveCount(0)
      })

      await test.step('Continue to the silhouette step', async () => {
        await clickContinueAndWaitForAdvance(page) // capture -> tagging
        await clickContinueAndWaitForAdvance(page) // tagging -> silhouette
        await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()
      })

      await test.step('Adjust the silhouette sliders', async () => {
        const heightSlider = page.getByTestId('silhouette-height-slider')
        const saveResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/wardrobe/silhouette') &&
            response.request().method() === 'PUT'
        )
        await heightSlider.focus()
        for (let index = 0; index < 10; index += 1) {
          await heightSlider.press('ArrowRight')
        }
        await saveResponse
        await expect(heightSlider).toHaveValue('60')
      })

      await test.step('Finish onboarding and land on the completion step', async () => {
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByText('Your closet is ready')).toBeVisible()
      })

      await test.step('The completion redirect returns to the wardrobe hub', async () => {
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page).toHaveURL(/\/wardrobe$/)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Wardrobe Hub' })
        ).toBeVisible()
      })

      await test.step('Reopening onboarding after completion redirects straight back to the hub', async () => {
        await page.goto('/wardrobe/onboarding')
        await expect(page).toHaveURL(/\/wardrobe$/)
      })
    }
  )

  onboardingTest(
    '[P0] [4.4-E2E-002] resumes at the persisted step, with the persisted silhouette slider value, after a reload',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-onboarding-resume'
      )

      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await captureAndTagOneGarment(page)
      await clickContinueAndWaitForAdvance(page) // capture -> tagging
      await clickContinueAndWaitForAdvance(page) // tagging -> silhouette
      await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()

      await test.step('Set a distinctive silhouette height before reloading', async () => {
        const heightSlider = page.getByTestId('silhouette-height-slider')
        const saveResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/wardrobe/silhouette') &&
            response.request().method() === 'PUT'
        )
        await heightSlider.focus()
        for (let index = 0; index < 25; index += 1) {
          await heightSlider.press('ArrowRight')
        }
        await saveResponse
        await expect(heightSlider).toHaveValue('75')
      })

      await test.step('Reloading resumes directly at the silhouette step, skipping permission and capture', async () => {
        await page.reload()
        await waitForAccessibilityReady(page)
        await expect(page.getByTestId('onboarding-status-region')).toContainText(
          'Picking up where you left off'
        )
        await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Allow camera and photo access' })
        ).toHaveCount(0)
      })

      await test.step('The persisted slider value survived the reload', async () => {
        await expect(page.getByTestId('silhouette-height-slider')).toHaveValue('75')
      })

      await test.step('The captured garment persisted server-side through the reload', async () => {
        // Reload while still on the silhouette step keeps the checklist off-screen
        // (only one step's content renders at a time), so the claim this step
        // makes has to be verified directly against the real API rather than
        // through UI text that isn't showing the checklist right now.
        const accessToken = cleanupState.accessToken
        if (!accessToken) throw new Error('Expected an authenticated test user.')
        const garmentsResponse = await apiRequest({
          method: 'GET',
          path: '/api/v1/wardrobe/garments',
          baseUrl: environment.apiBaseUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        expect(garmentsResponse.status).toBe(200)
        const garments = garmentListResponseSchema.parse(garmentsResponse.body)
        expect(garments.data).toHaveLength(1)
        expect(garments.data[0]?.tagsConfirmedAt).not.toBeNull()
      })

      await test.step('Finishing onboarding from the resumed session still works', async () => {
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByText('Your closet is ready')).toBeVisible()
      })
    }
  )
})
