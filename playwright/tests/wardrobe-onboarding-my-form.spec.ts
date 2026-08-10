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
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { ApiRequestFixture } from '../support/helpers/api-test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'

const environment = resolveEnvironmentConfig('local')
const readyFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-ready.png'
)
const contrastFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-contrast.png'
)

type CleanupState = {
  userId?: string
  accessToken?: string
}

const myFormTest = test.extend<{ cleanupState: CleanupState }>({
  cleanupState: async ({ apiRequest }, use) => {
    const state: CleanupState = {}
    try {
      await use(state)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        state.accessToken,
        state.userId,
        environment.apiBaseUrl
      )
    }
  },
})

async function signUpAndAuthenticate(
  apiRequest: ApiRequestFixture,
  page: Page,
  cleanupState: CleanupState,
  testInfo: TestInfo,
  prefix: string
): Promise<void> {
  const signup = await apiRequest({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl: environment.apiBaseUrl,
    body: {
      email: `${buildUniqueId(prefix, testInfo)}@example.test`,
      birthdate: '1990-06-15',
    },
  })
  expect(signup.status).toBe(201)
  const signupBody = signupResponseSchema.parse(signup.body)
  cleanupState.userId = signupBody.userId
  const accessToken = `test-token:guardian:${signupBody.userId}`
  cleanupState.accessToken = accessToken

  await page.addInitScript((token) => {
    window.sessionStorage.setItem('couturecast.access-token', token)
  }, accessToken)
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })
}

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
    async ({ apiRequest, cleanupState, page }, testInfo) => {
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
        await expect(dialog.getByText('Processing your photo…')).toBeVisible()
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
        const saveResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/wardrobe/silhouette') &&
            response.request().method() === 'PUT'
        )
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
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-retry'
      )
      const dialog = await openSilhouetteSettings(page)

      await test.step('Fail the raw-bytes PUT exactly once, simulating a transient network drop', async () => {
        let abortedOnce = false
        await page.route('**/*', async (route) => {
          const request = route.request()
          if (!abortedOnce && request.method() === 'PUT') {
            abortedOnce = true
            await route.abort('failed')
            return
          }
          await route.continue()
        })
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
    }
  )
})
