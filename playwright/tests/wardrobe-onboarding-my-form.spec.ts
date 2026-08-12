// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Story 4.4 Task 8 owner: end-to-end coverage for the "My Form" photo upload
// path (AC 2, AC 3) reached from the standalone silhouette settings surface
// (decision 3: reachable outside onboarding). Runs against the real default
// `HeuristicSilhouettePhotoModerationEngine` (decisions 8-9), not a fixture
// engine: `wardrobe-silhouette-image-validation.ts` decodes real image bytes
// before a moderation engine ever runs, so a genuine E2E upload through the
// browser cannot use the `FIXTURE:<outcome>:` marker convention the API's own
// integration tests rely on (that marker is not a decodable image). Instead
// this spec uses two committed fixture PNGs
// (`playwright/fixtures/wardrobe/silhouette-photo-*.png`) engineered so the
// real heuristic's border-vs-center contrast measurement deterministically
// lands on a known verdict: a solid single-colour photo always measures zero
// contrast distance (`contrast`), and a two-tone photo with a clearly
// different, non-skin-toned center region always clears both thresholds
// (`ready`). See the story's Dev Notes for the exact pixel geometry.
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect } from '../support/fixtures/merged-fixtures'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as myFormTest,
} from '../support/helpers/wardrobe-onboarding-session'

const test = myFormTest
const readyFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-ready.png'
)
const contrastFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-contrast.png'
)

/** Opens the standalone Silhouette settings modal from the wardrobe hub (decision 3). */
async function openSilhouetteSettings(page: Page): Promise<Locator> {
  await page.goto('/wardrobe')
  await waitForAccessibilityReady(page)
  const silhouetteButton = page.getByRole('button', { name: 'Silhouette' })
  await expect(silhouetteButton).toBeEnabled()
  await silhouetteButton.click()
  const dialog = page.getByRole('dialog', { name: 'Silhouette' })
  await expect(dialog).toBeVisible()
  return dialog
}

const BASEWEAR_CONFIRM_LABEL = /I'm wearing plain white or black clothing/

async function confirmBasewearGuidance(dialog: Locator) {
  await dialog.getByLabel(BASEWEAR_CONFIRM_LABEL).check()
}

myFormTest.describe('Wardrobe Silhouette "My Form" Upload', () => {
  myFormTest.use({ authSessionEnabled: false })

  myFormTest.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The "My Form" journey requires the supervised local API and wardrobe worker.'
    )
  })

  myFormTest(
    '[P0] [4.4-E2E-003] uploads a "My Form" photo through to ready, it becomes the active silhouette mode, and adjusting a slider switches back',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-ready'
      )
      const dialog = await openSilhouetteSettings(page)

      await test.step('Confirm the basewear guidance and upload a photo', async () => {
        await confirmBasewearGuidance(dialog)
        await dialog
          .getByRole('button', { name: 'Upload a full-body photo', exact: true })
          .click()
        await dialog.getByLabel('My Form photo file').setInputFiles(readyFixturePath)
        // Not asserting the transient "Processing your photo…" state here:
        // the real worker can settle before Playwright observes it (a tiny
        // synthetic fixture image processes in single-digit milliseconds),
        // which would make this assertion flaky. The terminal ready state
        // below is what actually matters.
      })

      await test.step('The photo reaches ready and becomes the active silhouette mode', async () => {
        await expect(dialog.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
        await expect(dialog.getByText('My Form photo', { exact: true })).toBeVisible()
        await expect(dialog.getByAltText('My Form')).toBeVisible()
        await expect(
          dialog.getByRole('button', { name: 'Remove My Form photo' })
        ).toBeVisible()
      })

      await test.step('Adjusting a slider switches the active mode back to the default mannequin (AC 2)', async () => {
        const heightSlider = dialog.getByTestId('silhouette-height-slider')
        const saveResponse = interceptNetworkCall({
          method: 'PUT',
          url: '**/api/v1/wardrobe/silhouette*',
        })
        await heightSlider.focus()
        await heightSlider.press('ArrowRight')
        await saveResponse
        await expect(dialog.getByText('Adjustable silhouette')).toBeVisible()
      })
    }
  )

  myFormTest(
    '[P1] [4.4-E2E-004] surfaces the contrast failure reason with no retry action, and recovers by choosing a different photo',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-contrast'
      )
      const dialog = await openSilhouetteSettings(page)

      await confirmBasewearGuidance(dialog)
      await dialog
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await dialog.getByLabel('My Form photo file').setInputFiles(contrastFixturePath)

      await test.step('The contrast-specific error appears with no retry action', async () => {
        await expect(
          dialog.getByText(
            /We couldn't separate you from the background clearly\. Retake the photo with plainer clothing or a plainer background\./
          )
        ).toBeVisible({ timeout: 20_000 })
        await expect(dialog.getByRole('button', { name: 'Retry upload' })).toHaveCount(0)
      })

      await test.step('Choosing a different photo recovers and reaches ready', async () => {
        await expect(
          dialog.getByRole('button', { name: 'Upload a full-body photo', exact: true })
        ).toBeVisible()
        await dialog
          .getByRole('button', { name: 'Upload a full-body photo', exact: true })
          .click()
        await dialog.getByLabel('My Form photo file').setInputFiles(readyFixturePath)
        await expect(dialog.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
      })
    }
  )

  myFormTest(
    '[P1] [4.4-E2E-005] retries after a transient network failure, reusing the same upload attempt',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-retry'
      )
      const dialog = await openSilhouetteSettings(page)

      await test.step('Fail the raw-bytes PUT exactly once, simulating a transient network drop', () => {
        let abortedOnce = false
        void interceptNetworkCall({
          url: '**/*',
          handler: async (route, request) => {
            if (!abortedOnce && request.method() === 'PUT') {
              abortedOnce = true
              await route.abort('failed')
              return
            }
            await route.continue()
          },
        })
      })

      // Captures the idempotency key from every upload-url allocation
      // (fired once per attempt, including the retry) so the "reusing the
      // same upload attempt" claim in this test's own name is actually
      // verified below, not just implied by reaching `ready`.
      const allocationIdempotencyKeys: string[] = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes('/my-form/upload-url')
        ) {
          const key = request.headers()['idempotency-key']
          if (key) allocationIdempotencyKeys.push(key)
        }
      })

      await confirmBasewearGuidance(dialog)
      await dialog
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await dialog.getByLabel('My Form photo file').setInputFiles(readyFixturePath)

      await test.step('An inline error with a Retry action appears', async () => {
        const retryButton = dialog.getByRole('button', { name: 'Retry upload' })
        await expect(retryButton).toBeVisible({ timeout: 20_000 })
      })

      await test.step('Retrying reuses the same attempt and reaches ready', async () => {
        await dialog.getByRole('button', { name: 'Retry upload' }).click()
        await expect(dialog.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
      })

      await test.step('The retry reused the original idempotency key, not a fresh upload attempt', () => {
        expect(allocationIdempotencyKeys).toHaveLength(2)
        expect(allocationIdempotencyKeys[1]).toBe(allocationIdempotencyKeys[0])
      })
    }
  )
})
