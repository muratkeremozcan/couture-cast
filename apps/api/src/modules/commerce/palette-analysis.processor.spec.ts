// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 5.4 Task 6: palette analysis processor, mirroring
// silhouette-photo.processor.spec.ts's mocking shape.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID,
  PaletteAnalysisProcessor,
} from './palette-analysis.processor.js'
import { WardrobeObjectDeletionOutbox } from '../wardrobe/wardrobe-object-deletion.outbox.js'
import type { PaletteAnalysisEngine } from './palette-analysis.engine.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'

/** Session A: the attempt a job was enqueued for. */
const SESSION_A = '0f1e2d3c-4b5a-4697-8877-665544332211'
/** Session B: the replacement the member committed while A's job was still running. */
const SESSION_B = 'a1b2c3d4-e5f6-4708-9a1b-2c3d4e5f6a7b'
const SELFIE_A = `wardrobe/u1/palette/${SESSION_A}.jpg`
const SELFIE_B = `wardrobe/u1/palette/${SESSION_B}.jpg`

/** A wardrobe analysis's own attempt id (round 4): its job id is `p1__<attempt>`. */
const WARDROBE_ATTEMPT = '5d4c3b2a-1f0e-4d9c-8b7a-695847362514'
/** A fixed clock for the outbox rows the drain reads; nothing here reads the wall clock. */
const DUE = new Date('2026-11-19T12:00:00.000Z')

/**
 * A selfie attempt in processing; only the columns the processor reads. Since round 4 a profile
 * records the analysis it is processing, which for a selfie is its upload session.
 */
function selfieRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    status: 'processing',
    source: 'selfie',
    analysis_attempt_id: SESSION_A,
    selfie_upload_session_id: SESSION_A,
    selfie_object_path: SELFIE_A,
    ...overrides,
  }
}

/** A wardrobe analysis in processing, under its own attempt. */
function wardrobeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    status: 'processing',
    source: 'wardrobe',
    analysis_attempt_id: WARDROBE_ATTEMPT,
    selfie_upload_session_id: null,
    selfie_object_path: null,
    ...overrides,
  }
}

/**
 * The fence every terminal write of a selfie attempt carries (Codex round 2, C2-7; round 4 adds
 * the analysis attempt).
 */
const SELFIE_A_GUARD = {
  id: 'p1',
  status: 'processing',
  source: 'selfie',
  analysis_attempt_id: SESSION_A,
  selfie_upload_session_id: SESSION_A,
}
/** A wardrobe analysis carries no selfie session; its fence holds the row's (null) one. */
const WARDROBE_GUARD = {
  id: 'p1',
  status: 'processing',
  source: 'wardrobe',
  analysis_attempt_id: WARDROBE_ATTEMPT,
  selfie_upload_session_id: null,
}

/** The outbox row the purge left for `objectPath`, due at {@link DUE}. */
function deletionRow(objectPath: string) {
  return {
    id: 'deletion-1',
    object_path: objectPath,
    reason: 'selfie_purged',
    not_before: new Date('2026-11-19T11:00:00.000Z'),
    attempts: 0,
    last_error: null,
  }
}

describe('PaletteAnalysisProcessor', () => {
  const mockFindUnique = vi.fn()
  /**
   * The terminal write runs inside the transaction (round 4, Codex C3-2), so it is a member of
   * `tx` only; the client outside a transaction has its own `updateMany`, which must stay
   * unused by the terminal write.
   */
  const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const mockOuterProfileUpdateMany = vi.fn()
  const mockPaletteInsightsFindMany = vi.fn().mockResolvedValue([])
  const mockDownload = vi.fn()
  const mockRemove = vi.fn().mockResolvedValue(undefined)
  const mockAnalyzeSelfie = vi.fn()
  const mockCaptureEvent = vi.fn().mockResolvedValue(undefined)
  /** The outbox row written in the terminal transaction (the selfie's purge obligation). */
  const mockDeletionCreateMany = vi.fn()
  /** The outbox row the removal settles, read and deleted under its lock. */
  const mockDeletionFindUnique = vi.fn()
  const mockDeletionDelete = vi.fn()
  /** A failed removal pushes its row back outside any transaction. */
  const mockDeletionUpdateMany = vi.fn()
  const mockDeletionFindMany = vi.fn()
  /** The outbox's authoritative read of the profile while it judges the selfie key. */
  const mockJudgeProfile = vi.fn()
  const mockQueryRaw = vi.fn()
  const mockTransaction = vi.fn()

  const tx = {
    paletteProfile: { updateMany: mockUpdateMany, findUnique: mockJudgeProfile },
    wardrobeObjectDeletion: {
      createMany: mockDeletionCreateMany,
      findUnique: mockDeletionFindUnique,
      delete: mockDeletionDelete,
      update: vi.fn(),
    },
    $queryRaw: mockQueryRaw,
  }

  const mockPrisma = {
    paletteProfile: {
      findUnique: mockFindUnique,
      updateMany: mockOuterProfileUpdateMany,
    },
    wardrobeObjectDeletion: {
      updateMany: mockDeletionUpdateMany,
      findMany: mockDeletionFindMany,
    },
    paletteInsights: {
      findMany: mockPaletteInsightsFindMany,
    },
    $transaction: mockTransaction,
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
    mockDeletionCreateMany.mockResolvedValue({ count: 1 })
    mockDeletionFindUnique.mockResolvedValue(deletionRow(SELFIE_A))
    mockDeletionDelete.mockResolvedValue(deletionRow(SELFIE_A))
    mockDeletionUpdateMany.mockResolvedValue({ count: 1 })
    mockDeletionFindMany.mockResolvedValue([])
    // The profile once the terminal write landed: no longer holding a live selfie.
    mockJudgeProfile.mockResolvedValue(selfieRow({ status: 'failed' }))
    mockQueryRaw.mockResolvedValue([])
    mockTransaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx)
    )
  })

  describe('process: guard', () => {
    it('5.4-UNIT-001 skips a profile that does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null)
      await processor.process('missing', SESSION_A)
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })

    it('skips a profile that is not currently processing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'p1',
        user_id: 'u1',
        status: 'ready',
        source: 'wardrobe',
      })
      await processor.process('p1', SESSION_A)
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('wardrobe source', () => {
    it('5.4-API-021 classifies a seeded wardrobe deterministically, depth null', async () => {
      // The wardrobe seed's fixed hex (packages/db/prisma/seeds/wardrobe.ts):
      // #C9A14A classifies to undertone 'olive' at high confidence under this
      // story's hue-band thresholds (see packages/utils/src/skin-tone.ts).
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 25 }, () => ({ hex_codes: ['#C9A14A'] }))
      )

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: WARDROBE_GUARD,
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
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce([
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
        { hex_codes: ['#C9A14A'] },
      ])

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: WARDROBE_GUARD,
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    it('5.4-API-023 discards achromatic-only rows (including the #808080 extraction-failure fallback) and fails insufficient_wardrobe', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, () => ({ hex_codes: ['#808080'] }))
      )

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: WARDROBE_GUARD,
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    it('skips a row whose hex_codes is not a parseable string array', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce([
        { hex_codes: null },
        { hex_codes: 'not-an-array' },
        { hex_codes: [] },
        // Ten survivors, not five: five clear MIN_WARDROBE_SAMPLES but score
        // 5/15 = 0.33 on the confidence floor below, so a five-row fixture
        // would prove the parse guard by way of the wrong terminal state.
        ...Array.from({ length: 10 }, () => ({ hex_codes: ['#C9A14A'] })),
      ])

      await processor.process('p1', WARDROBE_ATTEMPT)

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
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
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

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: WARDROBE_GUARD,
        data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
      })
    })

    /**
     * 5.4-API-026. The confidence term reads hue agreement, and a hue angle is
     * a point on a circle. These six garment colours agree to within about 20
     * degrees, but they straddle CIELAB's 0/360 wrap -- magentas and fuchsias
     * sit just below 360, reds, corals and pinks just above 0 -- so a linear
     * interquartile range read them as roughly 350 degrees apart and refused
     * the wardrobe with `insufficient_wardrobe`. `hueAngleInterquartileSpread`
     * measures the deviation from the sample's mean direction instead, so a
     * wardrobe that agrees is accepted whatever arc it happens to sit on.
     */
    it('5.4-API-026 accepts a wardrobe whose agreeing colours straddle the 0/360 hue wrap', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      // Eight magentas/fuchsias (CIELAB hue 348-356) and seven reds/pinks
      // (hue 10-12), all well clear of ACHROMATIC_CHROMA_MAX. Fifteen samples
      // saturate the count factor at 1, so the hue term alone decides:
      // circularly the interquartile spread is 22.2 degrees and confidence is
      // 0.75; read linearly it was 341.2 degrees and confidence was exactly 0,
      // which is the refusal this test exists to keep gone.
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        [
          '#C71585',
          '#D6218F',
          '#B3126F',
          '#FF1493',
          '#C71585',
          '#D6218F',
          '#B3126F',
          '#FF1493',
          '#C21E56',
          '#D42A5E',
          '#B01A4C',
          '#E91E63',
          '#C21E56',
          '#D42A5E',
          '#B01A4C',
        ].map((hex) => ({ hex_codes: [hex] }))
      )

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: WARDROBE_GUARD,
        data: expect.objectContaining({
          status: 'ready',
          undertone: 'cool',
          depth: null,
        }),
      })
    })

    /** The same six-sample count passes once the colours agree. */
    it('5.4-API-025 accepts a small wardrobe whose colours agree', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 6 }, () => ({ hex_codes: ['#C9A14A'] }))
      )

      await processor.process('p1', WARDROBE_ATTEMPT)

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ready' }) })
      )
    })
  })

  describe('selfie source: a path that is not the member own', () => {
    // Review round 1, 2026-11-19: never read an object that is not the member's own selfie.
    it('fails storage_error without reading or purging another member object', async () => {
      mockFindUnique.mockResolvedValueOnce(
        selfieRow({ selfie_object_path: `wardrobe/u2/palette/${SESSION_A}.jpg` })
      )
      mockUpdateMany.mockResolvedValueOnce({ count: 1 })

      await processor.process('p1', SESSION_A)

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockAnalyzeSelfie).not.toHaveBeenCalled()
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: SELFIE_A_GUARD,
        data: { status: 'failed', failure_reason: 'storage_error' },
      })
      expect(mockRemove).not.toHaveBeenCalled()
    })
  })

  describe('selfie source: ready', () => {
    it('5.4-API-034 downloads, classifies, commits ready with the purge owed in one transaction, removes, and emits telemetry -- in that order', async () => {
      const callOrder: string[] = []
      mockFindUnique.mockResolvedValueOnce(selfieRow())
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
      mockTransaction.mockImplementationOnce(
        async (work: (client: typeof tx) => Promise<unknown>) => {
          callOrder.push('terminal-transaction-begin')
          const result = await work(tx)
          callOrder.push('terminal-transaction-commit')
          return result
        }
      )
      mockUpdateMany.mockImplementationOnce(() => {
        callOrder.push('status-commit')
        return Promise.resolve({ count: 1 })
      })
      mockDeletionCreateMany.mockImplementationOnce(() => {
        callOrder.push('purge-recorded')
        return Promise.resolve({ count: 1 })
      })
      mockRemove.mockImplementationOnce(() => {
        callOrder.push('purge')
        return Promise.resolve()
      })
      mockCaptureEvent.mockImplementationOnce(() => {
        callOrder.push('telemetry')
        return Promise.resolve()
      })

      await processor.process('p1', SESSION_A)

      expect(mockDownload).toHaveBeenCalledWith(SELFIE_A)
      // Round 4 (Codex C3-2): `selfie_purged_at` is set by the guarded terminal write itself.
      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: {
          status: 'ready',
          failure_reason: null,
          undertone: 'warm',
          depth: 'medium',
          confidence: 0.82,
          analysis_version: 'palette-advisor-v1',
          analyzed_at: expect.any(Date),
          selfie_purged_at: expect.any(Date),
        },
      })
      expect(mockOuterProfileUpdateMany).not.toHaveBeenCalled()
      // The obligation is written on the terminal transaction's client.
      expect(mockDeletionCreateMany).toHaveBeenCalledExactlyOnceWith({
        data: [{ object_path: SELFIE_A, reason: 'selfie_purged' }],
        skipDuplicates: true,
      })
      expect(mockRemove).toHaveBeenCalledExactlyOnceWith([SELFIE_A])
      expect(mockDeletionDelete).toHaveBeenCalledWith({ where: { id: 'deletion-1' } })
      expect(callOrder).toEqual([
        'download',
        'terminal-transaction-begin',
        'status-commit',
        'purge-recorded',
        'terminal-transaction-commit',
        'purge',
        'telemetry',
      ])
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
        mockFindUnique.mockResolvedValueOnce(selfieRow())
        mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
        mockAnalyzeSelfie.mockResolvedValueOnce({ outcome })

        await processor.process('p1', SESSION_A)

        expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
          where: SELFIE_A_GUARD,
          data: {
            status: 'failed',
            failure_reason: outcome,
            selfie_purged_at: expect.any(Date),
          },
        })
        expect(mockDeletionCreateMany).toHaveBeenCalledExactlyOnceWith({
          data: [{ object_path: SELFIE_A, reason: 'selfie_purged' }],
          skipDuplicates: true,
        })
        expect(mockRemove).toHaveBeenCalledWith([SELFIE_A])
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

    /**
     * 5.4-API-036. The upload route already decoded these bytes through
     * `verifyGarmentImage`, so this covers the narrower window between that
     * decode and this one: an object read back truncated or corrupted, or a
     * codec path `.metadata()` accepts and `.resize().raw()` does not. Narrow,
     * but deterministic: letting the throw propagate would retry an input
     * that can never succeed until the BullMQ budget is exhausted and then
     * terminate through `markFailed` as `timeout`, telling the user the service
     * was slow when their photo was unreadable. It terminates here instead, and
     * purges, because a selfie that cannot be analysed still must not be kept.
     */
    it('5.4-API-036 terminates low_quality and purges when the engine cannot decode the bytes', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('not-an-image'))
      mockAnalyzeSelfie.mockRejectedValueOnce(
        new Error('Input buffer contains unsupported image format')
      )

      await expect(processor.process('p1', SESSION_A)).resolves.toBeUndefined()

      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: {
          status: 'failed',
          failure_reason: 'low_quality',
          selfie_purged_at: expect.any(Date),
        },
      })
      expect(mockRemove).toHaveBeenCalledWith([SELFIE_A])
      expect(mockCaptureEvent).toHaveBeenCalledWith('u1', 'palette_analysis_completed', {
        source: 'selfie',
        undertone: null,
        depth: null,
        outcome: 'low_quality',
      })
    })

    /**
     * 5.4-API-037. The DOWNLOAD keeps the opposite posture, deliberately: a
     * storage fault is transient, so it propagates and BullMQ's existing
     * retry/backoff engages, exactly as `silhouette-photo.processor.ts` does.
     * Catching both at one level would turn a recoverable outage into a
     * permanent `low_quality` verdict on a photo that was never read.
     */
    it('5.4-API-037 lets a storage download failure propagate for BullMQ to retry', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockRejectedValueOnce(new Error('storage unavailable'))

      await expect(processor.process('p1', SESSION_A)).rejects.toThrow(
        'storage unavailable'
      )

      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
    })

    it('fails storage_error immediately when the row has no selfie_object_path, without downloading', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow({ selfie_object_path: null }))

      await processor.process('p1', SESSION_A)

      expect(mockDownload).not.toHaveBeenCalled()
      // Nothing to purge, so no stamp and no outbox row.
      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: { status: 'failed', failure_reason: 'storage_error' },
      })
      expect(mockDeletionCreateMany).not.toHaveBeenCalled()
    })

    it('propagates a genuine download fault uncaught, so BullMQ retries', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      const downloadError = new Error('storage unavailable')
      mockDownload.mockRejectedValueOnce(downloadError)

      await expect(processor.process('p1', SESSION_A)).rejects.toBe(downloadError)
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })

  /**
   * Round 4 (Codex C3-2): the selfie's deletion obligation is written in the same transaction as
   * the guarded terminal update. Round 3 recorded it after the update, outside any transaction,
   * and swallowed an outbox failure, so a worker that stopped in between, or an outbox insert
   * that failed, left a terminal profile whose readable selfie nothing would ever remove.
   */
  describe('purge is durable', () => {
    it('5.4-API-035 keeps a failed removal recorded for the hourly retry, and does not throw', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      mockRemove.mockRejectedValueOnce(new Error('storage down'))

      await expect(processor.process('p1', SESSION_A)).resolves.toBeUndefined()

      expect(mockDeletionCreateMany).toHaveBeenCalledOnce()
      expect(mockDeletionDelete).not.toHaveBeenCalled()
      expect(mockDeletionUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: { object_path: SELFIE_A },
        data: {
          attempts: { increment: 1 },
          last_error: 'Error',
          not_before: expect.any(Date),
        },
      })
      expect(mockUpdateMany).toHaveBeenCalledOnce()
      expect(mockCaptureEvent).toHaveBeenCalled()
    })

    it('fails the job and leaves the profile processing when the outbox insert fails', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      const outboxDown = new Error('outbox insert failed')
      mockDeletionCreateMany.mockRejectedValueOnce(outboxDown)

      // The error leaves the transaction, so the terminal update rolls back with it and BullMQ
      // retries a profile that is still processing.
      await expect(processor.process('p1', SESSION_A)).rejects.toBe(outboxDown)

      expect(mockTransaction).toHaveBeenCalledOnce()
      expect(mockUpdateMany).toHaveBeenCalledOnce()
      expect(mockOuterProfileUpdateMany).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })

    it('leaves the obligation for the hourly drain when the worker stops after the terminal transaction', async () => {
      // First run: the terminal transaction commits, then the removal never completes (the
      // process stops mid-removal; storage never acknowledges it).
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      mockRemove.mockRejectedValueOnce(new Error('worker stopped'))
      await processor.process('p1', SESSION_A)
      expect(mockDeletionCreateMany).toHaveBeenCalledOnce()
      expect(mockDeletionDelete).not.toHaveBeenCalled()

      // BullMQ's retry finds the profile terminal and returns early: no second removal.
      mockFindUnique.mockResolvedValueOnce(selfieRow({ status: 'failed' }))
      await processor.process('p1', SESSION_A)
      expect(mockRemove).toHaveBeenCalledOnce()

      // The hourly maintenance drain still owes it, and removes it.
      mockDeletionFindMany.mockResolvedValueOnce([deletionRow(SELFIE_A)])
      const drained = await new WardrobeObjectDeletionOutbox(
        mockPrisma,
        mockStorage
      ).drainDue(DUE)

      expect(drained).toBe(1)
      expect(mockRemove).toHaveBeenCalledTimes(2)
      expect(mockRemove).toHaveBeenLastCalledWith([SELFIE_A])
      expect(mockDeletionDelete).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'deletion-1' },
      })
    })

    it('does not purge when the row has already moved on (no update applied)', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })
      // The guarded terminal update matched nothing.
      mockUpdateMany.mockResolvedValueOnce({ count: 0 })

      await processor.process('p1', SESSION_A)

      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockDeletionCreateMany).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })
  })

  /**
   * Review round 2 (Codex C2-7), round 4 (Codex C3-6): a job carries its own analysis attempt in
   * its deterministic job id. Worker A can finish, or start, after the member replaced the
   * selfie or started another analysis on the same one-row profile. A must write nothing to that
   * attempt: no result, no failure, no purge and no purge stamp, including on retry exhaustion.
   */
  describe('an older attempt never touches a newer one', () => {
    it('skips a job enqueued for session A once the profile carries session B', async () => {
      mockFindUnique.mockResolvedValueOnce(
        selfieRow({
          analysis_attempt_id: SESSION_B,
          selfie_upload_session_id: SESSION_B,
          selfie_object_path: SELFIE_B,
        })
      )

      await processor.process('p1', SESSION_A)

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })

    it('skips a selfie job once the profile is processing a wardrobe analysis', async () => {
      mockFindUnique.mockResolvedValueOnce(
        wardrobeRow({ selfie_upload_session_id: SESSION_A })
      )

      await processor.process('p1', SESSION_A)

      expect(mockPaletteInsightsFindMany).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('skips a job whose job id names no attempt', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())

      await processor.process('p1', null)

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('applies nothing when B replaced A while A was being analysed', async () => {
      // A's job read A; B committed before A's result was written, so A's fenced write misses.
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({
        outcome: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
      })
      mockUpdateMany.mockResolvedValueOnce({ count: 0 })

      await processor.process('p1', SESSION_A)

      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: expect.objectContaining({ status: 'ready' }),
      })
      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockDeletionCreateMany).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })

    it('matches a selfie analysis started before attempts were recorded on its session', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow({ analysis_attempt_id: null }))
      mockDownload.mockResolvedValueOnce(Buffer.from('selfie-bytes'))
      mockAnalyzeSelfie.mockResolvedValueOnce({ outcome: 'no_face' })

      await processor.process('p1', SESSION_A)

      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: { ...SELFIE_A_GUARD, analysis_attempt_id: null },
        data: {
          status: 'failed',
          failure_reason: 'no_face',
          selfie_purged_at: expect.any(Date),
        },
      })
    })

    it('skips a legacy selfie job whose session is not the one the profile holds', async () => {
      mockFindUnique.mockResolvedValueOnce(
        selfieRow({
          analysis_attempt_id: null,
          selfie_upload_session_id: SESSION_B,
          selfie_object_path: SELFIE_B,
        })
      )

      await processor.process('p1', SESSION_A)

      expect(mockDownload).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    /**
     * Round 5 (Codex C4-7): the migration gives every wardrobe analysis already processing at
     * deploy the known legacy attempt, and only a job for that attempt may finish it. A stale
     * wardrobe job for the same profile, enqueued under its own random correlation id, exits
     * without writing; the hourly handoff enqueues the legacy attempt's own job.
     */
    it('skips a stale wardrobe job on an upgraded profile that holds the legacy attempt', async () => {
      mockFindUnique.mockResolvedValueOnce(
        wardrobeRow({ analysis_attempt_id: LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID })
      )

      await processor.process('p1', 'legacy-correlation-id')

      expect(mockPaletteInsightsFindMany).not.toHaveBeenCalled()
      expect(mockUpdateMany).not.toHaveBeenCalled()
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it.each([
      ['the legacy attempt', LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID],
      ['no attempt at all', null],
    ])(
      'lets a job naming %s finish the upgraded wardrobe analysis',
      async (_label, attemptId) => {
        mockFindUnique.mockResolvedValueOnce(
          wardrobeRow({ analysis_attempt_id: LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID })
        )
        mockPaletteInsightsFindMany.mockResolvedValueOnce([])

        await processor.process('p1', attemptId)

        expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
          where: {
            ...WARDROBE_GUARD,
            analysis_attempt_id: LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID,
          },
          data: { status: 'failed', failure_reason: 'insufficient_wardrobe' },
        })
      }
    )

    it('lets no job finish a wardrobe analysis that records no attempt', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow({ analysis_attempt_id: null }))

      await processor.process('p1', 'legacy-correlation-id')

      expect(mockPaletteInsightsFindMany).not.toHaveBeenCalled()
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })

    it('does not fail, purge or stamp B when A exhausts its retries', async () => {
      mockFindUnique.mockResolvedValueOnce(
        selfieRow({
          analysis_attempt_id: SESSION_B,
          selfie_upload_session_id: SESSION_B,
          selfie_object_path: SELFIE_B,
        })
      )

      await processor.markFailed('p1', 'timeout', SESSION_A)

      expect(mockTransaction).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockCaptureEvent).not.toHaveBeenCalled()
    })

    it('fails nothing on retry exhaustion of a job whose job id names no attempt', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())

      await processor.markFailed('p1', 'storage_error', null)

      expect(mockTransaction).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
    })

    it('fences retry exhaustion on the attempt it matched', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())
      mockUpdateMany.mockResolvedValueOnce({ count: 0 })

      await processor.markFailed('p1', 'storage_error', SESSION_A)

      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: {
          status: 'failed',
          failure_reason: 'storage_error',
          selfie_purged_at: expect.any(Date),
        },
      })
      expect(mockDeletionCreateMany).not.toHaveBeenCalled()
      expect(mockRemove).not.toHaveBeenCalled()
    })
  })

  /**
   * Review round 1, 2026-11-19 (Codex 1): before the revoke migration a member could write the
   * selfie path column. The purge removes only the member's own selfie; a path naming anything
   * else is skipped and logged, and the row keeps no purge stamp it did not earn.
   */
  describe('purge removes only the member own selfie', () => {
    it.each([
      ['another member', `wardrobe/u2/palette/${SESSION_A}.jpg`],
      ['a garment', `wardrobe/u1/${SESSION_A}.jpg`],
      ['a staging key', `staging/u1/palette/${SESSION_A}.jpg`],
      // Review round 2 (Codex C2-2): the exact object id must be this row's session.
      ['a sibling selfie of the same member', SELFIE_B],
    ])('never removes a selfie path naming %s', async (_, objectPath) => {
      mockFindUnique.mockResolvedValueOnce(selfieRow({ selfie_object_path: objectPath }))

      await processor.process('p1', SESSION_A)

      // Review round 2: the analysis refuses the path too, so it is never even read.
      expect(mockDownload).not.toHaveBeenCalled()
      // No `selfie_purged_at` stamp and no outbox row follow a skipped purge.
      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: { status: 'failed', failure_reason: 'storage_error' },
      })
      expect(mockRemove).not.toHaveBeenCalled()
      expect(mockDeletionCreateMany).not.toHaveBeenCalled()
    })
  })

  describe('markFailed: the third terminal door', () => {
    it('5.4-API-036 marks failed, purges, and emits telemetry for a retry-exhaustion timeout', async () => {
      mockFindUnique.mockResolvedValueOnce(selfieRow())

      await processor.markFailed('p1', 'timeout', SESSION_A)

      expect(mockUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: SELFIE_A_GUARD,
        data: {
          status: 'failed',
          failure_reason: 'timeout',
          selfie_purged_at: expect.any(Date),
        },
      })
      expect(mockDeletionCreateMany).toHaveBeenCalledExactlyOnceWith({
        data: [{ object_path: SELFIE_A, reason: 'selfie_purged' }],
        skipDuplicates: true,
      })
      expect(mockRemove).toHaveBeenCalledWith([SELFIE_A])
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

      await processor.markFailed('p1', 'storage_error', SESSION_A)

      expect(mockTransaction).not.toHaveBeenCalled()
    })
  })

  describe('telemetry fail-open', () => {
    it('does not throw when telemetry emission fails', async () => {
      mockFindUnique.mockResolvedValueOnce(wardrobeRow())
      mockPaletteInsightsFindMany.mockResolvedValueOnce(
        Array.from({ length: 25 }, () => ({ hex_codes: ['#C9A14A'] }))
      )
      mockCaptureEvent.mockRejectedValueOnce(new Error('posthog down'))

      await expect(processor.process('p1', WARDROBE_ATTEMPT)).resolves.toBeUndefined()
    })
  })
})
