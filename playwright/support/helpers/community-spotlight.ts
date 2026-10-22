// Story 6.6: City Spotlight fixtures for the browser journeys.
//
// Every browser journey reads the shared seeded cohort and none of them changes
// a reaction, which is the case the story reserves for a per-test area. A
// per-test cohort would also publish public posts dated this week, and those
// lead every concurrent test's feed and push the feed seed off its first page.
import {
  SEEDED_SPOTLIGHT_COHORT_SIZE,
  buildSpotlightSavedLocationCreateInput,
  type SpotlightAreaNames,
} from '@couture/testing'
import { communityTestDatabase } from './community-engagement'
import { expect } from './community-session'

/**
 * Restated from the seed, which publishes one post per author as
 * `seed-spotlight-<n>` in rank order with the caption `Seeded spotlight look <n>`.
 * `assertSeededSpotlight` checks the restatement so a drifted or stale seed
 * fails naming `npm run db:seed`.
 */
export const SEEDED_SPOTLIGHT_POST_IDS = Array.from(
  { length: SEEDED_SPOTLIGHT_COHORT_SIZE },
  (_, index) => `seed-spotlight-${index + 1}`
)

export function seededSpotlightCaption(postId: string): string {
  return `Seeded spotlight look ${postId.replace('seed-spotlight-', '')}`
}

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
      select: { id: true, published_at: true, caption: true },
    })
    expect(
      posts.map((post) => post.id).sort(),
      'The seeded City Spotlight cohort is missing. Run `npm run db:seed`.'
    ).toEqual([...SEEDED_SPOTLIGHT_POST_IDS].sort())
    for (const post of posts) expect(post.caption).toBe(seededSpotlightCaption(post.id))
    const oldest = Math.min(...posts.map((post) => post.published_at?.getTime() ?? 0))
    expect(
      Date.now() - oldest,
      'The seeded City Spotlight cohort has aged out of the seven-day window. Run `npm run db:seed`.'
    ).toBeLessThan(SPOTLIGHT_WINDOW_MS)
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
