// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Story 4.1 Task 8 step 4 owner: E2E Playwright test for wardrobe capture modal accessibility and landmark visibility in `playwright/tests/wardrobe-garment-capture.spec.ts`
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'

const environment = resolveEnvironmentConfig('local')

type CleanupState = { userId?: string; accessToken?: string }

const captureTest = test.extend<{ cleanupState: CleanupState }>({
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

// CC-7.9 add-on B: capture is a member action; a visitor's Add leads to sign in (covered on every
// lane by wardrobe-signed-out.spec.ts). This case signs up a real local member first: a token for
// a user the API has never seen reads 404 on the profile and 403 on the wardrobe (CI 7c284e60).
captureTest.describe('Wardrobe Garment Capture Flow @local-lane', () => {
  captureTest.use({ authSessionEnabled: false })

  captureTest(
    'opens wardrobe hub, launches capture modal, and checks accessibility',
    async ({ apiRequest, cleanupState, page, interceptNetworkCall }, testInfo) => {
      test.skip(
        isNonLocalEnvironment(testInfo),
        'The member capture modal needs the supervised local API.'
      )
      const signup = await apiRequest({
        method: 'POST',
        path: '/api/v1/auth/signup',
        baseUrl: environment.apiBaseUrl,
        body: {
          email: `${buildUniqueId('garment-capture', testInfo)}@example.test`,
          birthdate: '1990-06-15',
        },
      })
      expect(signup.status).toBe(201)
      const { userId } = signupResponseSchema.parse(signup.body)
      const accessToken = localE2EAccessToken(userId)
      cleanupState.userId = userId
      cleanupState.accessToken = accessToken
      await page.addInitScript((token) => {
        window.sessionStorage.setItem('couturecast.access-token', token)
      }, accessToken)
      await page.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

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
      await expect(
        page.getByRole('heading', { level: 1, name: 'Wardrobe' })
      ).toBeVisible()

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
    }
  )
})
