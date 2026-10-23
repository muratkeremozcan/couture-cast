// Story 1.2b: a fresh member with no saved location, on the auto community arm,
// for the location capture journeys.
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { APIRequestContext } from '@playwright/test'
import {
  coordinateKeySuffix,
  sentinelPlace,
} from '../../../scripts/lib/weather-provider-double-data.mjs'
import { expect, test } from '../fixtures/merged-fixtures'
import { buildUniqueId, isNonLocalEnvironment, resolveApiBaseUrl } from './api-test'
import { seedWebSession } from './commerce-session'
import {
  communityAccessToken,
  deleteCommunityRowsForUser,
  signUpCommunityUser,
} from './community-session'

export { expect, sentinelPlace }

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

export type LocationSession = {
  userId: string
  accessToken: string
  apiBaseUrl: string
  /** A query only this test types, geocoding to coordinates no run has saved. */
  sentinelQuery: string
  sentinelKeySuffix: string
}

/**
 * EVERY TEST MUST DESTRUCTURE `locationSession`; fixtures are lazy, and a
 * signed-out page renders a calm shell that reads like a broken component.
 */
export const locationTest = test.extend<{ locationSession: LocationSession }>({
  locationSession: async ({ context, request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Location capture writes locations and needs the local weather provider double.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const unique = buildUniqueId('loc', testInfo)
    const userId = await signUpAutoArmMember(request, apiBaseUrl, unique)
    const accessToken = communityAccessToken(userId)
    const nonce = unique.toLowerCase().replace(/[^a-z0-9]/g, '')
    const place = sentinelPlace(nonce)
    await seedWebSession(context, accessToken)

    await use({
      userId,
      accessToken,
      apiBaseUrl,
      sentinelQuery: `Sentinel ${nonce}`,
      sentinelKeySuffix: coordinateKeySuffix(place.lat, place.lon),
    })

    await deleteCommunityRowsForUser(userId)
    const prisma = locationPrisma()
    try {
      const keys = (
        await prisma.savedLocation.findMany({
          where: { user_id: userId },
          select: { location_key: true },
        })
      ).map((row) => row.location_key)
      await prisma.savedLocation.deleteMany({ where: { user_id: userId } })
      const sentinelKeys = keys.filter((key) =>
        key.endsWith(coordinateKeySuffix(place.lat, place.lon))
      )
      await prisma.forecastSegment.deleteMany({
        where: { weather_snapshot: { location_key: { in: sentinelKeys } } },
      })
      await prisma.weatherSnapshot.deleteMany({
        where: { location_key: { in: sentinelKeys } },
      })
    } finally {
      await prisma.$disconnect()
    }
  },
})
