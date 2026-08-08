import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import type { RitualService } from '../personalization/ritual.service'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { createMockPrisma } from '../../testing/prisma-mock'

function garment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'garment-1',
    user_id: 'user-1',
    object_path: 'wardrobe/user-1/garment-1.png',
    retention_status: 'active',
    retention_trigger: null,
    deletion_requested_at: null,
    retention_purged_at: null,
    upload_status: 'ready',
    ...overrides,
  }
}

describe('WardrobeRetentionService', () => {
  /** Aliases onto the shared Prisma double so assertions stay readable. */
  type PrismaMock = ReturnType<typeof createMockPrisma>
  type DelegateFn = PrismaMock['garmentItem']['findFirst']

  let findFirst: DelegateFn
  let findMany: DelegateFn
  let updateMany: DelegateFn
  let garmentUpdate: DelegateFn
  let paletteDeleteMany: DelegateFn
  let auditCreate: DelegateFn
  let storageRemove: Mock
  let invalidateUserCache: Mock
  let service: WardrobeRetentionService
  let prisma: PrismaMock

  beforeEach(() => {
    prisma = createMockPrisma()
    storageRemove = vi.fn().mockResolvedValue(undefined)
    invalidateUserCache = vi.fn().mockResolvedValue(true)

    findFirst = prisma.garmentItem.findFirst
    findMany = prisma.garmentItem.findMany
    updateMany = prisma.garmentItem.updateMany
    garmentUpdate = prisma.garmentItem.update
    paletteDeleteMany = prisma.paletteInsights.deleteMany
    auditCreate = prisma.auditLog.create

    updateMany.mockResolvedValue({ count: 1 })
    paletteDeleteMany.mockResolvedValue({ count: 1 })

    service = new WardrobeRetentionService(
      prisma.asPrismaClient(),
      { remove: storageRemove } as unknown as SupabaseWardrobeStorageAdapter,
      { invalidateUserCache } as unknown as RitualService
    )
  })

  it('purges source and derived data after a user deletion request', async () => {
    findFirst.mockResolvedValue(garment())

    await service.requestDeletion('user-1', 'garment-1')

    expect(storageRemove).toHaveBeenCalledWith(['wardrobe/user-1/garment-1.png'])
    expect(invalidateUserCache).toHaveBeenCalledWith('user-1')
    expect(paletteDeleteMany).toHaveBeenCalledWith({
      where: { garment_item_id: 'garment-1' },
    })
    const updateCall = garmentUpdate.mock.calls[0]?.[0] as
      | { data: Record<string, unknown>; where: { id: string } }
      | undefined
    expect(updateCall?.where).toEqual({ id: 'garment-1' })
    expect(updateCall?.data.object_path).toBeNull()
    expect(updateCall?.data.upload_status).toBe('failed')

    const auditCall = auditCreate.mock.calls[0]?.[0] as
      | {
          data: {
            event_data: Record<string, unknown>
            event_type: string
            user_id: string
          }
        }
      | undefined
    expect(auditCall?.data.user_id).toBe('user-1')
    expect(auditCall?.data.event_type).toBe('garment_retention_purged')
    expect(auditCall?.data.event_data).not.toHaveProperty('objectPath')
    expect(auditCall?.data.event_data).not.toHaveProperty('imageUrl')
  })

  it('preserves source and metadata under legal hold', async () => {
    findFirst.mockResolvedValue(garment({ retention_status: 'legal_hold' }))

    await service.requestDeletion('user-1', 'garment-1')

    expect(updateMany).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
    expect(garmentUpdate).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
    expect(invalidateUserCache).not.toHaveBeenCalled()
  })

  it('claims expired pending uploads for idempotent scheduled cleanup', async () => {
    findMany.mockResolvedValue([garment({ retention_trigger: 'abandoned_upload' })])

    await service.purgeExpiredAndDeletedGarments()

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'garment-1',
          retention_status: { not: 'legal_hold' },
        },
      })
    )
    expect(storageRemove).toHaveBeenCalledOnce()
    expect(invalidateUserCache).toHaveBeenCalledWith('user-1')
  })
})
