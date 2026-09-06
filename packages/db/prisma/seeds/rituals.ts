import type { Prisma, PrismaClient } from '@prisma/client'
import * as ritualFactories from '../../../testing/src/factories/ritual.factory.ts'

import {
  buildSeededCommunityObjectPath,
  resolveCommunityStorageCredentials,
  uploadSeededCommunityObject,
} from './community-storage.js'
import { unwrapCjsNamespace } from './interop.js'

/**
 * Fixed publication clock for seeded community posts (2026-01-01T00:00:00Z).
 *
 * The seed is re-run on every `db:reset`, and a wall-clock `new Date()` would
 * give the same logical row a different `published_at` each time, which moves it
 * in the `published_at,id` feed ordering and makes any test that pins a page of
 * the seeded feed flake by construction.
 */
const SEEDED_PUBLICATION_EPOCH_MS = Date.UTC(2026, 0, 1)
import type { SeededGarment } from './wardrobe.js'
import type { SeededWeather } from './weather.js'

const { RITUAL_SCENARIOS, createRitual } = unwrapCjsNamespace(ritualFactories)

export async function seedRituals(
  prisma: PrismaClient,
  teens: { id: string; email: string }[],
  garments: SeededGarment[],
  weather: SeededWeather
): Promise<void> {
  const segmentPool = weather.segmentIds

  const outfitPromises = Array.from({ length: 20 }, (_, i) => {
    const user = teens[i % teens.length]
    if (!user) {
      return null
    }
    const segmentId = segmentPool[i % segmentPool.length]
    const garmentSliceStart = (i * 2) % garments.length
    const garmentSelection = garments.slice(garmentSliceStart, garmentSliceStart + 3)
    const garmentIds = garmentSelection.map((g) => g.id)
    const fixture = createRitual({
      id: `outfit-${i + 1}`,
      userId: user.id,
      forecastSegmentId: segmentId ?? null,
      scenario: RITUAL_SCENARIOS[i % RITUAL_SCENARIOS.length] ?? 'morning',
      garmentIds,
      // Story 2.3 Task 2 step 3 owner: update database seeding structures
      reasoningBadges: [
        {
          key: 'light_layers',
          label: 'Light layers',
          bullets: ['Recommend layered dressing today.'],
        },
        {
          key: 'daily_base',
          label: 'Daily base',
          bullets: ['Dynamic weather conditions detected.'],
        },
      ],
    })

    return prisma.outfitRecommendation.upsert({
      where: { id: fixture.id },
      update: {
        scenario: fixture.scenario,
        garment_ids: fixture.garmentIds,
        reasoning_badges: fixture.reasoningBadges as unknown as Prisma.InputJsonArray,
        forecast_segment: fixture.forecastSegmentId
          ? { connect: { id: fixture.forecastSegmentId } }
          : undefined,
        user: { connect: { id: fixture.userId } },
      },
      create: {
        id: fixture.id,
        user_id: fixture.userId,
        forecast_segment_id: fixture.forecastSegmentId,
        scenario: fixture.scenario,
        garment_ids: fixture.garmentIds,
        reasoning_badges: fixture.reasoningBadges as unknown as Prisma.InputJsonArray,
      },
    })
  }).filter((promise): promise is ReturnType<typeof prisma.outfitRecommendation.upsert> =>
    Boolean(promise)
  )

  await Promise.all(outfitPromises)

  const paletteInsights = await prisma.paletteInsights.findMany({ take: 5 })
  // Storage credentials are resolved once, up front, so a misconfigured
  // environment fails before any row is written rather than after some of them.
  const storageCredentials = resolveCommunityStorageCredentials()

  const lookbookPlans = paletteInsights
    .map((palette, idx) => {
      const ownerId = palette.user_id
      if (!ownerId) {
        return null
      }
      const postId = `lookbook-${idx + 1}`
      const objectPath = buildSeededCommunityObjectPath(postId)
      // Seeded posts are already published, so they need the publication clock
      // the feed orders by. A published row with a NULL published_at sorts
      // undefined under the `published_at,id` cursor and the database now
      // rejects it outright; either way the seeded feed would be unreachable,
      // which is exactly what the "seeded data makes both positive paths
      // reachable" acceptance criterion is there to catch.
      const publishedAt = new Date(SEEDED_PUBLICATION_EPOCH_MS + idx * 60_000)

      return { palette, ownerId, postId, objectPath, publishedAt, idx }
    })
    .filter((plan): plan is NonNullable<typeof plan> => plan !== null)

  // Objects first, rows second, deliberately.
  //
  // `CommunityService.buildFeedItems` drops any post whose image cannot be
  // signed, so a row written ahead of its object is not a partially-seeded post:
  // it is a post that does not appear in the feed at all, with no error anywhere
  // to say why. Writing the object first means the only failure mode left is a
  // loud one.
  const uploads = await Promise.all(
    lookbookPlans.map((plan) =>
      uploadSeededCommunityObject(plan.postId, plan.objectPath, storageCredentials)
    )
  )

  const lookbookPromises = lookbookPlans.map((plan, planIndex) => {
    const upload = uploads[planIndex]
    const shared = {
      status: 'published',
      image_object_path: plan.objectPath,
      image_content_type: upload?.contentType ?? 'image/png',
      image_byte_size: upload?.byteSize ?? null,
      // The seeded alt text is the confirmed alt text; a published post with an
      // unconfirmed one is the case the story forbids.
      alt_text_confirmed_at: plan.publishedAt,
      submitted_at: plan.publishedAt,
      published_at: plan.publishedAt,
      climate_band: plan.idx % 2 === 0 ? 'temperate_dry' : 'cold_dry',
    } as const

    return prisma.lookbookPost.upsert({
      where: { id: plan.postId },
      update: {
        user: { connect: { id: plan.ownerId } },
        palette_insight: { connect: { id: plan.palette.id } },
        ...shared,
      },
      create: {
        id: plan.postId,
        user_id: plan.ownerId,
        palette_insight_id: plan.palette.id,
        caption: `Look ${plan.idx + 1} — weather-ready layers`,
        alt_text: `Look ${plan.idx + 1} styled outfit for seasonal weather`,
        locale: 'en-US',
        ...shared,
      },
    })
  }) as Promise<unknown>[]

  await Promise.all(lookbookPromises)

  const engagementPosts = await prisma.lookbookPost.findMany({ take: 3 })
  for (const [idx, post] of engagementPosts.entries()) {
    const user = teens[idx % teens.length]
    if (!user) {
      continue
    }
    await prisma.engagementEvent.upsert({
      where: { id: `engagement-${idx + 1}` },
      update: {
        event_type: 'applaud',
        post: { connect: { id: post.id } },
        user: { connect: { id: user.id } },
      },
      create: {
        id: `engagement-${idx + 1}`,
        user_id: user.id,
        post_id: post.id,
        event_type: 'applaud',
      },
    })
  }

  /*
   * Insert-only, unlike every other write in this file.
   *
   * `AuditLog` is append-only at the database level: the
   * `20260420160000_harden_audit_log_immutability` migration installs BEFORE
   * UPDATE, DELETE, and TRUNCATE triggers that raise SQLSTATE 42501. An
   * `upsert` therefore succeeds exactly once and fails on every later run,
   * because its conflict branch is an UPDATE against a table that forbids one.
   * That made `db:seed` non-repeatable, which only showed up once something ran
   * it against an already-seeded database.
   *
   * `createMany` with `skipDuplicates` compiles to INSERT ... ON CONFLICT DO
   * NOTHING, which never issues an UPDATE, so the seed is re-runnable and the
   * immutability guarantee stays intact.
   */
  await prisma.auditLog.createMany({
    data: teens.map((user, idx) => ({
      id: `audit-${idx + 1}`,
      user_id: user.id,
      event_type: 'seed_ran',
      event_data: { seed: 'prisma', iteration: idx + 1 },
      ip_address: `10.0.0.${idx + 10}`,
    })),
    skipDuplicates: true,
  })
}
