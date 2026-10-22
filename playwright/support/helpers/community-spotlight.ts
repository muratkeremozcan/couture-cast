// Story 6.6: City Spotlight fixtures for the browser journeys.
//
// Each journey that needs its own ranking owns a unique area tuple with its own
// cohort, so no two tests can move each other's spotlight. The authors are the
// seeded synthetic accounts (`packages/db/prisma/seeds/community-spotlight.ts`):
// a cohort counts distinct authors per area, so reusing them in a fresh area
// builds a fresh cohort without creating accounts the run would have to erase.
import type { TestInfo } from '@playwright/test'
import {
  buildSpotlightSavedLocationCreateInput,
  persistSpotlightCohort,
  planSpotlightCohort,
  uniqueSpotlightArea,
  type SpotlightAreaNames,
} from '@couture/testing'
import { buildUniqueId } from './api-test'
import { communityTestDatabase } from './community-engagement'
import { expect } from './community-session'

export const COMMUNITY_SPOTLIGHT_URL = '**/api/v1/community/spotlight*'

/**
 * Restated from the seed, which publishes one post per author as
 * `seed-spotlight-<n>`. `assertSeededSpotlight` checks the restatement so a
 * drifted or stale seed fails naming `npm run db:seed`.
 */
export const SEEDED_SPOTLIGHT_AUTHOR_IDS = Array.from(
  { length: 6 },
  (_, index) => `spotlight-author-${index + 1}`
)
export const SEEDED_SPOTLIGHT_POST_IDS = SEEDED_SPOTLIGHT_AUTHOR_IDS.map(
  (_, index) => `seed-spotlight-${index + 1}`
)

/** The feed seed's first post, whose uploaded object every fixture post reuses. */
const SIGNABLE_SEEDED_POST_ID = 'lookbook-1'

const SPOTLIGHT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The seeded posts publish relative to the time the seed ran, and the spotlight
 * ranks the last seven days only, so a local database seeded more than a week
 * ago legitimately shows no seeded spotlight.
 */
export async function assertSeededSpotlight(): Promise<void> {
  const db = communityTestDatabase()
  try {
    const posts = await db.lookbookPost.findMany({
      where: { id: { in: SEEDED_SPOTLIGHT_POST_IDS } },
      select: { id: true, published_at: true },
    })
    expect(
      posts.map((post) => post.id).sort(),
      'The seeded City Spotlight cohort is missing. Run `npm run db:seed`.'
    ).toEqual([...SEEDED_SPOTLIGHT_POST_IDS].sort())
    const oldest = Math.min(...posts.map((post) => post.published_at?.getTime() ?? 0))
    expect(
      Date.now() - oldest,
      'The seeded City Spotlight cohort has aged out of the seven-day window. Run `npm run db:seed`.'
    ).toBeLessThan(SPOTLIGHT_WINDOW_MS)
  } finally {
    await db.$disconnect()
  }
}

export type SpotlightFixture = {
  area: SpotlightAreaNames
  /** Post ids in the order the API must rank them. */
  expectedOrder: string[]
  captions: Map<string, string>
  cleanup: () => Promise<void>
}

/**
 * Publishes a cohort of `6 + extra` ranked posts in a unique area, with strictly
 * decreasing scores: the six seeded authors each publish one post planned by the
 * shared factory, and `extra` older posts follow with one reaction each.
 */
export async function createSpotlightCohort(
  testInfo: TestInfo,
  options: { extra?: number } = {}
): Promise<SpotlightFixture> {
  const namespace = buildUniqueId('spotlight', testInfo)
  const area = uniqueSpotlightArea(namespace)
  const db = communityTestDatabase()
  const seedTime = new Date()
  const created: string[] = []
  try {
    const signable = await db.lookbookPost.findUnique({
      where: { id: SIGNABLE_SEEDED_POST_ID },
      select: { image_object_path: true },
    })
    expect(
      signable?.image_object_path,
      `Seeded post ${SIGNABLE_SEEDED_POST_ID} has no uploaded object. Run \`npm run db:seed\`.`
    ).toBeTruthy()
    const authors = await db.user.count({
      where: { id: { in: SEEDED_SPOTLIGHT_AUTHOR_IDS } },
    })
    expect(
      authors,
      'The seeded spotlight authors are missing. Run `npm run db:seed`.'
    ).toBe(SEEDED_SPOTLIGHT_AUTHOR_IDS.length)

    const imageObjectPath = signable?.image_object_path ?? undefined
    const main = planSpotlightCohort({
      namespace,
      seedTime,
      area,
      authorIds: SEEDED_SPOTLIGHT_AUTHOR_IDS,
      imageObjectPath,
    })
    const cohorts = [main]
    const extra = options.extra ?? 0
    if (extra > 0) {
      // Planned from just behind the main cohort, so every extra post is older
      // and carries at most one reaction: it always ranks after the six.
      cohorts.push(
        planSpotlightCohort({
          namespace: `${namespace}-tail`,
          seedTime: new Date(
            seedTime.getTime() - SEEDED_SPOTLIGHT_AUTHOR_IDS.length * 3_600_000
          ),
          area,
          authorIds: SEEDED_SPOTLIGHT_AUTHOR_IDS.slice(0, Math.max(2, extra)),
          imageObjectPath,
          captionPrefix: 'Spotlight tail look',
        })
      )
    }
    for (const cohort of cohorts) {
      created.push(...cohort.posts.map((post) => post.id))
      await persistSpotlightCohort(db, cohort)
    }
    const posts = cohorts.flatMap((cohort) => cohort.posts)
    return {
      area,
      expectedOrder: cohorts.flatMap((cohort) => cohort.expectedOrder),
      captions: new Map(posts.map((post) => [post.id, post.caption ?? ''])),
      cleanup: () => deleteSpotlightPosts(created),
    }
  } catch (error) {
    await deleteSpotlightPosts(created)
    throw error
  } finally {
    await db.$disconnect()
  }
}

/** Reactions cascade with their posts; the seeded authors stay. */
async function deleteSpotlightPosts(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return
  const db = communityTestDatabase()
  try {
    await db.communityReaction.deleteMany({ where: { post_id: { in: postIds } } })
    await db.lookbookPost.deleteMany({ where: { id: { in: postIds } } })
  } finally {
    await db.$disconnect()
  }
}

/** Gives the session member a primary saved location inside `area`. */
export async function placeViewerInArea(
  userId: string,
  area: SpotlightAreaNames
): Promise<() => Promise<void>> {
  const db = communityTestDatabase()
  try {
    const location = await db.savedLocation.create({
      data: buildSpotlightSavedLocationCreateInput(userId, area),
    })
    return async () => {
      const cleanup = communityTestDatabase()
      try {
        await cleanup.savedLocation.deleteMany({ where: { id: location.id } })
      } finally {
        await cleanup.$disconnect()
      }
    }
  } finally {
    await db.$disconnect()
  }
}
