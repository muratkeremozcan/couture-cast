// Story 4.3 Task 8: repair, recommendation, favorite, and delete journey.
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import type { OutfitCapsuleContract } from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'

const CLIENT_RECONCILIATION_BUDGET_MS = 2_000

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

type RitualResponse = {
  data?: {
    outfits?: { capsuleId?: string | null; capsuleName?: string | null }[]
  }
}

async function openCapsules(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<CapsuleListResponse | null> {
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
    page,
    interceptNetworkCall,
  }) => {
    const listed = await openCapsules(page, interceptNetworkCall)
    const target = listed?.data?.[0]
    test.skip(!target, 'No capsules seeded.')

    await log.step('Toggle favorite on the first listed capsule')
    const favoriteButton = page.getByTestId(`favorite-button-${target?.id}`)
    const before = target?.isFavorite ?? false

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
    page,
    interceptNetworkCall,
  }) => {
    const listed = await openCapsules(page, interceptNetworkCall)
    const target = listed?.data?.[0]
    test.skip(!target, 'No capsules seeded.')

    const capsuleName = target?.name as string
    const card = page.getByTestId(`capsule-card-${target?.id}`)

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

  /** A capsule that wins the ritual is attributed in the response contract. */
  test('4.3-E2E-08 shows a saved-capsule recommendation badge when a capsule wins', async ({
    page,
    interceptNetworkCall,
  }) => {
    await log.step('Intercept the ritual call before loading the home page')
    const ritualCall = interceptNetworkCall({
      method: 'GET',
      url: '**/api/v1/ritual*',
    })

    await page.goto('/')
    const { status, responseJson } = await ritualCall

    expect(status).toBe(200)

    await log.step('Skip unless a capsule actually won a scenario in this environment')
    const ritual = responseJson as RitualResponse | null
    const winner = ritual?.data?.outfits?.find((outfit) => outfit.capsuleId)
    test.skip(!winner, 'No capsule won a scenario in this environment.')

    await log.step('Assert the localized badge renders; the capsule name stays separate')
    await expect(page.getByText(/Saved capsule/i).first()).toBeVisible()
  })
})
