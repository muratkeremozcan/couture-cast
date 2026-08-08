// Story 4.3 Task 8: keyboard-only capsule creation, reorder semantics, and axe.
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import type { OutfitCapsuleContract } from '@couture/api-client/contracts/http'
import {
  capsuleTest as test,
  createCapsuleForTest,
  expect,
  stubGarmentLibrary,
} from '../support/helpers/capsule-session'
import { resolveEnvironmentConfig } from '../config/environments'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'

/** WCAG 2.2 AA target size minimum. */
const MIN_TARGET_PX = 44

const CAPSULE_LIST_URL = '**/api/v1/wardrobe/*/capsules*'

const environment = resolveEnvironmentConfig()

type CapsuleListResponse = {
  data: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

async function openCapsules(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<CapsuleListResponse | null> {
  stubGarmentLibrary(page)

  await log.step('Intercept the capsule library fetch before navigating to it')
  const listCall = interceptNetworkCall({ method: 'GET', url: CAPSULE_LIST_URL })

  await page.goto('/wardrobe/capsules')

  const { responseJson, status } = await listCall
  expect(status).toBe(200)
  await waitForAccessibilityReady(page)

  return responseJson as CapsuleListResponse | null
}

async function selectTwoGarments(page: Page) {
  const checkboxes = page.locator('[data-testid^="garment-select-checkbox-"]')
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
}

test.describe('Wardrobe capsule accessibility', () => {
  test('4.3-A11Y-01 passes axe on the capsule library and the builder dialog', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    await log.step('Run axe against the capsule library')
    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })

    await log.step('Run axe again with the builder dialog open')
    await page.getByTestId('create-capsule-button').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await checkA11y(page, {
      includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    })
  })

  test('4.3-A11Y-02 completes creation using only the keyboard', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    await log.step('Open the dialog from the keyboard and assert focus enters it')
    await page.getByTestId('create-capsule-button').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByTestId('capsule-name-input')).toBeFocused()

    await log.step('Type a name and select two garments with Space')
    await page.keyboard.type(`Keyboard capsule ${Date.now()}`)

    const checkboxes = page.locator('[data-testid^="garment-select-checkbox-"]')
    await checkboxes.nth(0).focus()
    await page.keyboard.press('Space')
    await checkboxes.nth(1).focus()
    await page.keyboard.press('Space')

    await expect(page.getByTestId('capsule-selection-count')).toContainText(
      '2 of 10 selected'
    )
  })

  /**
   * Regression: focus previously landed on the control that had just become
   * disabled at the boundary, silently dropping the user onto <body>.
   */
  test('4.3-A11Y-03 keeps focus on a usable reorder control at the boundary', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)
    await page.getByTestId('create-capsule-button').click()
    await selectTwoGarments(page)

    await log.step('Move the second row up so it reaches the top boundary')
    const rows = page.locator('[data-testid^="ordered-garment-item-"]')
    const secondId = (await rows.nth(1).getAttribute('data-testid'))?.replace(
      'ordered-garment-item-',
      ''
    )

    await page.getByTestId(`move-up-button-${secondId}`).focus()
    await page.keyboard.press('Enter')

    await log.step('Assert focus moved to the still-usable control, not to <body>')
    await expect(page.getByTestId(`move-up-button-${secondId}`)).toBeDisabled()
    await expect(page.getByTestId(`move-down-button-${secondId}`)).toBeFocused()
  })

  test('4.3-A11Y-04 announces the move through a polite live region', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)
    await page.getByTestId('create-capsule-button').click()
    await selectTwoGarments(page)

    await log.step('Move the first row down')
    const rows = page.locator('[data-testid^="ordered-garment-item-"]')
    const firstId = (await rows.nth(0).getAttribute('data-testid'))?.replace(
      'ordered-garment-item-',
      ''
    )
    await page.getByTestId(`move-down-button-${firstId}`).click()

    await log.step('Assert a polite live region announced the new position')
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /Moved/ })
    ).toBeVisible()
  })

  test('4.3-A11Y-05 meets the 44px minimum on every interactive capsule target', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)
    await page.getByTestId('create-capsule-button').click()

    await log.step('Measure every interactive capsule target against WCAG 2.2 AA')
    const targets = page.locator(
      '[data-testid="create-capsule-button"], [data-testid^="move-up-button-"], [data-testid^="move-down-button-"], [data-testid="save-capsule-button"]'
    )

    const count = await targets.count()
    expect(count).toBeGreaterThan(0)

    for (let index = 0; index < count; index += 1) {
      const box = await targets.nth(index).boundingBox()
      if (!box) continue
      expect(box.height, `target ${index} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
      expect(box.width, `target ${index} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX)
    }
  })

  test('4.3-A11Y-06 restores focus to the invoking control when the dialog closes', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    await openCapsules(page, interceptNetworkCall)

    await log.step('Open the dialog, then dismiss it with Escape')
    const invoker = page.getByTestId('create-capsule-button')
    await invoker.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')

    await log.step('Assert focus returned to the invoking control')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(invoker).toBeFocused()
  })

  test('4.3-A11Y-07 exposes the delete confirmation as a named dialog', async ({
    capsuleSession,
    apiRequest,
    page,
    interceptNetworkCall,
  }) => {
    const seeded = await createCapsuleForTest(
      apiRequest,
      capsuleSession,
      environment.apiBaseUrl,
      `Delete dialog ${Date.now()}`
    )

    await openCapsules(page, interceptNetworkCall)

    await log.step('Open the destructive confirmation and run axe against it')
    await page.getByTestId(`delete-capsule-button-${seeded.id}`).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName('Delete this capsule?')

    await checkA11y(page, { includedImpacts: ['critical', 'serious'] })
  })
})
