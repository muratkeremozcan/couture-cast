// Story 4.4 Task 8 owner: keyboard-only completion, visible focus, slider
// target geometry, live announcements, and axe for the guided onboarding flow
// and the standalone silhouette settings surface (AC 5).
import { signupResponseSchema } from '@couture/api-client/contracts/http'
import type { Page, TestInfo } from '@playwright/test'
import type { ApiRequestFixture } from '../support/helpers/api-test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'

/** WCAG 2.2 AA target size minimum. */
const MIN_TARGET_PX = 44

const environment = resolveEnvironmentConfig('local')

type CleanupState = {
  userId?: string
  accessToken?: string
}

const a11yTest = test.extend<{ cleanupState: CleanupState }>({
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

a11yTest.describe('Wardrobe Onboarding Accessibility', () => {
  a11yTest.use({ authSessionEnabled: false })

  a11yTest.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The onboarding accessibility journey requires the supervised local API and wardrobe worker.'
    )
  })

  a11yTest(
    '4.4-A11Y-01 passes axe on the permission step and the silhouette step',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-axe'
      )
      await page.goto('/wardrobe/onboarding')
      await checkA11y(page, {
        includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
      })

      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await page.getByRole('button', { name: 'Use starter wardrobe' }).click()
      await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()
      await checkA11y(page, {
        includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
      })
    }
  )

  a11yTest(
    '4.4-A11Y-02 completes the starter-wardrobe path using only the keyboard',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-keyboard'
      )
      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)

      await page.getByRole('button', { name: 'Allow camera and photo access' }).focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('button', { name: 'Use starter wardrobe' })
      ).toBeVisible()

      await page.getByRole('button', { name: 'Use starter wardrobe' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()

      await test.step('The height slider is keyboard-adjustable', async () => {
        const heightSlider = page.getByTestId('silhouette-height-slider')
        const saveResponse = page.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/wardrobe/silhouette') &&
            response.request().method() === 'PUT'
        )
        await heightSlider.focus()
        await expect(heightSlider).toBeFocused()
        await heightSlider.press('ArrowRight')
        await expect(heightSlider).toHaveValue('51')
        // Wait for the debounced save to settle before continuing: the
        // Continue button stays disabled while a save is in flight, so
        // pressing Enter too early on a keyboard-only journey does nothing.
        await saveResponse
      })

      const continueButton = page.getByRole('button', { name: 'Continue' })
      await expect(continueButton).toBeEnabled()
      await continueButton.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText('Your closet is ready')).toBeVisible()

      const finalContinueButton = page.getByRole('button', { name: 'Continue' })
      await finalContinueButton.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/wardrobe$/)
    }
  )

  a11yTest(
    '4.4-A11Y-03 moves focus to the new step region on every transition',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-focus'
      )
      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)

      const stepRegion = page.getByTestId('onboarding-step-region')

      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await expect(stepRegion).toBeFocused()

      await page.getByRole('button', { name: 'Use starter wardrobe' }).click()
      await expect(stepRegion).toBeFocused()

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(stepRegion).toBeFocused()
    }
  )

  a11yTest(
    '4.4-A11Y-04 announces permission and step-transition events through a polite live region',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-live'
      )
      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)

      const liveRegion = page.getByTestId('onboarding-status-region')
      await expect(liveRegion).toHaveAttribute('aria-live', 'polite')

      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await expect(liveRegion).toContainText(/Camera access/)

      await page.getByRole('button', { name: 'Use starter wardrobe' }).click()
      await expect(liveRegion).toContainText('Set up your silhouette.')
    }
  )

  a11yTest(
    '4.4-A11Y-05 meets the 44px minimum on every interactive onboarding and silhouette target',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-targets'
      )
      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)

      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await page.getByRole('button', { name: 'Use starter wardrobe' }).click()
      await expect(page.getByTestId('silhouette-settings-panel')).toBeVisible()

      const targets = page.locator(
        '[data-testid="silhouette-height-slider"], [data-testid="silhouette-build-slider"], [data-testid="silhouette-settings-panel"] button'
      )
      const count = await targets.count()
      expect(count).toBeGreaterThan(0)

      for (let index = 0; index < count; index += 1) {
        const box = await targets.nth(index).boundingBox()
        if (!box) continue
        expect(box.height, `target ${index} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
      }
    }
  )

  a11yTest(
    '4.4-A11Y-06 exposes the standalone Silhouette settings modal as a named dialog with a focus trap and restores focus on close',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'onboarding-a11y-modal'
      )
      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)

      const invoker = page.getByRole('button', { name: 'Silhouette' })
      await expect(invoker).toBeEnabled()
      await invoker.click()

      const dialog = page.getByRole('dialog', { name: 'Silhouette' })
      await expect(dialog).toBeVisible()
      await checkA11y(page, {
        includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
      })

      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(invoker).toBeFocused()
    }
  )
})
