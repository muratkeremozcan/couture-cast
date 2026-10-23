// Story 1.2b: a fresh member with no saved location, on the auto community arm,
// for the location capture journeys.
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { APIRequestContext } from '@playwright/test'
import type {
  ApiRequestParams,
  ApiRequestResponse,
} from '@seontechnologies/playwright-utils/api-request'
import {
  createSavedLocationFromSearchResponseSchema,
  locationSearchResponseSchema,
  type SavedLocation,
} from '@couture/api-client/contracts/http'
import {
  coordinateKeySuffix,
  FLAKY_SAVE_PREFIX,
  FLAKY_SEARCH_PREFIX,
  flakySavePlace,
  sentinelPlace,
  type WeatherProviderDoublePlace,
} from '../../../scripts/lib/weather-provider-double-data.mjs'
import { expect, test } from '../fixtures/merged-fixtures'
import { buildUniqueId, isNonLocalEnvironment, resolveApiBaseUrl } from './api-test'
import { seedWebSession } from './commerce-session'
import {
  communityAccessToken,
  deleteCommunityRowsForUser,
  signUpCommunityUser,
} from './community-session'

export { expect }

/**
 * Same resolution chain as the other local-lane helpers, and never
 * `packages/db/.env`, which importing Prisma would otherwise load.
 */
export const locationDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function locationPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: locationDatabaseUrl } } })
}

/**
 * The community beta arm, as `community-analytics.ts` assigns it. Only the auto
 * arm serves `auto`, and only `auto` shows the no-location notice, so a member
 * on the other arm could never see the guided action.
 */
export function communityArm(userId: string): 'auto' | 'all' {
  const digest = createHash('sha256').update(`community-experiment:${userId}`).digest()
  return digest.readUInt8(0) % 2 === 0 ? 'auto' : 'all'
}

async function signUpAutoArmMember(
  request: APIRequestContext,
  apiBaseUrl: string,
  unique: string
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const userId = await signUpCommunityUser(request, apiBaseUrl, `${unique}-${attempt}`)
    if (communityArm(userId) === 'auto') return userId
  }
  throw new Error('No auto-arm member after 12 signups; the arm hash changed.')
}

/**
 * Twelve hex characters of the per-test id. The unique id itself grows with
 * `PW_TEST_RUN_ID`, and a nonce cut by the input's 80-character limit would
 * geocode a different place than the one the test asserts on.
 */
export function locationNonce(unique: string): string {
  return createHash('sha256').update(unique).digest('hex').slice(0, 12)
}

export type ApiRequestFn = <T = unknown>(
  options: Omit<ApiRequestParams, 'request'>
) => Promise<ApiRequestResponse<T>>

export type LocationSession = {
  userId: string
  accessToken: string
  apiBaseUrl: string
  /** The weather double's place for this test's nonce; assert against it. */
  sentinelPlace: WeatherProviderDoublePlace
  /** A query only this test types, geocoding to coordinates no run has saved. */
  sentinelQuery: string
  sentinelKeySuffix: string
  /** Fails once with 500, then answers `sentinelPlace`. */
  flakySearchQuery: string
  /** Geocodes to `flakySavePlace`, whose first save-time forecast fails with 503. */
  flakySaveQuery: string
  flakySavePlace: WeatherProviderDoublePlace
  /** Headers the web client sends, for API calls made as this member. */
  headers: Record<string, string>
  /**
   * Saves a place the way the web does (search, then save the chosen
   * candidate), so the row and its weather snapshot are real. Rows saved in
   * order: the first one is primary.
   */
  seedLocation: (
    query: string,
    region: string | null,
    label: string
  ) => Promise<SavedLocation>
}

/**
 * EVERY TEST MUST DESTRUCTURE `locationSession`; fixtures are lazy, and a
 * signed-out page renders a calm shell that reads like a broken component.
 */
export const locationTest = test.extend<{ locationSession: LocationSession }>({
  locationSession: async ({ context, request, apiRequest }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Location capture writes locations and needs the local weather provider double.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const unique = buildUniqueId('loc', testInfo)
    const userId = await signUpAutoArmMember(request, apiBaseUrl, unique)
    const accessToken = communityAccessToken(userId)
    const nonce = locationNonce(unique)
    const place = sentinelPlace(nonce)
    const flakyPlace = flakySavePlace(nonce)
    const nonceKeySuffixes = [
      coordinateKeySuffix(place.lat, place.lon),
      coordinateKeySuffix(flakyPlace.lat, flakyPlace.lon),
    ]
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'x-couture-platform': 'web',
    }
    const call = apiRequest as ApiRequestFn
    await seedWebSession(context, accessToken)

    async function seedLocation(
      query: string,
      region: string | null,
      label: string
    ): Promise<SavedLocation> {
      const search = await call({
        method: 'GET',
        path: '/api/v1/locations/search',
        baseUrl: apiBaseUrl,
        headers,
        params: { q: query, locale: 'en-US' },
      })
      expect(search.status, `search ${query}`).toBe(200)
      const candidate = locationSearchResponseSchema
        .parse(search.body)
        .data.find((option) => option.region === region)
      if (!candidate) throw new Error(`No ${query} candidate in region ${region}.`)
      const saved = await call({
        method: 'POST',
        path: '/api/v1/locations/from-search',
        baseUrl: apiBaseUrl,
        headers,
        body: { candidateToken: candidate.candidateToken, label },
      })
      expect(saved.status, `save ${label}`).toBe(201)
      return createSavedLocationFromSearchResponseSchema.parse(saved.body).data
    }

    await use({
      userId,
      accessToken,
      apiBaseUrl,
      sentinelPlace: place,
      sentinelQuery: `Sentinel ${nonce}`,
      sentinelKeySuffix: nonceKeySuffixes[0]!,
      flakySearchQuery: `${FLAKY_SEARCH_PREFIX} ${nonce}`,
      flakySaveQuery: `${FLAKY_SAVE_PREFIX} ${nonce}`,
      flakySavePlace: flakyPlace,
      headers,
      seedLocation,
    })

    await deleteCommunityRowsForUser(userId)
    const prisma = locationPrisma()
    try {
      await prisma.savedLocation.deleteMany({ where: { user_id: userId } })
      // By key suffix, not by saved row: a snapshot whose save then failed has
      // no row to find it by. Catalog places (Springfield, Monaco) are shared
      // across tests and left to the local teardown reset.
      const nonceKeys = {
        OR: nonceKeySuffixes.map((suffix) => ({ location_key: { endsWith: suffix } })),
      }
      await prisma.forecastSegment.deleteMany({ where: { weather_snapshot: nonceKeys } })
      await prisma.weatherSnapshot.deleteMany({ where: nonceKeys })
    } finally {
      await prisma.$disconnect()
    }
  },
})
