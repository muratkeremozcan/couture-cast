import type { PrismaClient } from '@prisma/client'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WardrobeColorProcessor } from './wardrobe-color.processor'
import type { GarmentTaggingEngine } from './garment-tagging.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

describe('WardrobeColorProcessor', () => {
  const mockFindUnique = vi.fn()
  const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockUpsert = vi.fn()
  const mockTransaction = vi
    .fn()
    .mockImplementation((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(mockPrisma as unknown as PrismaClient)
    )
  const mockDownload = vi.fn().mockResolvedValue(Buffer.from('sample-image-bytes'))

  const mockPrisma = {
    garmentItem: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
    paletteInsights: {
      upsert: mockUpsert,
    },
    $transaction: mockTransaction,
  } as unknown as PrismaClient

  const mockStorage = {
    download: mockDownload,
  } as unknown as WardrobeStorage

  const processor = new WardrobeColorProcessor(mockPrisma, mockStorage)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('skips non-active or non-processing garments', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await processor.process('g_missing')
    expect(mockDownload).not.toHaveBeenCalled()

    mockFindUnique.mockResolvedValueOnce({
      id: 'g_ready',
      object_path: 'path/to/img.png',
      retention_status: 'active',
      upload_status: 'ready',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)
    await processor.process('g_ready')
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('processes processing garment and updates status to awaiting_tags with tag suggestions', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_processing',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_processing.png',
      retention_status: 'active',
      upload_status: 'processing',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)

    const mockTaggingEngine = {
      inferTags: vi.fn().mockResolvedValue(
        createGarmentTagSuggestionSnapshotFixture({
          material: { confidence: 0.7 },
          comfortRange: { confidence: 0.7 },
        })
      ),
    }

    const processorWithTagging = new WardrobeColorProcessor(
      mockPrisma,
      mockStorage,
      mockTaggingEngine as unknown as GarmentTaggingEngine
    )

    await processorWithTagging.process('g_processing')
    expect(mockDownload).toHaveBeenCalledWith('wardrobe/user_1/g_processing.png')
    expect(mockTaggingEngine.inferTags).toHaveBeenCalledOnce()
    expect(mockTransaction).toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'g_processing',
        upload_status: { in: ['processing', 'failed'] },
      }) as unknown as Record<string, unknown>,
      data: expect.objectContaining({
        upload_status: 'awaiting_tags',
        tagging_model_version:
          'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1',
      }) as unknown as Record<string, unknown>,
    })
  })

  it('handles recoverable tag inference failure by setting awaiting_tags and tagging_failure_code', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_processing_fail',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_processing_fail.png',
      retention_status: 'active',
      upload_status: 'processing',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)

    const mockFailingTaggingEngine = {
      inferTags: vi.fn().mockRejectedValue(new Error('Inference timeout')),
    }

    const processorWithFailingTagging = new WardrobeColorProcessor(
      mockPrisma,
      mockStorage,
      mockFailingTaggingEngine as unknown as GarmentTaggingEngine
    )

    await processorWithFailingTagging.process('g_processing_fail')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'g_processing_fail',
      }) as unknown as Record<string, unknown>,
      data: expect.objectContaining({
        upload_status: 'awaiting_tags',
        tagging_failure_code: 'TAGGING_INFERENCE_FAILED',
      }) as unknown as Record<string, unknown>,
    })
  })

  it('does not let a late duplicate job overwrite a garment that already advanced', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_duplicate',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_duplicate.png',
      retention_status: 'active',
      upload_status: 'processing',
    })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })

    await processor.process('g_duplicate')

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('marks processing garment as failed', async () => {
    await processor.markFailed('g_fail')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g_fail', upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  })
})
