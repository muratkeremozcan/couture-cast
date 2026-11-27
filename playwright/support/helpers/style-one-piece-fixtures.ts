import path from 'node:path'
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  createSavedLookInputSchema,
  federatedSignupStatusResponseSchema,
  parseGarmentListWithColorResponse,
  savedLookListResponseSchema,
  savedLookResponseSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  type GarmentItemContract,
  type GarmentWithColor,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'

const authStorageKey = 'couturecast.auth-session'
const fixturePhoto = path.resolve(
  __dirname,
  '../../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)
const photoPath = '/style-piece-fixture-photo/'
const photoExpiry = '2099-12-31T00:00:00.000Z'

export const memberA = 'style-piece-member-a'
export const memberB = 'style-piece-member-b'

export function photographedGarment(
  origin: string,
  id: string,
  overrides: Partial<GarmentItemContract> = {}
) {
  return createReadyGarmentFixture({
    id,
    imageAccess: { url: new URL(photoPath + id, origin).href, expiresAt: photoExpiry },
    ...overrides,
  })
}

function sessionFor(id: string) {
  return {
    access_token: `local-style-piece-${id}`,
    refresh_token: `local-refresh-style-piece-${id}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id, aud: 'authenticated', email: `${id}@example.test` },
  }
}

/** Restore anonymous Supabase sessions through the app's own verified account bridge. */
export async function switchStyleMember(page: Page, id: string) {
  await page.evaluate(
    ({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session))
      const channel = new BroadcastChannel(key)
      channel.postMessage({ event: 'SIGNED_IN', session })
      channel.close()
    },
    { key: authStorageKey, session: sessionFor(id) }
  )
}

/** Mock inventory and auth only. The app supplies the catalog, recipes, swaps and local saves. */
export async function mockStyleWardrobe(
  page: Page,
  baseURL: string,
  intercept: InterceptNetworkCallFn,
  // Story 7.5: web lists garments with x-couture-garment-color: 1, so an inventory entry may
  // carry colorFamily; one without it answers as a legacy garment would (colorFamily null).
  inventory: Record<string, (GarmentItemContract | GarmentWithColor)[]>
) {
  const origin = new URL(baseURL).origin
  const writes: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (
      pathname.startsWith('/api/v1/') &&
      /^(POST|PUT|PATCH|DELETE)$/.test(request.method())
    ) {
      writes.push(`${request.method()} ${pathname}`)
    }
  })
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (
      url.origin !== origin ||
      url.pathname.startsWith('/api/v1/') ||
      url.pathname.startsWith(photoPath)
    ) {
      await route.abort()
    } else {
      await route.continue()
    }
  })

  await page.addInitScript(
    ({ key, session }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session))
    },
    { key: authStorageKey, session: sessionFor(memberA) }
  )

  const members = new Map(
    Object.keys(inventory).map((id) => [`Bearer ${sessionFor(id).access_token}`, id])
  )
  const mockRead = (endpoint: string, response: (owner: string) => unknown) => {
    void intercept({
      url: `**/api/v1/${endpoint}`,
      handler: async (route, request) => {
        if (new URL(request.url()).origin !== origin || request.method() !== 'GET') {
          await route.abort()
          return
        }
        const owner = members.get(request.headers().authorization ?? '')
        await route.fulfill(
          owner
            ? { json: response(owner) }
            : { status: 401, json: { message: 'Authentication required' } }
        )
      },
    })
  }

  mockRead('user/profile', (id) =>
    userProfileResponseSchema.parse({
      user: {
        id,
        email: `${id}@example.test`,
        displayName: null,
        birthdate: null,
        role: 'guardian',
      },
      linkedGuardians: [],
      linkedTeens: [],
    })
  )
  mockRead('wardrobe/onboarding', () =>
    wardrobeOnboardingStateResponseSchema.parse({
      data: createCompletedOnboardingStateFixture(),
    })
  )
  // An opted-in answer has one shape: an entry without colorFamily answers as a garment whose
  // color was never computed, so a mixed inventory never fails the parse.
  mockRead('wardrobe/garments', (id) =>
    parseGarmentListWithColorResponse({
      data: (inventory[id] ?? []).map((garment) => ({
        ...garment,
        colorFamily: 'colorFamily' in garment ? garment.colorFamily : null,
      })),
    })
  )
  mockRead('auth/signup/federated', () =>
    federatedSignupStatusResponseSchema.parse({ status: 'complete' })
  )

  // Account-backed saved looks mock (CC-7.2) scoped per authenticated member.
  let savedLookSeq = 1
  const savedLooksByOwner = new Map<string, SavedLookContract[]>()
  const deletedLooksByOwner = new Map<string, Map<string, SavedLookContract>>()
  const idempotencyKeys = new Map<string, SavedLookContract>()

  const getOwnerList = (owner: string): SavedLookContract[] => {
    const existing = savedLooksByOwner.get(owner)
    if (existing) return existing
    const created: SavedLookContract[] = []
    savedLooksByOwner.set(owner, created)
    return created
  }

  const getDeletedMap = (owner: string): Map<string, SavedLookContract> => {
    const existing = deletedLooksByOwner.get(owner)
    if (existing) return existing
    const created = new Map<string, SavedLookContract>()
    deletedLooksByOwner.set(owner, created)
    return created
  }

  const handleListSavedLooks = async (
    route: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[0],
    url: URL,
    list: SavedLookContract[]
  ) => {
    const source = url.searchParams.get('source')
    const anchorGarmentId = url.searchParams.get('anchorGarmentId')
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const filtered = list.filter(
      (item) =>
        (!source || item.source === source) &&
        (!anchorGarmentId || item.anchorGarmentId === anchorGarmentId)
    )
    await route.fulfill({
      status: 200,
      json: savedLookListResponseSchema.parse({
        data: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      }),
    })
  }

  const handleCreateSavedLook = async (
    route: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[0],
    request: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[1],
    owner: string,
    list: SavedLookContract[],
    deleted: Map<string, SavedLookContract>
  ) => {
    const idemKey = request.headers()['idempotency-key']?.trim()
    const prior = idemKey ? idempotencyKeys.get(`${owner}:${idemKey}`) : undefined
    if (prior) {
      if (deleted.has(prior.id)) {
        await route.fulfill({
          status: 409,
          json: {
            code: 'SAVED_LOOK_ALREADY_REMOVED',
            message: 'Saved look was already removed',
          },
        })
        return
      }
      const current = list.find((item) => item.id === prior.id) ?? prior
      await route.fulfill({
        status: 200,
        headers: { etag: `"saved-look:${current.id}:${current.revision}"` },
        json: savedLookResponseSchema.parse({ data: current }),
      })
      return
    }
    const input = createSavedLookInputSchema.parse(request.postDataJSON())
    const now = new Date().toISOString()
    const created: SavedLookContract = {
      id: `saved-look-mock-${savedLookSeq++}`,
      ownerUserId: owner,
      source: input.source === 'today' ? 'home_sample' : input.source,
      lookId: input.lookId,
      ...(input.wornOn ? { wornOn: input.wornOn } : {}),
      weather: input.weather,
      title: input.title ?? null,
      anchorGarmentId: input.anchorGarmentId ?? null,
      anchorSnapshot: input.anchorSnapshot ?? null,
      composition: input.composition.map((slot) => ({
        ...slot,
        label: slot.label ?? null,
        missing: false,
        imageAccess: null,
      })),
      swaps: input.swaps ?? {},
      collection: input.collection ?? null,
      comfort: input.comfort ?? null,
      availabilityStatus: 'ready',
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
    list.unshift(created)
    if (idemKey) idempotencyKeys.set(`${owner}:${idemKey}`, created)
    await route.fulfill({
      status: 201,
      headers: { etag: `"saved-look:${created.id}:${created.revision}"` },
      json: savedLookResponseSchema.parse({ data: created }),
    })
  }

  const handleRestoreSavedLook = async (
    route: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[0],
    savedLookId: string,
    list: SavedLookContract[],
    deleted: Map<string, SavedLookContract>
  ) => {
    const active = list.find((item) => item.id === savedLookId)
    if (active) {
      await route.fulfill({
        status: 200,
        json: savedLookResponseSchema.parse({ data: active }),
      })
      return
    }
    const softDeleted = deleted.get(savedLookId)
    if (!softDeleted) {
      await route.fulfill({ status: 404, json: { message: 'Saved look not found' } })
      return
    }
    deleted.delete(savedLookId)
    const restored = { ...softDeleted, revision: softDeleted.revision + 1 }
    list.unshift(restored)
    await route.fulfill({
      status: 200,
      json: savedLookResponseSchema.parse({ data: restored }),
    })
  }

  const handleItemSavedLook = async (
    route: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[0],
    request: Parameters<NonNullable<Parameters<InterceptNetworkCallFn>[0]['handler']>>[1],
    method: string,
    suffix: string,
    list: SavedLookContract[],
    deleted: Map<string, SavedLookContract>
  ) => {
    if (method === 'POST' && suffix.endsWith('/restore')) {
      return handleRestoreSavedLook(
        route,
        suffix.slice(0, -'/restore'.length),
        list,
        deleted
      )
    }
    if (method === 'GET') {
      const found = list.find((item) => item.id === suffix)
      await route.fulfill(
        found
          ? {
              status: 200,
              headers: { etag: `"saved-look:${found.id}:${found.revision}"` },
              json: savedLookResponseSchema.parse({ data: found }),
            }
          : { status: 404, json: { message: 'Saved look not found' } }
      )
      return
    }
    if (method === 'DELETE') {
      const ifMatch = request.headers()['if-match']?.trim()
      if (!ifMatch) {
        await route.fulfill({
          status: 428,
          json: {
            code: 'PRECONDITION_REQUIRED',
            message: 'If-Match header is required',
          },
        })
        return
      }
      const index = list.findIndex((item) => item.id === suffix)
      if (index === -1) {
        await route.fulfill({ status: 404, json: { message: 'Saved look not found' } })
        return
      }
      const target = list[index]!
      const expectedTag = `"saved-look:${target.id}:${target.revision}"`
      if (ifMatch !== '*' && ifMatch !== expectedTag) {
        await route.fulfill({
          status: 412,
          json: {
            code: 'SAVED_LOOK_CONFLICT',
            message: 'Saved look revision mismatch',
          },
        })
        return
      }
      const [removed] = list.splice(index, 1)
      if (removed) deleted.set(removed.id, removed)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    await route.abort()
  }

  const savedLooksHandler: NonNullable<
    Parameters<InterceptNetworkCallFn>[0]['handler']
  > = async (route, request) => {
    const url = new URL(request.url())
    if (url.origin !== origin) {
      await route.abort()
      return
    }
    const owner = members.get(request.headers().authorization ?? '')
    if (!owner) {
      await route.fulfill({ status: 401, json: { message: 'Authentication required' } })
      return
    }
    const list = getOwnerList(owner)
    const deleted = getDeletedMap(owner)
    const method = request.method()
    const suffix = url.pathname.replace(/^\/api\/v1\/wardrobe\/saved-looks\/?/, '')

    if (!suffix && method === 'GET') return handleListSavedLooks(route, url, list)
    if (!suffix && method === 'POST') {
      return handleCreateSavedLook(route, request, owner, list, deleted)
    }
    if (suffix) return handleItemSavedLook(route, request, method, suffix, list, deleted)
    await route.abort()
  }

  void intercept({
    url: '**/api/v1/wardrobe/saved-looks*',
    handler: savedLooksHandler,
  })
  void intercept({
    url: '**/api/v1/wardrobe/saved-looks/**',
    handler: savedLooksHandler,
  })

  // The project-owned neutral PNG is reused for each anonymous garment. The
  // requested URL identifies the row, so substituting a different garment fails.
  void intercept({
    url: `**${photoPath}*`,
    handler: async (route, request) => {
      if (new URL(request.url()).origin !== origin || request.method() !== 'GET') {
        await route.abort()
        return
      }
      await route.fulfill({ path: fixturePhoto })
    },
  })
  return writes
}
