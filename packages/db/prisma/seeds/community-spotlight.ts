import type { PrismaClient } from '@prisma/client'
import * as spotlightFactories from '../../../testing/src/factories/community-spotlight.factory.ts'

import {
  buildSeededCommunityObjectPath,
  resolveCommunityStorageCredentials,
  uploadSeededCommunityObject,
} from './community-storage.js'
import { unwrapCjsNamespace } from './interop.js'

const {
  SEEDED_SPOTLIGHT_AREA,
  SPOTLIGHT_FIXTURE_COHORT_AUTHORS,
  buildSpotlightSavedLocationCreateInput,
  persistSpotlightCohort,
  planSpotlightCohort,
} = unwrapCjsNamespace(spotlightFactories)

/** Stable synthetic author ids, so a re-run seed upserts the same rows. */
export const SEEDED_SPOTLIGHT_AUTHOR_IDS = Array.from(
  { length: SPOTLIGHT_FIXTURE_COHORT_AUTHORS + 1 },
  (_, index) => `spotlight-author-${index + 1}`
)

export const SEEDED_SPOTLIGHT_NAMESPACE = 'seed'
const SEEDED_SPOTLIGHT_OBJECT_KEY = 'spotlight-seed'

/**
 * Story 6.6: one shared, read-only City Spotlight cohort for local, Playwright
 * and Maestro runs, in `SEEDED_SPOTLIGHT_AREA`.
 *
 * Unlike the feed seed, these posts publish relative to ONE time captured when
 * the seed runs. The spotlight only ranks the last seven days, so a fixed
 * epoch would age every seeded post out of the window. The feed's own fixed
 * epoch stays untouched so feed ordering tests keep their stable pages.
 */
export async function seedCommunitySpotlight(
  prisma: PrismaClient,
  seedTime: Date = new Date()
): Promise<void> {
  const credentials = resolveCommunityStorageCredentials()
  const objectPath = buildSeededCommunityObjectPath(SEEDED_SPOTLIGHT_OBJECT_KEY)
  await uploadSeededCommunityObject(SEEDED_SPOTLIGHT_OBJECT_KEY, objectPath, credentials)

  for (const [index, id] of SEEDED_SPOTLIGHT_AUTHOR_IDS.entries()) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email: `${id}@example.com`,
        profile: {
          create: {
            display_name: `Spotlight Author ${index + 1}`,
            birthdate: new Date('1990-01-01T00:00:00.000Z'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
        },
      },
    })
    // Authors can sign in and see their own area's spotlight locally.
    const location = buildSpotlightSavedLocationCreateInput(id, SEEDED_SPOTLIGHT_AREA, {
      locationKey: `spotlight-seed-${index + 1}`,
    })
    await prisma.savedLocation.upsert({
      where: {
        user_id_location_key: { user_id: id, location_key: location.location_key },
      },
      update: { city: location.city, region: location.region, country: location.country },
      create: location,
    })
  }

  await persistSpotlightCohort(
    prisma,
    planSpotlightCohort({
      namespace: SEEDED_SPOTLIGHT_NAMESPACE,
      seedTime,
      area: SEEDED_SPOTLIGHT_AREA,
      authorIds: SEEDED_SPOTLIGHT_AUTHOR_IDS,
      imageObjectPath: objectPath,
      captionPrefix: 'Seeded spotlight look',
    })
  )
}
