// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import type { PrismaClient } from '@prisma/client'
import { GARMENT_TAGGING_ANALYSIS_VERSION } from '@couture/api-client'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WardrobeColorProcessor } from './wardrobe-color.processor'
import type { GarmentTaggingEngine } from './garment-tagging.engine'
import { ManualGarmentTaggingEngine } from './manual-garment-tagging.engine'
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
    // The row lock the deferral takes before it classifies the garment.
    $queryRaw: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient

  const mockStorage = {
    download: mockDownload,
  } as unknown as WardrobeStorage

  const processor = new WardrobeColorProcessor(mockPrisma, mockStorage)

  beforeEach(() => {
    vi.clearAllMocks()
    // A test's standing answer for the garment read never reaches the next test.
    mockFindUnique.mockReset()
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
        upload_status: 'processing',
      }) as unknown as Record<string, unknown>,
      data: expect.objectContaining({
        upload_status: 'awaiting_tags',
        tagging_model_version: GARMENT_TAGGING_ANALYSIS_VERSION,
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

  it('records manual mode, with no suggestions and no logged error, when the engine is manual', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_manual',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_manual.png',
      retention_status: 'active',
      upload_status: 'processing',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)

    const manualProcessor = new WardrobeColorProcessor(
      mockPrisma,
      mockStorage,
      new ManualGarmentTaggingEngine()
    )
    const logger = (
      manualProcessor as unknown as {
        logger: { error: () => void; warn: () => void; info: () => void }
      }
    ).logger
    const errorLog = vi.spyOn(logger, 'error')
    const warnLog = vi.spyOn(logger, 'warn')
    const infoLog = vi.spyOn(logger, 'info')

    await manualProcessor.process('g_manual')

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'g_manual' }) as unknown as Record<
        string,
        unknown
      >,
      data: expect.objectContaining({
        upload_status: 'awaiting_tags',
        tag_suggested_at: null,
        tagging_model_version: null,
        tagging_failure_code: 'TAGGING_MANUAL_MODE',
      }) as unknown as Record<string, unknown>,
    })
    expect(errorLog).not.toHaveBeenCalled()
    expect(warnLog).not.toHaveBeenCalled()
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'manual_mode', applied: true }),
      'Wardrobe processing completed'
    )
  })

  it('reuses a persisted inference checkpoint after a queue retry', async () => {
    const tagSnapshot = createGarmentTagSuggestionSnapshotFixture()
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_retry',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_retry.png',
      retention_status: 'active',
      upload_status: 'processing',
      tag_suggestions: tagSnapshot,
      tagging_failure_code: null,
    })
    const mockTaggingEngine = {
      inferTags: vi.fn(),
    }
    const processorWithTagging = new WardrobeColorProcessor(
      mockPrisma,
      mockStorage,
      mockTaggingEngine as unknown as GarmentTaggingEngine
    )

    await processorWithTagging.process('g_retry')

    expect(mockTaggingEngine.inferTags).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledOnce()
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'g_retry',
        upload_status: 'processing',
      }) as unknown as Record<string, unknown>,
      data: expect.objectContaining({
        upload_status: 'awaiting_tags',
        tagging_model_version: GARMENT_TAGGING_ANALYSIS_VERSION,
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
    // The guarded transition misses; the locked re-read finds the garment already advanced.
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_duplicate',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_duplicate.png',
      retention_status: 'active',
      upload_status: 'awaiting_tags',
    })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })

    await processor.process('g_duplicate')

    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockDownload).toHaveBeenCalledOnce()
  })

  /**
   * Review round 1, 2026-11-19: the path column was member-writable before the revoke
   * migration, so the service role must never read an object that is not the member's own.
   */
  it('fails a garment whose path names another member object without reading it', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'g_foreign',
      user_id: 'user_1',
      object_path: 'wardrobe/user_2/g_other.png',
      retention_status: 'active',
      upload_status: 'processing',
    } as unknown as Awaited<ReturnType<typeof mockPrisma.garmentItem.findUnique>>)

    await processor.process('g_foreign')

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g_foreign', upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  })

  /**
   * Learning path Step 58, round 6 (Codex C5-7): the worker declines a garment under legal hold
   * and leaves its image alone, but the job completes and its id stays retained, so the marker
   * it leaves set made the garment unrecoverable after release. It now records the deferral and
   * clears the marker, guarded on the hold, so the maintenance handoff can enqueue it again.
   * See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
   */
  const DEFER_FOR_HOLD = {
    where: { id: 'g_held', upload_status: 'processing', retention_status: 'legal_hold' },
    data: {
      processing_job_enqueued_at: null,
      processing_deferred_at: expect.any(Date) as Date,
    },
  }

  it('defers a processing garment under legal hold without reading its image', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'g_held',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_held.png',
      retention_status: 'legal_hold',
      upload_status: 'processing',
    })

    await processor.process('g_held')

    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith(DEFER_FOR_HOLD)
  })

  it('defers a garment whose hold landed while it was being processed', async () => {
    const garment = {
      id: 'g_held',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_held.png',
      upload_status: 'processing',
    }
    mockFindUnique
      .mockResolvedValueOnce({ ...garment, retention_status: 'active' })
      .mockResolvedValueOnce({ ...garment, retention_status: 'legal_hold' })
    // The checkpoint lands; the final transition finds the row no longer active.
    mockUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

    await processor.process('g_held')

    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockUpdateMany).toHaveBeenLastCalledWith(DEFER_FOR_HOLD)
  })

  /**
   * Final review F-7: the job read the garment held, and the operator released the hold before
   * the deferral ran. The deferral classifies under the row lock, sees the release, and the job
   * processes the garment, so it is never left processing with its marker set and no job.
   */
  it('processes a garment whose hold was released between its read and the deferral', async () => {
    const garment = {
      id: 'g_released',
      user_id: 'user_1',
      object_path: 'wardrobe/user_1/g_released.png',
      upload_status: 'processing',
    }
    mockFindUnique
      .mockResolvedValueOnce({ ...garment, retention_status: 'legal_hold' })
      .mockResolvedValue({ ...garment, retention_status: 'active' })

    await processor.process('g_released')

    expect(mockDownload).toHaveBeenCalledExactlyOnceWith('wardrobe/user_1/g_released.png')
    const deferrals = mockUpdateMany.mock.calls.filter(
      ([args]) =>
        (args as { data: object }).data &&
        'processing_deferred_at' in (args as { data: object }).data
    )
    expect(deferrals).toEqual([])
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'g_released',
        user_id: 'user_1',
        object_path: 'wardrobe/user_1/g_released.png',
        retention_status: 'active',
        upload_status: 'processing',
      },
      data: expect.objectContaining({ upload_status: 'awaiting_tags' }) as object,
    })
    expect(mockUpsert).toHaveBeenCalledOnce()
  })

  it('marks processing garment as failed', async () => {
    await processor.markFailed('g_fail')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g_fail', upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  })
})
