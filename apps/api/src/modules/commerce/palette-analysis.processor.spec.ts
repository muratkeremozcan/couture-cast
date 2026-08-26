// Story 5.4 Task 6: palette analysis processor, mirroring
// silhouette-photo.processor.spec.ts's mocking shape.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaletteAnalysisProcessor } from './palette-analysis.processor.js'
import type { PaletteAnalysisEngine } from './palette-analysis.engine.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'

describe('PaletteAnalysisProcessor', () => {
  const mockFindUnique = vi.fn()
  const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockPaletteInsightsFindMany = vi.fn().mockResolvedValue([])
  const mockDownload = vi.fn()
  const mockRemove = vi.fn().mockResolvedValue(undefined)
  const mockAnalyzeSelfie = vi.fn()
  const mockCaptureEvent = vi.fn().mockResolvedValue(undefined)

  const mockPrisma = {
    paletteProfile: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
    paletteInsights: {
      findMany: mockPaletteInsightsFindMany,
    },
  } as unknown as PrismaClient

  const mockStorage = {
    download: mockDownload,
    remove: mockRemove,
  } as unknown as WardrobeStorage

  const mockEngine = {
    analyzeSelfie: mockAnalyzeSelfie,
  } as unknown as PaletteAnalysisEngine

  const mockTelemetry = {
    captureEvent: mockCaptureEvent,
  } as unknown as TelemetryService

  const processor = new PaletteAnalysisProcessor(
    mockPrisma,
    mockStorage,
    mockEngine,
    mockTelemetry
  )

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockPaletteInsightsFindMany.mockResolvedValue([])
    mockCaptureEvent.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
  })

  describe('process: guard', () => {
    it('5.4-UNIT-001 skips a profile that does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null)
      await processor.process('missing')
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })

    it('skips a profile that is not currently processing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'ready',
        source: 'wardrobe',
      })
      await processor.process('p1')
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('wardrobe source', () => {
    it('5.4-API-021 classifies a seeded wardrobe deterministically, depth null', async () => {
      // The wardrobe seed's fixed hex (packages/db/prisma/seeds/wardrobe.ts):
      // #C9A14A classifies to undertone 'olive' at high confidence under this
      // story's hue-band thresholds (see packages/utils/src/skin-tone.ts).
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 25 }, () => ({ hex_codes: ['#C9A14A'] }))
      )

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: expect.objectContaining({
          status: 'ready',
          failure_reason: null,
          undertone: 'olive',
          depth: null,
          analysis_version: 'palette-advisor-v1',
        }),
      })
      expect(mockCaptureEvent).toHaveBeenCalledWith('u1', 'palette_analysis_completed', {
        source: 'wardrobe',
        undertone: 'olive',
        depth: null,
        outcome: 'ready',
      })
      // No selfie object for a wardrobe-sourced profile: no purge attempted.
      expect(mockRemove).not.toHaveBeenCalled()
    })

    it('5.4-API-022 fails insufficient_wardrobe below the MIN_WARDROBE_SAMPLES floor', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce([
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
      ])

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    it('5.4-API-023 discards achromatic-only rows (including the #808080 extraction-failure fallback) and fails insufficient_wardrobe', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, () => ({ hex_codes: ['#808080'] }))
      )

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    it('skips a row whose hex_codes is not a parseable string array', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce([
        { hex_codes: null },
        { hex_codes: 'not-an-array' },
        { hex_codes: [] },
        // Ten survivors, not five: five clear MIN_WARDROBE_SAMPLES but score
        // 5/15 = 0.33 on the confidence floor below, so a five-row fixture
        // would prove the parse guard by way of the wrong terminal state.
        ...Array.from({ length: 10 }, () => ({ hex_codes: ['#C9A14A'] })),
      ])

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ready' }) })
      )
    })

    /**
     * 5.4-API-024. Decision 3's confidence floor applies to the wardrobe source
     * too: a palette this weakly evidenced is not published as fact about the
     * user's body. It terminates `insufficient_wardrobe` rather than
     * `low_quality`, because the `low_quality` copy is photo-specific in all ten
     * catalogs and this caller never uploaded a photo.
     */
    it('5.4-API-024 refuses a wardrobe palette below the confidence floor', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      // Six chromatic survivors, deliberately spread across the whole hue
      // circle: the count factor is 6/15 = 0.4 and the hue spread drives the
      // tightness term well below 1, so the product lands under 0.4.
      mockPaletteInsightsFindMany.mockResolvedValueOnce([
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#1F4E79'] },
        { hex_codes: ['#0D6F62'] },
        { hex_codes: ['#B3123C'] },
        { hex_codes: ['#7A2AC0'] },
        { hex_codes: ['#2ECC71'] },
      ])

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    /** The same six-sample count passes once the colours agree. */
    it('5.4-API-025 accepts a small wardrobe whose colours agree', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 6 }, () => ({ hex_codes: ['#C9A14A'] }))
      )

      await processor.process('p1')

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ready' }) })
      )
    })
  })

  describe('selfie source: ready', () => {
    it('5.4-API-034 downloads, classifies, commits ready, purges, and emits telemetry -- in that order', async () => {
      const callOrder: string[] = []
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
      })
      mockDownload.mockImplementationOnce(() => {
        callOrder.push('download')
        return Promise.resolve(Buffer.from('selfie-bytes'))
      })
      mockAnalyzeSelfie.mockResolvedValueOnce({
        outcome: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
      })
      mockUpdateMany.mockImplementationOnce(() => {
        callOrder.push('status-commit')
        return Promise.resolve({ count: 1 })
      })
      mockRemove.mockImplementationOnce(() => {
        callOrder.push('purge')
        return Promise.resolve()
      })
      mockUpdateMany.mockImplementationOnce(() => {
        callOrder.push('purge-stamp')
        return Promise.resolve({ count: 1 })
      })
      mockCaptureEvent.mockImplementationOnce(() => {
        callOrder.push('telemetry')
        return Promise.resolve()
      })

      await processor.process('p1')

      expect(mockDownload).toHaveBeenCalledWith('wardrobe/u1/palette/s1.jpg')
      expect(mockUpdateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'p1', status: 'processing' },
        data: {
          status: 'ready',
          failure_reason: null,
          undertone: 'warm',
          depth: 'medium',
          confidence: 0.82,
          analysis_version: 'palette-advisor-v1',
          analyzed_at: expect.any(Date),
        },
      })
      expect(mockRemove).toHaveBeenCalledWith(['wardrobe/u1/palette/s1.jpg'])
      // Status commit strictly before the purge (Decision 8).
      expect(callOrder.indexOf('status-commit')).toBeLessThan(callOrder.indexOf('purge'))
      expect(mockUpdateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'p1' },
        data: { selfie_purged_at: expect.any(Date) },
      })
      expect(mockCaptureEvent).toHaveBeenCalledWith('u1', 'palette_analysis_completed', {
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        outcome: 'ready',
      })
    })
  })

  describe('selfie source: failure reasons', () => {
    it.each(['no_face', 'low_quality', 'privacy_violation'] as const)(
      '5.4-API-033 classifies the engine outcome %s as a terminal failure, and purges',
      async (outcome) => {
        mockFindUnique.mockResolvedValueOnce({
          id: 'p1',
          user_id: 'u1',
          status: 'processing',
          source: 'selfie',
          selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
        })
        mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
        mockAnalyzeSelfie.mockResolvedValueOnce({ outcome })

        await processor.process('p1')

        expect(mockUpdateMany).toHaveBeenCalledWith({
          where: { id: 'p1', status: 'processing' },
          data: { status: 'failed', failure_reason: outcome },
        })
        expect(mockRemove).toHaveBeenCalledWith(['wardrobe/u1/palette/s1.jpg'])
        expect(mockCaptureEvent).toHaveBeenCalledWith(
          'u1',
          'palette_analysis_completed',
          {
            source: 'selfie',
            undertone: null,
            depth: null,
            outcome,
          }
        )
      }
    )

    it('fails storage_error immediately when the row has no selfie_object_path, without downloading', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: null,
      })

      await processor.process('p1')

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: { status: 'failed', failure_reason: 'storage_error' },
      })
    })

    it('propagates a genuine download fault uncaught, so BullMQ retries', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
      })
      const downloadError = new Error('storage unavailable')
      mockDownload.mockRejectedValueOnce(downloadError)

      await expect(processor.process('p1')).rejects.toBe(downloadError)
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('purge is best-effort', () => {
    it('5.4-API-035 leaves selfie_purged_at unset when storage removal fails, and does not throw', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
      })
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      mockRemove.mockRejectedValueOnce(new Error('storage down'))

      await expect(processor.process('p1')).resolves.toBeUndefined()

      // Status commit happened, but the purge-stamp updateMany (the second
      // call) never runs because storage.remove threw first.
      expect(mockUpdateMany).toHaveBeenCalledTimes(1)
      expect(mockCaptureEvent).toHaveBeenCalled()
    })

    it('does not stamp selfie_purged_at when the row has already moved on (no update applied)', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
      })
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      // First updateMany (status commit) reports no row matched.
      mockUpdateMany.mockResolvedValueOnce({ count: 0 })

      await processor.process('p1')

      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })
  })

  describe('markFailed: the third terminal door', () => {
    it('5.4-API-036 marks failed, purges, and emits telemetry for a retry-exhaustion timeout', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'selfie',
        selfie_object_path: 'wardrobe/u1/palette/s1.jpg',
      })

      await processor.markFailed('p1', 'timeout')

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'processing' },
        data: { status: 'failed', failure_reason: 'timeout' },
      })
      expect(mockRemove).toHaveBeenCalledWith(['wardrobe/u1/palette/s1.jpg'])
      expect(mockCaptureEvent).toHaveBeenCalledWith('u1', 'palette_analysis_completed', {
        source: 'selfie',
        undertone: null,
        depth: null,
        outcome: 'timeout',
      })
    })

    it('markFailed is a no-op for a profile no longer processing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'ready',
        source: 'selfie',
        selfie_object_path: null,
      })

      await processor.markFailed('p1', 'storage_error')

      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('telemetry fail-open', () => {
    it('does not throw when telemetry emission fails', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'processing',
        source: 'wardrobe',
        selfie_object_path: null,
      })
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 25 }, () => ({ hex_codes: ['#C9A14A'] }))
      )
      mockCaptureEvent.mockRejectedValueOnce(new Error('posthog down'))

      await expect(processor.process('p1')).resolves.toBeUndefined()
    })
  })
})
