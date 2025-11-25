import { PrismaClient } from '@prisma/client'

import type { SeededGarment } from './wardrobe'
import type { SeededWeather } from './weather'

export async function seedRituals(
  prisma: PrismaClient,
  teens: { id: string; email: string }[],
  garments: SeededGarment[],
  weather: SeededWeather
): Promise<void> {
  const segmentPool = weather.segmentIds

  for (let i = 0; i < 20; i++) {
    const user = teens[i % teens.length]
    const segmentId = segmentPool[i % segmentPool.length]
    const garmentSliceStart = (i * 2) % garments.length
    const garmentSelection = garments.slice(garmentSliceStart, garmentSliceStart + 3)
    const garmentIds = garmentSelection.map((g) => g.id)

    await prisma.outfitRecommendation.upsert({
      where: { id: `outfit-${i + 1}` },
      update: {
        scenario: i % 3 === 0 ? 'morning' : i % 3 === 1 ? 'midday' : 'evening',
        garment_ids: garmentIds,
        reasoning_badges: [{ label: 'layered' }, { label: 'weather-aware' }],
        forecast_segment: segmentId ? { connect: { id: segmentId } } : undefined,
        user: { connect: { id: user.id } },
      },
      create: {
        id: `outfit-${i + 1}`,
        user_id: user.id,
        forecast_segment_id: segmentId,
        scenario: i % 3 === 0 ? 'morning' : i % 3 === 1 ? 'midday' : 'evening',
        garment_ids: garmentIds,
        reasoning_badges: [{ label: 'layered' }, { label: 'weather-aware' }],
      },
    })
  }

  const paletteInsights = await prisma.paletteInsights.findMany({ take: 5 })
  for (const [idx, palette] of paletteInsights.entries()) {
    const ownerId = palette.user_id
    await prisma.lookbookPost.upsert({
      where: { id: `lookbook-${idx + 1}` },
      update: {
        user: { connect: { id: ownerId } },
        palette_insight: { connect: { id: palette.id } },
        image_urls: [`https://picsum.photos/seed/lookbook-${idx + 1}/800/600`],
        climate_band: idx % 2 === 0 ? 'temperate' : 'cold',
      },
      create: {
        id: `lookbook-${idx + 1}`,
        user_id: ownerId,
        palette_insight_id: palette.id,
        image_urls: [`https://picsum.photos/seed/lookbook-${idx + 1}/800/600`],
        caption: `Look ${idx + 1} — weather-ready layers`,
        locale: 'en-US',
        climate_band: idx % 2 === 0 ? 'temperate' : 'cold',
      },
    })
  }

  const engagementPosts = await prisma.lookbookPost.findMany({ take: 3 })
  for (const [idx, post] of engagementPosts.entries()) {
    const user = teens[idx % teens.length]
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

  for (const [idx, user] of teens.entries()) {
    await prisma.auditLog.upsert({
      where: { id: `audit-${idx + 1}` },
      update: {
        event_type: 'seed_ran',
        event_data: { seed: 'prisma', iteration: idx + 1 },
        ip_address: `10.0.0.${idx + 10}`,
      },
      create: {
        id: `audit-${idx + 1}`,
        user_id: user.id,
        event_type: 'seed_ran',
        event_data: { seed: 'prisma', iteration: idx + 1 },
        ip_address: `10.0.0.${idx + 10}`,
      },
    })
  }
}
