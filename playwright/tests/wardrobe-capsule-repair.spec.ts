// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 4.3 Task 8: repair, recommendation, favorite, and delete journey.
// Story CC-7.12 (Step 69): the capsule manager moved to /looks/capsules (/wardrobe/capsules now
// redirects to Looks > Saved > Capsules), so the spec opens the new address.
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import type { ApiRequestFixtureParams } from '@seontechnologies/playwright-utils/api-request'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { log } from '@seontechnologies/playwright-utils/log'
import {
  type OutfitCapsuleContract,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  capsuleTest as test,
  createCapsuleForTest,
  expect,
  type LibraryGarment,
  stubGarmentLibrary,
} from '../support/helpers/capsule-session'
import { resolveEnvironmentConfig } from '../config/environments'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { seedWebSession } from '../support/helpers/commerce-session'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import {
  cleanupWardrobeUserTestData,
  localPlaywrightDatabaseUrl,
} from '../support/helpers/user-test-data'

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

type ApiRequestFn = <T = unknown>(
  params: ApiRequestFixtureParams
) => Promise<{ status: number; body: T }>

async function openCapsules(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  library?: readonly LibraryGarment[]
): Promise<CapsuleListResponse | null> {
  stubGarmentLibrary(page, library)

  await log.step('Intercept the capsule library fetch before navigating to it')
  const listCall = interceptNetworkCall({ method: 'GET', url: CAPSULE_LIST_URL })

  await page.goto('/looks/capsules')

  const { responseJson, status } = await listCall
  expect(status).toBe(200)
  await waitForAccessibilityReady(page)

  return responseJson as CapsuleListResponse | null
}

function asError(thrown: unknown): Error {
  return thrown instanceof Error
    ? thrown
    : new Error('A non-Error value was thrown', { cause: thrown })
}

/**
 * Deletes a capsule at whatever revision it holds now. Deleting a member garment bumps the
 * revision of every capsule that holds it, so a revision remembered earlier can be stale.
 */
async function deleteCapsuleAtCurrentRevision(
  apiRequest: ApiRequestFn,
  userId: string,
  capsuleId: string,
  headers: Record<string, string>
): Promise<void> {
  const path = `/api/v1/wardrobe/${userId}/capsules/${capsuleId}`
  const current = await apiRequest<CapsuleResponse>({
    method: 'GET',
    path,
    baseUrl: environment.apiBaseUrl,
    headers,
  })
  expect(current.status).toBe(200)
  const removed = await apiRequest({
    method: 'DELETE',
    path,
    baseUrl: environment.apiBaseUrl,
    headers: {
      ...headers,
      'If-Match': `"capsule:${capsuleId}:${current.body.data.revision}"`,
    },
  })
  expect(removed.status).toBe(204)
}

test.describe('Wardrobe capsule repair and lifecycle', () => {
  /**
   * A retained garment that is no longer available leaves the capsule visible
   * and manageable, marked `needs_repair`, with its unavailable count surfaced.
   *
   * The test arranges that state itself: no seed holds a capsule in repair, so this test
   * skipped on every run until 2026-11-19. A fresh member owns three ready garments, keeps
   * two in a capsule, then deletes one of those through the API, which is how a member's
   * capsule reaches `needs_repair`; the third garment is the replacement.
   */
  test('4.3-E2E-05 surfaces a repair state and lets the owner repair it', async ({
    apiRequest,
    context,
    page,
    interceptNetworkCall,
  }, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Arranges its garments in the local database.'
    )
    const signup = await apiRequest({
      method: 'POST',
      path: '/api/v1/auth/signup',
      baseUrl: environment.apiBaseUrl,
      body: {
        email: `${buildUniqueId('capsule-repair', testInfo)}@example.test`,
        birthdate: '1990-06-15',
      },
    })
    expect(signup.status).toBe(201)
    const { userId } = signupResponseSchema.parse(signup.body)
    const accessToken = localE2EAccessToken(userId)
    const headers = { Authorization: `Bearer ${accessToken}` }
    type ArrangedGarment = LibraryGarment & { category: 'top' | 'bottom' | 'shoes' }
    const [kept, removed, replacement] = (['top', 'bottom', 'shoes'] as const).map(
      (category) => ({ id: `capsule-repair-${randomUUID()}`, category })
    ) as [ArrangedGarment, ArrangedGarment, ArrangedGarment]
    let capsuleId: string | undefined
    let testFailure: Error | undefined

    try {
      await log.step('Give the member three ready garments')
      const prisma = new PrismaClient({
        datasourceUrl: localPlaywrightDatabaseUrl().toString(),
      })
      try {
        await prisma.garmentItem.createMany({
          data: [kept, removed, replacement].map(({ id, category }) => ({
            id,
            user_id: userId,
            object_path: `wardrobe/${userId}/${id}.jpg`,
            category,
            material: 'cotton',
            comfort_range: 'mild',
            upload_status: 'ready',
            retention_status: 'active',
          })),
        })
      } finally {
        await prisma.$disconnect()
      }

      await log.step('Build a capsule from two of them, then delete one as the member')
      const created = await apiRequest({
        method: 'POST',
        path: `/api/v1/wardrobe/${userId}/capsules`,
        baseUrl: environment.apiBaseUrl,
        headers,
        body: {
          name: 'Repair me',
          occasions: ['work'],
          garmentIds: [kept.id, removed.id],
          isFavorite: false,
        },
      })
      expect(created.status).toBe(201)
      capsuleId = (created.body as CapsuleResponse).data.id
      const deleted = await apiRequest({
        method: 'DELETE',
        path: `/api/v1/wardrobe/garments/${removed.id}`,
        baseUrl: environment.apiBaseUrl,
        headers,
      })
      expect(deleted.status).toBe(204)

      await seedWebSession(context, accessToken)
      const listed = await openCapsules(page, interceptNetworkCall, [kept, replacement])

      await log.step('The capsule is listed in its repair state')
      const needsRepair = (listed?.data ?? []).find((capsule) => capsule.id === capsuleId)
      expect(needsRepair?.availabilityStatus).toBe('needs_repair')
      expect(needsRepair?.unavailableGarmentCount).toBe(1)

      await log.step(
        'Assert the card surfaces the unavailable count and opens to a banner'
      )
      const card = page.getByTestId(`capsule-card-${capsuleId}`)
      const badge = page.getByTestId(`capsule-status-badge-${capsuleId}`)
      const unavailableCount = page.getByTestId(`capsule-unavailable-count-${capsuleId}`)
      await expect(badge).toHaveText('Needs repair')
      await expect(unavailableCount).toBeVisible()

      await card.locator('[data-testid^="edit-capsule-button-"]').click()
      await expect(page.getByTestId('capsule-repair-banner')).toBeVisible()

      await log.step('Choose the replacement to restore a valid 2-to-10 selection')
      await page.getByTestId(`garment-select-checkbox-${replacement.id}`).check()

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
      expect(repaired?.data.garments.map((garment) => garment.id).sort()).toEqual(
        [kept.id, replacement.id].sort()
      )
      expect(repaired?.data.revision).toBeGreaterThan(needsRepair?.revision ?? 0)

      // A successful save closes the editor, which hides the banner whatever the card shows,
      // so the claim is on the refreshed card the member sees.
      await log.step('Assert the refreshed card reads Ready with no unavailable count')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(card).toBeVisible()
      await expect(badge).toHaveText('Ready')
      await expect(unavailableCount).toHaveCount(0)
    } catch (error) {
      testFailure = asError(error)
    }

    // Member cleanup always runs, and a cleanup failure never hides the test's own failure.
    let cleanupFailure: Error | undefined
    try {
      if (capsuleId)
        await deleteCapsuleAtCurrentRevision(apiRequest, userId, capsuleId, headers)
    } catch (error) {
      cleanupFailure = asError(error)
    }
    try {
      await cleanupWardrobeUserTestData(
        apiRequest,
        accessToken,
        userId,
        environment.apiBaseUrl
      )
    } catch (error) {
      cleanupFailure ??= asError(error)
    }
    if (testFailure) {
      if (cleanupFailure) {
        await log.warning(`Cleanup also failed: ${cleanupFailure.message}`)
      }
      throw testFailure
    }
    if (cleanupFailure) throw cleanupFailure
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
