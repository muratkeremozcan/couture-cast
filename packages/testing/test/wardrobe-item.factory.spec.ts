// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  buildGarmentObjectPath,
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
      object_path: item.objectPath,
      image_url: item.imageUrl,
      category: item.category,
      material: item.material,
      comfort_range: item.comfortRange,
      color_palette: item.colorPalette,
      upload_status: 'ready',
      retention_status: 'active',
      user: {
        connect: {
          id: 'user-123',
        },
      },
    })
  })

  it('derives the storage path from the fixture owner when none is supplied', () => {
    /*
     * Storage RLS keys on the object-path prefix, so a garment created for an
     * explicit owner has to land under that owner's prefix. The default path
     * used to be built from the factory's own random id/userId before the
     * overrides merged, so this returned a path under an unrelated user until
     * composeWardrobeItemFixture started deriving it after the merge.
     */
    const item = createWardrobeItem({ id: 'garment-1', userId: 'user-123' })

    expect(item.objectPath).toBe(buildGarmentObjectPath('user-123', 'garment-1', 'png'))
    expect(buildWardrobeItemCreateInput(item).object_path).toBe(
      buildGarmentObjectPath('user-123', 'garment-1', 'png')
    )
  })

  it('keeps an explicitly supplied storage path', () => {
    // Callers pinning a specific path (a legacy or migrated object) must win
    // over the derived default.
    const item = createWardrobeItem({
      id: 'garment-2',
      userId: 'user-123',
      objectPath: 'users/user-123/garments/legacy.jpg',
    })

    expect(item.objectPath).toBe('users/user-123/garments/legacy.jpg')
  })

  describe('persistence', () => {
    afterEach(() => {
      resetTrackedEntities()
    })

    it('persists a garment and registers it for cleanup', async () => {
      // Garment rows hold an object path in storage; an unregistered row leaves
      // an orphaned upload behind as well as a database record.
      const create =
        vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>()
      create.mockResolvedValue({ id: 'garment-persisted' })
      const prisma = { garmentItem: { create } } as unknown as PrismaClient

      const persisted = await createWardrobeItem(
        { id: 'garment-persisted', userId: 'user-123' },
        { persist: true, prisma }
      )

      expect(persisted).toEqual({ id: 'garment-persisted' })
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        data: { id: 'garment-persisted' },
      })
      expect(getTrackedEntityIds('wardrobeItems')).toEqual(['garment-persisted'])
    })
  })
})
