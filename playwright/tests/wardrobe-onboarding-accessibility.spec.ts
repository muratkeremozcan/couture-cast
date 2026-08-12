// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Story 4.4 Task 8 owner: keyboard-only completion, visible focus, slider
// target geometry, live announcements, and axe for the guided onboarding flow
// and the standalone silhouette settings surface (AC 5).
import { expect } from '../support/fixtures/merged-fixtures'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as a11yTest,
} from '../support/helpers/wardrobe-onboarding-session'

const test = a11yTest

/** WCAG 2.2 AA target size minimum. */
const MIN_TARGET_PX = 44

// A fake video device makes the permission-granted `getUserMedia` path
// deterministic in this suite: without it, Chromium has no real camera in a
// headless/CI environment, so `getUserMedia` rejects even once permission is
// granted (confirmed directly: `grantPermissions(['camera'])` alone still
// produced "Camera access unavailable" here). Must be file-level, not inside
// a `describe` block: Playwright forces a new worker for `launchOptions` and
// refuses to apply it at describe scope.
a11yTest.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
})

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
      // Gate the first scan on the permission step's real content, not just
      // `waitForAccessibilityReady`'s landmark check (which `checkA11y` also
      // runs internally): the onboarding flow renders a loading state and
      // then briefly `null` before the permission step itself mounts, and
      // neither of those intermediate states carries the `main#main-content`
      // id `waitForAccessibilityReady` waits for -- but asserting the actual
      // heading here makes that guarantee explicit rather than implicit.
      await expect(
        page.getByRole('heading', { level: 2, name: 'Allow camera and photo access' })
      ).toBeVisible()
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
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
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
        const saveResponse = interceptNetworkCall({
          method: 'PUT',
          url: '**/api/v1/wardrobe/silhouette*',
        })
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
      // Grant camera before navigating so the permission outcome is
      // deterministic: without this, whether the browser context has a real
      // or fake camera device varies by environment, and the test would
      // otherwise have to accept either the granted or the denied
      // announcement to avoid flaking.
      await page.context().grantPermissions(['camera'])
      await page.goto('/wardrobe/onboarding')
      await waitForAccessibilityReady(page)

      const liveRegion = page.getByTestId('onboarding-status-region')
      await expect(liveRegion).toHaveAttribute('aria-live', 'polite')

      await page.getByRole('button', { name: 'Allow camera and photo access' }).click()
      await expect(liveRegion).toContainText(
        'Camera access granted. Capture your garments.'
      )

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
        expect(box, `target ${index} must have a layout box`).not.toBeNull()
        expect(box!.height, `target ${index} height`).toBeGreaterThanOrEqual(
          MIN_TARGET_PX
        )
        expect(box!.width, `target ${index} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
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

      await test.step('Tab cycles never move focus outside the dialog', async () => {
        // More presses than the panel's known focusable elements (close
        // button, two sliders, confirm checkbox, upload button), so any cycle
        // wrap is exercised at least once.
        for (let index = 0; index < 15; index += 1) {
          await page.keyboard.press('Tab')
          const focusStayedInsideDialog = await dialog.evaluate((dialogEl) =>
            dialogEl.contains(document.activeElement)
          )
          expect(
            focusStayedInsideDialog,
            `focus after Tab press ${index + 1} must stay inside the dialog`
          ).toBe(true)
        }
      })

      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(invoker).toBeFocused()
    }
  )
})
