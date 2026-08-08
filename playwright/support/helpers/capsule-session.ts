import type { Page } from '@playwright/test'
import type { ApiRequestFixtureParams } from '@seontechnologies/playwright-utils/api-request'
import { interceptNetworkCall } from '@seontechnologies/playwright-utils/intercept-network-call'
import { expect, test } from '../fixtures/merged-fixtures'

/**
 * Capsule journeys need an owner who already has eligible garments, because the
 * builder can only select from `ready` and `active` wardrobe items. A freshly
 * signed-up account owns none, so these specs target the seeded wardrobe owner
 * from `packages/db/prisma/seeds`, who has ten.
 *
 * The token uses the documented integration bypass form. The capsules page
 * resolves the owner from `/api/v1/user/profile`, so the session only has to be
 * one the API accepts; no particular token encoding is required.
 */
export const SEEDED_WARDROBE_OWNER = 'teen-1'

export const WEB_ACCESS_TOKEN_STORAGE_KEY = 'couturecast.access-token'

export type CapsuleSession = {
  ownerUserId: string
  accessToken: string
}

/**
 * Seeds the browser session before any navigation.
 *
 * The init script is registered on the context rather than the page so a second
 * page opened mid-test, as the cross-client journey does, is authenticated too.
 */
/**
 * Seeded garment ids for {@link SEEDED_WARDROBE_OWNER}. `seedWardrobeItems`
 * names them deterministically, and each is `ready` and `active`, so the API
 * accepts them as capsule members.
 */
export const SEEDED_GARMENT_IDS = [
  `${SEEDED_WARDROBE_OWNER}-garment-1`,
  `${SEEDED_WARDROBE_OWNER}-garment-2`,
  `${SEEDED_WARDROBE_OWNER}-garment-3`,
] as const

const SEEDED_GARMENT_CATEGORIES = ['top', 'bottom', 'shoes'] as const

/**
 * Stubs the garment library.
 *
 * `GET /api/v1/wardrobe/garments` signs an object-storage URL per garment, so
 * it returns 503 wherever storage is not provisioned, including CI. That is an
 * upstream dependency of these journeys rather than their subject: the capsule
 * requests stay real, and the ids below are the real seeded rows, so the API
 * still validates ownership, readiness, and retention on every mutation.
 *
 * The page is explicit because every page that renders the library needs it.
 * The capsule list and the garment list are fetched together, so an unstubbed
 * second page fails the whole refresh rather than just the images.
 */
export function stubGarmentLibrary(page: Page): void {
  void interceptNetworkCall({
    page,
    method: 'GET',
    url: '**/api/v1/wardrobe/garments',
    fulfillResponse: {
      status: 200,
      body: {
        data: SEEDED_GARMENT_IDS.map((id, index) => ({
          id,
          status: 'ready',
          category: SEEDED_GARMENT_CATEGORIES[index] ?? 'top',
          material: 'cotton',
          comfortRange: 'mild',
          tagsConfirmedAt: '2026-08-07T10:00:00.000Z',
          fileSizeBytes: 2048,
          mimeType: 'image/png',
          retentionStatus: 'active',
          createdAt: '2026-08-07T10:00:00.000Z',
          committedAt: '2026-08-07T10:00:00.000Z',
          imageAccess: null,
        })),
      },
    },
  })
}

export const capsuleTest = test.extend<{ capsuleSession: CapsuleSession }>({
  capsuleSession: async ({ context }, use) => {
    const ownerUserId = SEEDED_WARDROBE_OWNER

    /**
     * The role is deliberately not `teen`. `RequestAuthGuard` gates that role
     * behind active guardian consent, and the seeded wardrobe owners carry no
     * compliance block, so a teen token is rejected with 403 before any capsule
     * route runs. The identity is still the seeded owner, so every request is
     * an owner acting on their own capsules.
     */
    const accessToken = `test-token:guardian:${ownerUserId}`

    await context.addInitScript(
      ([storageKey, token]) => {
        window.sessionStorage.setItem(storageKey as string, token as string)
      },
      [WEB_ACCESS_TOKEN_STORAGE_KEY, accessToken]
    )
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

    await use({ ownerUserId, accessToken })
  },
})

export { expect }

/**
 * The apiRequest fixture is overloaded (classic and operation-based), so the
 * classic parameter shape is referenced directly rather than re-declared.
 */
type ApiRequestFn = <T = unknown>(
  params: ApiRequestFixtureParams
) => Promise<{ status: number; body: T }>

export type SeededCapsule = { id: string; name: string; revision: number }

/**
 * Creates a capsule the calling test exclusively owns.
 *
 * These specs share one seeded wardrobe owner, so a test that acts on
 * "the first listed capsule" operates on whatever a parallel worker happened to
 * leave behind. Burn-in surfaced exactly that: delete, favorite, and reorder
 * interfered with each other across repeats. Each test seeds its own capsule
 * and addresses it by id instead.
 */
export async function createCapsuleForTest(
  apiRequest: ApiRequestFn,
  session: CapsuleSession,
  apiBaseUrl: string,
  name: string
): Promise<SeededCapsule> {
  const response = await apiRequest({
    method: 'POST',
    path: `/api/v1/wardrobe/${session.ownerUserId}/capsules`,
    baseUrl: apiBaseUrl,
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: {
      name,
      occasions: ['work'],
      garmentIds: [SEEDED_GARMENT_IDS[0], SEEDED_GARMENT_IDS[1]],
      isFavorite: false,
    },
  })

  expect(response.status).toBe(201)
  const capsule = (response.body as { data: SeededCapsule }).data
  return { id: capsule.id, name: capsule.name, revision: capsule.revision }
}
