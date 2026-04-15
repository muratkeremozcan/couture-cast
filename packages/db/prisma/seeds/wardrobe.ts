import type { PrismaClient } from '@prisma/client'
import * as wardrobeFactories from '../../../testing/src/factories/wardrobe-item.factory.ts'

import { unwrapCjsNamespace } from './interop.js'

const {
  WARDROBE_CATEGORIES,
  WARDROBE_COMFORT_RANGES,
  WARDROBE_MATERIALS,
  createWardrobeItem,
} = unwrapCjsNamespace(wardrobeFactories)

export type SeededGarment = { id: string; userId: string }

const seededPaletteCycle = [
  ['#111111', '#C9A14A', '#7E889A'],
  ['#0D6F62', '#F29BA8', '#8C5331'],
  ['#1F4E79', '#C9A14A', '#F29BA8'],
  ['#111111', '#0D6F62', '#1F4E79'],
] as const

export async function seedWardrobeItems(
  prisma: PrismaClient,
  teens: { id: string; email: string }[]
): Promise<SeededGarment[]> {
  const garments: SeededGarment[] = []
  const garmentUpserts: Promise<unknown>[] = []

  for (const teen of teens) {
    for (let i = 0; i < 10; i++) {
      if (!teen.id) {
        continue
      }

      const id = `${teen.id}-garment-${i + 1}`
      const category =
        WARDROBE_CATEGORIES[(i + garments.length) % WARDROBE_CATEGORIES.length] ?? 'top'
      const material = WARDROBE_MATERIALS[(i + 2) % WARDROBE_MATERIALS.length] ?? 'cotton'
      const comfort =
        WARDROBE_COMFORT_RANGES[(i + 3) % WARDROBE_COMFORT_RANGES.length] ?? 'mild'
      const palette =
        seededPaletteCycle[(i + garments.length) % seededPaletteCycle.length] ??
        seededPaletteCycle[0]
      const fixture = createWardrobeItem({
        id,
        userId: teen.id,
        category,
        material,
        comfortRange: comfort,
        colorPalette: [...palette],
        imageUrl: `https://picsum.photos/seed/${id}/640/640`,
      })

      garments.push({ id, userId: teen.id })
      garmentUpserts.push(
        prisma.garmentItem.upsert({
          where: { id },
          update: {
            category: fixture.category,
            material: fixture.material,
            comfort_range: fixture.comfortRange,
            color_palette: fixture.colorPalette,
            image_url: fixture.imageUrl,
          },
          create: {
            id: fixture.id,
            user_id: fixture.userId,
            category: fixture.category,
            material: fixture.material,
            comfort_range: fixture.comfortRange,
            color_palette: fixture.colorPalette,
            image_url: fixture.imageUrl,
          },
        })
      )
    }
  }

  await Promise.all(garmentUpserts)

  const paletteTargets = garments.slice(0, 25)
  const palettePromises = paletteTargets.flatMap((garment, idx) => {
    if (!garment.userId) {
      return [] as const
    }
    const insightId = `${garment.id}-palette`
    return [
      prisma.paletteInsights.upsert({
        where: { garment_item_id: garment.id },
        update: {
          undertone: idx % 2 === 0 ? 'cool' : 'warm',
          hex_codes: ['#C9A14A', '#0D6F62', '#1F4E79'],
          confidence_score: 0.68 + idx * 0.01,
          user: { connect: { id: garment.userId } },
        },
        create: {
          id: insightId,
          garment_item_id: garment.id,
          user_id: garment.userId,
          undertone: idx % 2 === 0 ? 'cool' : 'warm',
          hex_codes: ['#C9A14A', '#0D6F62', '#1F4E79'],
          confidence_score: 0.68 + idx * 0.01,
        },
      }),
    ]
  })

  await Promise.all(palettePromises)

  return garments
}

export const seedWardrobe = seedWardrobeItems
