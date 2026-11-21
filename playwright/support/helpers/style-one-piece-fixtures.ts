import path from 'node:path'
import type { Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import {
  federatedSignupStatusResponseSchema,
  garmentListResponseSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  type GarmentItemContract,
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
  inventory: Record<string, GarmentItemContract[]>
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
  mockRead('wardrobe/garments', (id) =>
    garmentListResponseSchema.parse({ data: inventory[id] })
  )
  mockRead('auth/signup/federated', () =>
    federatedSignupStatusResponseSchema.parse({ status: 'complete' })
  )

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
