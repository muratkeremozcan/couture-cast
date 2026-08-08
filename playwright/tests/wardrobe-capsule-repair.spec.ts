// Story 4.3 Task 8: repair, recommendation, favorite, and delete journey.
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
import { waitForAccessibilityReady } from '../support/helpers/accessibility'

const CLIENT_RECONCILIATION_BUDGET_MS = 2_000

const environment = resolveEnvironmentConfig()

const CAPSULE_LIST_URL = '**/api/v1/wardrobe/*/capsules*'
/** One extra segment, so this never collides with the list pattern above. */
const CAPSULE_DETAIL_URL = '**/api/v1/wardrobe/*/capsules/*'
const CAPSULE_FAVORITE_URL = '**/api/v1/wardrobe/*/capsules/*/favorite'

type CapsuleListResponse = {
  data: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

type CapsuleResponse = { data: OutfitCapsuleContract }

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

test.describe('Wardrobe capsule repair and lifecycle', () => {
  /**
   * A retained garment that is no longer available leaves the capsule visible
   * and manageable, marked `needs_repair`, with its unavailable count surfaced.
   */
  test('4.3-E2E-05 surfaces a repair state and lets the owner repair it', async ({
    capsuleSession: _capsuleSession,
    page,
    interceptNetworkCall,
  }) => {
    const listed = await openCapsules(page, interceptNetworkCall)

    await log.step('Select a repair-state capsule from the payload, not the rendered DOM')
    const needsRepair = (listed?.data ?? []).find(
      (capsule) => capsule.availabilityStatus === 'needs_repair'
    )
    test.skip(
      !needsRepair,
      'Seed data has no capsule in a repair state for this environment.'
    )

    expect(needsRepair?.unavailableGarmentCount).toBeGreaterThan(0)

    await log.step('Assert the card surfaces the unavailable count and opens to a banner')
    const card = page.getByTestId(`capsule-card-${needsRepair?.id}`)
    await expect(
      card.locator('[data-testid^="capsule-unavailable-count-"]')
    ).toBeVisible()

    await card.locator('[data-testid^="edit-capsule-button-"]').click()
    await expect(page.getByTestId('capsule-repair-banner')).toBeVisible()

    await log.step('Choose a replacement to restore a valid 2-to-10 selection')
    const available = page.locator('[data-testid^="garment-select-checkbox-"]')
    await available.first().check()

    const patchCall = interceptNetworkCall({
      method: 'PATCH',
      url: CAPSULE_DETAIL_URL,
    })

    await page.getByTestId('save-capsule-button').click()
    const { status, response, responseJson } = await patchCall

    const repaired = responseJson as CapsuleResponse | null

    await log.step('Assert the repair clears the state and count in the same response')
    expect(status).toBe(200)
    expect(response?.headers()['etag']).toMatch(/^"capsule:.+:\d+"$/)
    expect(repaired?.data.availabilityStatus).toBe('ready')
    expect(repaired?.data.unavailableGarmentCount).toBe(0)
    expect(repaired?.data.revision).toBeGreaterThan(needsRepair?.revision ?? 0)
  })

  test('4.3-E2E-06 toggles favorite and reflects it within two seconds', async ({
    capsuleSession,
    apiRequest,
    page,
    interceptNetworkCall,
  }) => {
    const seeded = await createCapsuleForTest(
      apiRequest,
      capsuleSession,
      environment.apiBaseUrl,
      `Favorite journey ${Date.now()}`
    )

    await openCapsules(page, interceptNetworkCall)

    await log.step('Toggle favorite on the capsule this test created')
    const favoriteButton = page.getByTestId(`favorite-button-${seeded.id}`)
    const before = false

    const favoriteCall = interceptNetworkCall({
      method: 'PATCH',
      url: CAPSULE_FAVORITE_URL,
    })

    await favoriteButton.click()
    const { status, requestJson, responseJson } = await favoriteCall

    const requested = requestJson as { isFavorite?: boolean } | null
    const updated = responseJson as CapsuleResponse | null

    await log.step('Assert the endpoint sets the requested state and never inverts it')
    expect(status).toBe(200)
    expect(requested?.isFavorite).toBe(!before)
    expect(updated?.data.isFavorite).toBe(!before)

    await log.step('Assert the control reconciles within the two-second budget')
    const committedAt = Date.now()
    await expect(favoriteButton).toHaveAttribute('aria-pressed', String(!before), {
      timeout: CLIENT_RECONCILIATION_BUDGET_MS,
    })
    expect(Date.now() - committedAt).toBeLessThanOrEqual(CLIENT_RECONCILIATION_BUDGET_MS)
  })

  test('4.3-E2E-07 deletes a capsule through the confirmation dialog', async ({
    capsuleSession,
    apiRequest,
    page,
    interceptNetworkCall,
  }) => {
    const seeded = await createCapsuleForTest(
      apiRequest,
      capsuleSession,
      environment.apiBaseUrl,
      `Delete journey ${Date.now()}`
    )

    await openCapsules(page, interceptNetworkCall)

    const capsuleName = seeded.name
    const card = page.getByTestId(`capsule-card-${seeded.id}`)

    await log.step('Open the destructive confirmation and assert its accessible name')
    await card.locator('[data-testid^="delete-capsule-button-"]').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName('Delete this capsule?')

    await log.step('Confirm the delete')
    const deleteCall = interceptNetworkCall({
      method: 'DELETE',
      url: CAPSULE_DETAIL_URL,
    })

    await page.getByTestId('confirm-delete-capsule-button').click()
    const { status, request } = await deleteCall

    await log.step('Assert delete is precondition-guarded and the row disappears')
    expect(status).toBe(204)
    expect(request?.headers()['if-match']).toMatch(/^"capsule:.+:\d+"$/)

    await expect(page.getByText(capsuleName)).toHaveCount(0, {
      timeout: CLIENT_RECONCILIATION_BUDGET_MS,
    })
  })

  /*
   * There is deliberately no web journey for the saved-capsule recommendation
   * badge. The web app renders no ritual view: `apps/web/src/app/page.tsx` has a
   * static "Daily ritual" marketing section and nothing in apps/web calls
   * GET /api/v1/ritual. A spec here could only ever time out waiting for a
   * request the app never makes.
   *
   * Capsule selection and the localized badge are covered where they exist:
   * the ranking unit tests, the ritual service and controller suites, and the
   * consumer contract. Add a journey here when web grows a ritual surface.
   */
})
