// Story 7.5 test plan 7.5-UNIT-015..016: WardrobeService adds colorFamily only when asked, from
// the stored dominant color, and keeps the ownership and guardian checks on the opted-in path.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuardianService } from '../guardian/guardian.service'
import type { RitualService } from '../personalization/ritual.service'
import type { TelemetryService } from '../telemetry/telemetry.service'
import { garmentColorFamily, WardrobeService } from './wardrobe.service'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import type { WardrobeProcessingQueue } from './wardrobe-processing.queue'

const createdAt = new Date('2026-08-05T10:00:00.000Z')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g_ready',
    user_id: 'user_1',
    upload_status: 'ready',
    retention_status: 'active',
    category: 'top',
    material: 'cotton',
    comfort_range: 'mild',
    object_path: 'wardrobe/user_1/g_ready.png',
    mime_type: 'image/png',
    file_size_bytes: 1024,
    tagging_telemetry_emitted_at: null,
    tags_confirmed_at: createdAt,
    committed_at: createdAt,
    created_at: createdAt,
    color_palette: { dominant: '#1e3cc8' },
    ...overrides,
  }
}

describe('garmentColorFamily', () => {
  it.each([
    [{ dominant: '#1e3cc8' }, 'blue'],
    [{ dominant: 'C81E1E' }, 'red'],
    [null, null],
    [{}, null],
    [[], null],
    ['#1e3cc8', null],
    [{ dominant: null }, null],
    [{ dominant: 30 }, null],
    [{ dominant: '#abc' }, null],
  ] as const)(
    '[P1] [7.5-UNIT-016] reads color_palette %j as %j',
    (colorPalette, expected) => {
      expect(garmentColorFamily({ color_palette: colorPalette as never })).toBe(expected)
    }
  )
})

describe('WardrobeService opt-in colorFamily', () => {
  const findMany = vi.fn()
  const findFirst = vi.fn()
  const updateMany = vi.fn()
  const transaction = vi.fn()
  const assertWardrobeUploadAllowed = vi.fn()
  const prisma = {
    garmentItem: { findMany, findFirst, updateMany },
    $transaction: transaction,
  } as unknown as PrismaClient

  const service = new WardrobeService(
    prisma,
    { captureEvent: vi.fn().mockResolvedValue(undefined) } as unknown as TelemetryService,
    { assertWardrobeUploadAllowed } as unknown as GuardianService,
    {
      signReadUrl: vi.fn().mockResolvedValue('https://example.com/read.png'),
    } as unknown as SupabaseWardrobeStorageAdapter,
    {} as unknown as WardrobeProcessingQueue,
    { invalidateUserCache: vi.fn().mockResolvedValue(true) } as unknown as RitualService
  )
  const tags = { category: 'top', material: 'cotton', comfortRange: 'mild' } as const

  beforeEach(() => {
    findMany.mockReset()
    findFirst.mockReset()
    updateMany.mockReset()
    assertWardrobeUploadAllowed.mockReset().mockResolvedValue(undefined)
    transaction
      .mockReset()
      .mockImplementation(async (callback: (tx: PrismaClient) => Promise<unknown>) =>
        callback(prisma)
      )
  })

  it('[P1] [7.5-UNIT-016] lists each garment with its own colorFamily only when asked', async () => {
    findMany.mockResolvedValue([
      row(),
      row({
        id: 'g_plain',
        object_path: 'wardrobe/user_1/g_plain.png',
        color_palette: null,
      }),
    ])

    const legacy = await service.listGarments('user_1')
    expect(legacy.data).toHaveLength(2)
    for (const garment of legacy.data) expect(garment).not.toHaveProperty('colorFamily')

    const opted = await service.listGarments('user_1', { includeColor: true })
    expect(opted.data.map(({ id, colorFamily }) => ({ id, colorFamily }))).toEqual([
      { id: 'g_ready', colorFamily: 'blue' },
      { id: 'g_plain', colorFamily: null },
    ])
  })

  it('[P1] [7.5-UNIT-016] returns colorFamily on a tag update only when asked', async () => {
    findFirst.mockResolvedValue(row())

    const legacy = await service.updateGarmentTags('user_1', 'teen', 'g_ready', tags)
    expect(legacy.data).not.toHaveProperty('colorFamily')

    const opted = await service.updateGarmentTags('user_1', 'teen', 'g_ready', tags, {
      includeColor: true,
    })
    expect(opted.data).toMatchObject({
      id: 'g_ready',
      category: 'top',
      colorFamily: 'blue',
    })
  })

  it('[P0] [7.5-UNIT-015] refuses another member garment on the opted-in path, writing nothing', async () => {
    findFirst.mockResolvedValue(null)

    await expect(
      service.updateGarmentTags('user_2', 'guardian', 'g_ready', tags, {
        includeColor: true,
      })
    ).rejects.toThrow(NotFoundException)
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'g_ready', user_id: 'user_2' },
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('[P0] [7.5-UNIT-015] keeps the guardian check first on the opted-in path', async () => {
    assertWardrobeUploadAllowed.mockRejectedValue(
      new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
    )

    await expect(
      service.updateGarmentTags('user_1', 'teen', 'g_ready', tags, { includeColor: true })
    ).rejects.toThrow(ForbiddenException)
    expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith('user_1', 'teen')
    expect(findFirst).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })
})
