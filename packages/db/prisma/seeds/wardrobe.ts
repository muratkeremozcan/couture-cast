import type { PrismaClient } from '@prisma/client'

export type SeededGarment = { id: string; userId: string }

export async function seedWardrobe(
  prisma: PrismaClient,
  teens: { id: string; email: string }[]
): Promise<SeededGarment[]> {
  const garments: SeededGarment[] = []

  const categories = [
    'jacket',
    'coat',
    'hoodie',
    'dress',
    'jeans',
    'sneakers',
    'boots',
    'scarf',
    'hat',
    'gloves',
  ]
  const materials = ['cotton', 'wool', 'cashmere', 'denim', 'nylon', 'merino']
  const comfortRanges = ['cold', 'cool', 'mild', 'warm', 'hot']

  for (const teen of teens) {
    for (let i = 0; i < 10; i++) {
      if (!teen.id) {
        continue
      }
      const id = `${teen.id}-garment-${i + 1}`
      const category = categories[(i + garments.length) % categories.length] ?? 'category'
      const material = materials[(i + 2) % materials.length] ?? 'material'
      const comfort = comfortRanges[(i + 3) % comfortRanges.length] ?? 'comfort'
      const palette = [
        '#111111',
        '#C9A14A',
        '#7E889A',
        '#B1683A',
        '#0D6F62',
        '#F29BA8',
        '#8C5331',
        '#1F4E79',
      ].slice(0, 3)

      await prisma.garmentItem.upsert({
        where: { id },
        update: {
          category,
          material,
          comfort_range: comfort,
          color_palette: palette,
          image_url: `https://picsum.photos/seed/${id}/640/640`,
        },
        create: {
          id,
          user_id: teen.id!,
          category,
          material,
          comfort_range: comfort,
          color_palette: palette,
          image_url: `https://picsum.photos/seed/${id}/640/640`,
        },
      })

      garments.push({ id, userId: teen.id! })
    }
  }

  const paletteTargets = garments.slice(0, 25)
  for (const [idx, garment] of paletteTargets.entries()) {
    const insightId = `${garment.id}-palette`
    if (!garment.userId) {
      continue
    }
    await prisma.paletteInsights.upsert({
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
    })
  }

  return garments
}
