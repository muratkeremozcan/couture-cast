import { describe, expect, it } from 'vitest'

import {
  buildWardrobeItemCreateInput,
  createWardrobeItem,
  WARDROBE_CATEGORIES,
  WARDROBE_COMFORT_RANGES,
  WARDROBE_MATERIALS,
} from '../src/factories/wardrobe-item.factory.js'

describe('wardrobe item factory', () => {
  it('creates a valid wardrobe fixture and Prisma input', () => {
    const item = createWardrobeItem({
      userId: 'user-123',
    })
    const input = buildWardrobeItemCreateInput(item)

    expect(WARDROBE_CATEGORIES).toContain(item.category)
    expect(WARDROBE_MATERIALS).toContain(item.material)
    expect(WARDROBE_COMFORT_RANGES).toContain(item.comfortRange)
    expect(item.colorPalette.length).toBeGreaterThan(0)
    expect(input).toEqual({
      id: item.id,
      image_url: item.imageUrl,
      category: item.category,
      material: item.material,
      comfort_range: item.comfortRange,
      color_palette: item.colorPalette,
      user: {
        connect: {
          id: 'user-123',
        },
      },
    })
  })
})
