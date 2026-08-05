import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuardianService } from '../guardian/guardian.service'
import type { RitualService } from '../personalization/ritual.service'
import type { TelemetryService } from '../telemetry/telemetry.service'
import { WardrobeService } from './wardrobe.service'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import type { WardrobeProcessingQueue } from './wardrobe-processing.queue'

describe('WardrobeService Smart Tagging Operations', () => {
  const fixedNow = new Date('2026-08-05T12:00:00.000Z')
  const mockFindFirst = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpdateMany = vi.fn()
  const mockFindUniqueOrThrow = vi.fn()
  const mockSignReadUrl = vi.fn()
  const mockTransaction = vi.fn()

  const mockPrisma = {
    garmentItem: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      findUniqueOrThrow: mockFindUniqueOrThrow,
    },
    $transaction: mockTransaction,
  } as unknown as PrismaClient

  const mockCaptureEvent = vi.fn()
  const mockInvalidateUserCache = vi.fn()
  const mockAssertWardrobeUploadAllowed = vi.fn()

  const mockTelemetryService = {
    captureEvent: mockCaptureEvent,
  } as unknown as TelemetryService

  const mockGuardianService = {
    assertWardrobeUploadAllowed: mockAssertWardrobeUploadAllowed,
  } as unknown as GuardianService

  const mockStorage = {
    signReadUrl: mockSignReadUrl,
  } as unknown as SupabaseWardrobeStorageAdapter

  const mockProcessingQueue = {} as unknown as WardrobeProcessingQueue

  const mockRitualService = {
    invalidateUserCache: mockInvalidateUserCache,
  } as unknown as RitualService

  const service = new WardrobeService(
    mockPrisma,
    mockTelemetryService,
    mockGuardianService,
    mockStorage,
    mockProcessingQueue,
    mockRitualService
  )

  beforeEach(() => {
    mockFindFirst.mockReset()
    mockUpdate.mockReset()
    mockUpdateMany.mockReset()
    mockFindUniqueOrThrow.mockReset()
    mockSignReadUrl.mockReset().mockResolvedValue('https://example.com/read.png')
    mockCaptureEvent.mockReset().mockResolvedValue(undefined)
    mockInvalidateUserCache.mockReset().mockResolvedValue(undefined)
    mockAssertWardrobeUploadAllowed.mockReset().mockResolvedValue(undefined)
    mockTransaction
      .mockReset()
      .mockImplementation(
        async (callback: (tx: PrismaClient) => Promise<unknown>) =>
          await callback(mockPrisma as unknown as PrismaClient)
      )
  })

  it('throws NotFoundException for absent or cross-owner garment on suggestGarmentTags', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    await expect(
      service.suggestGarmentTags('user_1', 'teen', 'garment_missing')
    ).rejects.toThrow(NotFoundException)
  })

  it('throws ConflictException when suggesting tags for garment in processing status', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'g_1',
      user_id: 'user_1',
      upload_status: 'processing',
      retention_status: 'active',
    })
    await expect(service.suggestGarmentTags('user_1', 'teen', 'g_1')).rejects.toThrow(
      ConflictException
    )
  })

  it('throws ServiceUnavailableException when tag suggestions are missing or invalid', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'g_1',
      user_id: 'user_1',
      upload_status: 'awaiting_tags',
      retention_status: 'active',
      tag_suggestions: null,
    })
    await expect(service.suggestGarmentTags('user_1', 'teen', 'g_1')).rejects.toThrow(
      ServiceUnavailableException
    )
  })

  it('returns structured suggestions when valid snapshot exists', async () => {
    const validSnapshot = createGarmentTagSuggestionSnapshotFixture({
      category: { confidence: 0.88 },
    })
    mockFindFirst.mockResolvedValueOnce({
      id: 'g_1',
      user_id: 'user_1',
      upload_status: 'awaiting_tags',
      retention_status: 'active',
      tag_suggestions: validSnapshot,
    })

    const res = await service.suggestGarmentTags('user_1', 'teen', 'g_1')
    expect(res.data.analysisVersion).toBe(validSnapshot.analysisVersion)
    expect(res.data.suggestions.category.value).toBe('top')
  })

  it('returns current response without DB write when ready garment receives identical update', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'g_ready',
      user_id: 'user_1',
      upload_status: 'ready',
      retention_status: 'active',
      category: 'top',
      material: 'cotton',
      comfort_range: 'mild',
      object_path: 'wardrobe/user_1/g_ready.png',
      file_size_bytes: 1024,
      tagging_telemetry_emitted_at: null,
      created_at: fixedNow,
    })

    const res = await service.updateGarmentTags('user_1', 'teen', 'g_ready', {
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
    })

    expect(res.data.status).toBe('ready')
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockCaptureEvent).not.toHaveBeenCalled()
  })

  it('updates awaiting_tags garment to ready, emits telemetry, and invalidates cache', async () => {
    const validSnapshot = createGarmentTagSuggestionSnapshotFixture({
      category: { confidence: 0.88 },
    })

    mockFindFirst.mockResolvedValueOnce({
      id: 'g_awaiting',
      user_id: 'user_1',
      upload_status: 'awaiting_tags',
      retention_status: 'active',
      tag_suggestions: validSnapshot,
      category: null,
      material: null,
      comfort_range: null,
      object_path: 'wardrobe/user_1/g_awaiting.png',
      file_size_bytes: 2048,
      tagging_telemetry_emitted_at: null,
      created_at: fixedNow,
    })

    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    mockFindUniqueOrThrow.mockResolvedValueOnce({
      id: 'g_awaiting',
      user_id: 'user_1',
      upload_status: 'ready',
      retention_status: 'active',
      category: 'top',
      material: 'silk', // overridden
      comfort_range: 'warm', // overridden
      tags_confirmed_at: fixedNow,
      object_path: 'wardrobe/user_1/g_awaiting.png',
      file_size_bytes: 2048,
      created_at: fixedNow,
    })

    const res = await service.updateGarmentTags('user_1', 'teen', 'g_awaiting', {
      category: 'top',
      material: 'silk',
      comfortRange: 'warm',
    })

    expect(res.data.status).toBe('ready')
    expect(res.data.category).toBe('top')
    expect(res.data.material).toBe('silk')

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'g_awaiting',
          user_id: 'user_1',
          upload_status: 'awaiting_tags',
        }) as unknown,
        data: expect.objectContaining({
          upload_status: 'ready',
          tagging_telemetry_emitted_at: expect.any(Date) as unknown,
        }) as unknown,
      })
    )

    expect(mockCaptureEvent).toHaveBeenCalledWith(
      'user_1',
      'garment_tagging_completed',
      expect.objectContaining({
        garmentId: 'g_awaiting',
        wasOverridden: true,
        overrideFields: ['material', 'comfort_range'],
      })
    )
    expect(mockInvalidateUserCache).toHaveBeenCalledWith('user_1')
  })
})
