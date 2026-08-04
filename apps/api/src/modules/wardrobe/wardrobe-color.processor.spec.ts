import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { WardrobeColorProcessor } from './wardrobe-color.processor'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

describe('WardrobeColorProcessor', () => {
  const mockFindUnique = vi.fn()
  const mockUpdate = vi.fn()
  const mockUpdateMany = vi.fn()
  const mockUpsert = vi.fn()
  const mockTransaction = vi.fn().mockImplementation((arr: unknown[]) => Promise.all(arr))
  const mockDownload = vi.fn().mockResolvedValue(Buffer.from('sample-image-bytes'))

  const mockPrisma = {
    garmentItem: {
      findUnique: mockFindUnique,
      update: mockUpdate,
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

  it('processes processing garment and updates color palette and insights', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_processing',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_processing.png',
      retention_status: 'active',
      upload_status: 'processing',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)

    await processor.process('g_processing')
    expect(mockDownload).toHaveBeenCalledWith('wardrobe/user_1/g_processing.png')
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it('marks processing garment as failed', async () => {
    await processor.markFailed('g_fail')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g_fail', upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  })
})
