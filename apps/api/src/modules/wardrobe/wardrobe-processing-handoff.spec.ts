// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Round 4 (Codex C3-5): a committed My Form photo or palette analysis could sit in processing
// with no queued job when the function stopped between the claim and the enqueue. Both profiles
// now carry a job handoff marker: commit enqueues under the deterministic job id and sets it, and
// a same-key replay or the hourly maintenance job enqueues again while it is missing.
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PROCESSING_HANDOFF_GRACE_MS,
  garmentProcessingJobId,
  handOffGarmentProcessing,
  handOffMyFormProcessing,
  handOffPaletteAnalysis,
  reenqueueStrandedProcessing,
} from './wardrobe-processing-handoff'
import { LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID } from '../commerce/palette-analysis.processor'

const loggerMocks = vi.hoisted(() => {
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { child }
})

vi.mock('../../logger/pino.config', () => ({
  createBaseLogger: () => ({ child: () => loggerMocks.child }),
}))

const NOW = new Date('2026-11-19T12:00:00.000Z')
const SESSION_A = '3f2e1d0c-9b8a-4776-8554-433221100fed'
const SESSION_B = '4a3b2c1d-0e9f-4887-8665-5443322110fe'
const ATTEMPT = '5b4c3d2e-1f0a-4998-8776-6554433221a0'

function myForm(overrides: Record<string, unknown> = {}) {
  return {
    id: 'silhouette-1',
    my_form_status: 'processing' as const,
    my_form_upload_session_id: SESSION_A,
    my_form_processing_job_enqueued_at: null as Date | null,
    ...overrides,
  }
}

function garment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'garment-1',
    upload_status: 'processing' as const,
    retention_status: 'active' as const,
    processing_job_enqueued_at: null as Date | null,
    processing_deferred_at: null as Date | null,
    ...overrides,
  }
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: 'palette-1',
    status: 'processing' as const,
    analysis_attempt_id: ATTEMPT as string | null,
    processing_job_enqueued_at: null as Date | null,
    ...overrides,
  }
}

describe('processing handoff', () => {
  const silhouetteFindMany = vi.fn()
  const silhouetteUpdateMany = vi.fn()
  const paletteFindMany = vi.fn()
  const paletteUpdateMany = vi.fn()
  const garmentFindMany = vi.fn()
  const garmentUpdateMany = vi.fn()
  const prisma = {
    garmentItem: { findMany: garmentFindMany, updateMany: garmentUpdateMany },
    silhouetteProfile: { findMany: silhouetteFindMany, updateMany: silhouetteUpdateMany },
    paletteProfile: { findMany: paletteFindMany, updateMany: paletteUpdateMany },
  } as unknown as PrismaClient
  const silhouetteEnqueue = vi.fn()
  const paletteEnqueue = vi.fn()
  const garmentEnqueue = vi.fn()
  const publishers = {
    garment: { enqueue: garmentEnqueue },
    silhouette: { enqueue: silhouetteEnqueue },
    palette: { enqueue: paletteEnqueue },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    silhouetteFindMany.mockResolvedValue([])
    paletteFindMany.mockResolvedValue([])
    garmentFindMany.mockResolvedValue([])
    garmentUpdateMany.mockResolvedValue({ count: 1 })
    garmentEnqueue.mockResolvedValue(undefined)
    silhouetteUpdateMany.mockResolvedValue({ count: 1 })
    paletteUpdateMany.mockResolvedValue({ count: 1 })
    silhouetteEnqueue.mockResolvedValue(undefined)
    paletteEnqueue.mockResolvedValue(undefined)
  })

  describe('handOffMyFormProcessing', () => {
    it('enqueues under the session and sets the marker fenced on that session', async () => {
      await expect(
        handOffMyFormProcessing(prisma, publishers.silhouette, myForm())
      ).resolves.toBe(true)

      expect(silhouetteEnqueue).toHaveBeenCalledExactlyOnceWith('silhouette-1', SESSION_A)
      expect(silhouetteUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'silhouette-1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_A,
          my_form_processing_job_enqueued_at: null,
        },
        data: { my_form_processing_job_enqueued_at: NOW },
      })
      expect(silhouetteEnqueue.mock.invocationCallOrder[0]).toBeLessThan(
        silhouetteUpdateMany.mock.invocationCallOrder[0]!
      )
    })

    it.each([
      ['a marked handoff', myForm({ my_form_processing_job_enqueued_at: NOW })],
      ['a photo no longer processing', myForm({ my_form_status: 'ready' })],
      ['a session that is not a UUID', myForm({ my_form_upload_session_id: '../x' })],
    ])('does nothing for %s', async (_label, profile) => {
      await expect(
        handOffMyFormProcessing(prisma, publishers.silhouette, profile)
      ).resolves.toBe(false)

      expect(silhouetteEnqueue).not.toHaveBeenCalled()
      expect(silhouetteUpdateMany).not.toHaveBeenCalled()
    })

    it('sets no marker when the enqueue fails', async () => {
      silhouetteEnqueue.mockRejectedValueOnce(new Error('redis down'))

      await expect(
        handOffMyFormProcessing(prisma, publishers.silhouette, myForm())
      ).rejects.toThrow('redis down')

      expect(silhouetteUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('handOffPaletteAnalysis', () => {
    it('enqueues under the analysis attempt and sets the marker fenced on that attempt', async () => {
      await expect(
        handOffPaletteAnalysis(prisma, publishers.palette, analysis())
      ).resolves.toBe(true)

      expect(paletteEnqueue).toHaveBeenCalledExactlyOnceWith('palette-1', ATTEMPT)
      expect(paletteUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'palette-1',
          status: 'processing',
          analysis_attempt_id: ATTEMPT,
          processing_job_enqueued_at: null,
        },
        data: { processing_job_enqueued_at: NOW },
      })
    })

    it.each([
      ['a marked handoff', analysis({ processing_job_enqueued_at: NOW })],
      ['an analysis no longer processing', analysis({ status: 'failed' })],
      [
        'an analysis started before attempts were recorded',
        analysis({ analysis_attempt_id: null }),
      ],
    ])('does nothing for %s', async (_label, profile) => {
      await expect(
        handOffPaletteAnalysis(prisma, publishers.palette, profile)
      ).resolves.toBe(false)

      expect(paletteEnqueue).not.toHaveBeenCalled()
      expect(paletteUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('reenqueueStrandedProcessing', () => {
    it('reads only processing rows with no marker past the grace period, oldest first', async () => {
      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(0)

      const before = new Date(NOW.getTime() - PROCESSING_HANDOFF_GRACE_MS)
      expect(silhouetteFindMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          my_form_status: 'processing',
          my_form_processing_job_enqueued_at: null,
          my_form_committed_at: { lte: before },
        },
        orderBy: { my_form_committed_at: 'asc' },
        take: 100,
      })
      expect(garmentFindMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          upload_status: 'processing',
          retention_status: 'active',
          processing_job_enqueued_at: null,
          committed_at: { lte: before },
        },
        orderBy: { committed_at: 'asc' },
        take: 100,
      })
      expect(paletteFindMany.mock.calls).toEqual([
        [
          {
            where: {
              status: 'processing',
              analysis_attempt_id: null,
              updated_at: { lte: before },
            },
            orderBy: { updated_at: 'asc' },
            take: 100,
          },
        ],
        [
          {
            where: {
              status: 'processing',
              processing_job_enqueued_at: null,
              analysis_attempt_id: { not: null },
              updated_at: { lte: before },
            },
            orderBy: { updated_at: 'asc' },
            take: 100,
          },
        ],
      ])
    })

    it('hands off every stranded row, and one failed enqueue leaves the rest to proceed', async () => {
      silhouetteFindMany.mockResolvedValueOnce([
        myForm({ id: 'silhouette-1', my_form_upload_session_id: SESSION_A }),
        myForm({ id: 'silhouette-2', my_form_upload_session_id: SESSION_B }),
      ])
      paletteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([analysis()])
      silhouetteEnqueue.mockRejectedValueOnce(new Error('redis down'))

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(2)

      expect(silhouetteEnqueue.mock.calls).toEqual([
        ['silhouette-1', SESSION_A],
        ['silhouette-2', SESSION_B],
      ])
      expect(paletteEnqueue).toHaveBeenCalledExactlyOnceWith('palette-1', ATTEMPT)
      expect(loggerMocks.child.warn).toHaveBeenCalledWith(
        { profileId: 'silhouette-1', errorClass: 'Error' },
        'my_form_processing_handoff_failed'
      )
      expect(loggerMocks.child.warn).toHaveBeenCalledWith(
        { count: 2 },
        'stranded_processing_reenqueued'
      )
    })

    /**
     * Round 5 (Codex C4-7): the migration leaves the handoff marker null on rows already
     * processing at deploy, since nothing records whether their job was delivered, and gives a
     * historical wardrobe analysis the known legacy attempt. The hourly job then enqueues each
     * under its deterministic job id; where the original job still exists that is a no-op.
     */
    it('enqueues upgraded processing rows that have no marker under their deterministic ids', async () => {
      silhouetteFindMany.mockResolvedValueOnce([
        myForm({ id: 'silhouette-upgraded', my_form_upload_session_id: SESSION_A }),
      ])
      paletteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        analysis({ id: 'palette-selfie', analysis_attempt_id: SESSION_B }),
        analysis({
          id: 'palette-wardrobe',
          analysis_attempt_id: LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID,
        }),
      ])

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(3)

      expect(silhouetteEnqueue).toHaveBeenCalledExactlyOnceWith(
        'silhouette-upgraded',
        SESSION_A
      )
      expect(paletteEnqueue.mock.calls).toEqual([
        ['palette-selfie', SESSION_B],
        ['palette-wardrobe', 'legacy-wardrobe-analysis'],
      ])
    })

    /**
     * Round 6 (Codex C5-6): an API instance from before the attempt column started a wardrobe
     * analysis after the migration ran, so the row is processing with no attempt. The new worker
     * skips its job and the handoff above needs an attempt, so the member saw an analysis in
     * progress for good. The hourly job now assigns a durable attempt under a guarded update and
     * then enqueues it; the old job still exits, since its attempt never matches.
     */
    it('assigns an attempt to an analysis an old producer started, then enqueues it under that attempt', async () => {
      const oldProducerWrite = analysis({
        id: 'palette-rollout',
        source: 'wardrobe',
        analysis_attempt_id: null,
        selfie_upload_session_id: null,
        revision: 4,
      })
      paletteFindMany.mockResolvedValueOnce([oldProducerWrite]).mockResolvedValueOnce([])

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(1)

      const assignment = paletteUpdateMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>
        data: { analysis_attempt_id: string }
      }
      expect(assignment.where).toEqual({
        id: 'palette-rollout',
        status: 'processing',
        analysis_attempt_id: null,
        revision: 4,
      })
      const attemptId = assignment.data.analysis_attempt_id
      expect(attemptId).toMatch(/^[0-9a-f-]{36}$/)
      expect(attemptId).not.toBe(LEGACY_WARDROBE_ANALYSIS_ATTEMPT_ID)
      expect(paletteEnqueue).toHaveBeenCalledExactlyOnceWith('palette-rollout', attemptId)
      expect(paletteUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
        paletteEnqueue.mock.invocationCallOrder[0]!
      )
      expect(paletteUpdateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'palette-rollout',
          status: 'processing',
          analysis_attempt_id: attemptId,
          processing_job_enqueued_at: null,
        },
        data: { processing_job_enqueued_at: NOW },
      })
    })

    it('gives an old producer selfie analysis its session as the attempt', async () => {
      paletteFindMany
        .mockResolvedValueOnce([
          analysis({
            id: 'palette-selfie-rollout',
            source: 'selfie',
            analysis_attempt_id: null,
            selfie_upload_session_id: SESSION_A,
            revision: 2,
          }),
        ])
        .mockResolvedValueOnce([])

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(1)

      expect(paletteEnqueue).toHaveBeenCalledExactlyOnceWith(
        'palette-selfie-rollout',
        SESSION_A
      )
    })

    it('enqueues nothing for an orphan analysis that changed while it was read', async () => {
      paletteFindMany
        .mockResolvedValueOnce([analysis({ analysis_attempt_id: null, revision: 1 })])
        .mockResolvedValueOnce([])
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(0)

      expect(paletteEnqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 6 (Codex C5-7): the color worker declines a garment under legal hold and clears its
     * marker. Once the hold is released the hourly job enqueues it again, under a job id derived
     * from the deferral: the first job's id is retained as completed for seven days.
     */
    it('re-enqueues a released garment the worker deferred under a fresh job id', async () => {
      const deferredAt = new Date(NOW.getTime() - 60 * 60 * 1000)
      garmentFindMany.mockResolvedValueOnce([
        garment({ processing_deferred_at: deferredAt }),
      ])

      await expect(reenqueueStrandedProcessing(prisma, publishers, NOW)).resolves.toBe(1)

      const jobId = `garment-1__deferred-${deferredAt.getTime()}`
      expect(garmentEnqueue).toHaveBeenCalledExactlyOnceWith('garment-1', jobId)
      expect(garmentUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'garment-1',
          upload_status: 'processing',
          processing_job_enqueued_at: null,
          processing_deferred_at: deferredAt,
        },
        data: { processing_job_enqueued_at: NOW },
      })
    })
  })

  describe('handOffGarmentProcessing', () => {
    it('uses the garment id as the job id until a hold defers the garment', () => {
      expect(garmentProcessingJobId(garment())).toBe('garment-1')
      expect(
        garmentProcessingJobId(garment({ processing_deferred_at: new Date(1_000) }))
      ).toBe('garment-1__deferred-1000')
    })

    it.each([
      ['a marked handoff', garment({ processing_job_enqueued_at: NOW })],
      ['a garment under legal hold', garment({ retention_status: 'legal_hold' })],
      ['a garment no longer processing', garment({ upload_status: 'awaiting_tags' })],
    ])('does nothing for %s', async (_label, row) => {
      await expect(
        handOffGarmentProcessing(prisma, publishers.garment, row)
      ).resolves.toBe(false)

      expect(garmentEnqueue).not.toHaveBeenCalled()
      expect(garmentUpdateMany).not.toHaveBeenCalled()
    })
  })
})
