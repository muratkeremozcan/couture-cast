// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 5.4 Task 5/6: PaletteAdvisorService, mirroring
// wardrobe-silhouette.service.spec.ts's mocking shape for the upload
// lifecycle, plus coverage for consent, wardrobe analysis, recommendations,
// and erasure that have no sibling to mirror.
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions read vi.fn() members off their mock object, the established pattern for these suites. */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import type { PaletteProfile, PrismaClient } from '@prisma/client'
import {
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
} from '../../contracts/http.js'
import type { GuardianService } from '../guardian/guardian.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { MAX_GARMENT_IMAGE_BYTES } from '../wardrobe/wardrobe-image-validation.js'
import { WardrobeObjectDeletionOutbox } from '../wardrobe/wardrobe-object-deletion.outbox.js'
import { PUBLISH_CLAIM_LEASE_MS } from '../wardrobe/wardrobe-publication.js'
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import type { AffiliateOfferService } from './affiliate-offer.service.js'
import type { PaletteAnalysisProcessingQueue } from './palette-analysis-processing.queue.js'
import { PaletteAdvisorService } from './palette-advisor.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'

const USER_ID = 'user-1'
const SESSION_ID = '5a1f0c3e-2b4d-4e6f-8a9b-0c1d2e3f4a5b'
/** The session a concurrent replacement put on the row (C2-4). */
const REPLACEMENT_SESSION_ID = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'
const OLD_SESSION_ID = '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9'

/** A deliberately partial row: only the columns the service actually reads. */
function profileRow(overrides: Record<string, unknown> = {}): PaletteProfile {
  return {
    id: 'profile-1',
    user_id: USER_ID,
    consent_granted_at: null,
    consent_revoked_at: null,
    source: null,
    undertone: null,
    depth: null,
    confidence: null,
    analysis_version: null,
    analyzed_at: null,
    status: null,
    failure_reason: null,
    selfie_object_path: null,
    selfie_upload_session_id: null,
    selfie_upload_idempotency_key: null,
    selfie_commit_idempotency_key: null,
    selfie_commit_payload_hash: null,
    selfie_file_size_bytes: null,
    selfie_mime_type: null,
    selfie_content_sha256: null,
    selfie_width_px: null,
    selfie_height_px: null,
    selfie_upload_expires_at: null,
    selfie_committed_at: null,
    selfie_purged_at: null,
    revision: 0,
    created_at: new Date('2026-08-09T10:00:00Z'),
    updated_at: new Date('2026-08-09T10:00:00Z'),
    ...overrides,
  } as unknown as PaletteProfile
}

const CONSENTED = { consent_granted_at: new Date('2026-08-01T00:00:00Z') }

async function selfiePng(width = 300, height = 300): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: { r: 210, g: 180, b: 160 } },
  })
    .png()
    .toBuffer()
}

const NOT_YET_EXPIRED = new Date('2099-01-01T00:00:00.000Z')
const ALREADY_EXPIRED = new Date('2020-01-01T00:00:00.000Z')

/** The real final path: `buildPaletteSelfieObjectPath(user, session, ext)`. */
const SELFIE_PATH = `wardrobe/${USER_ID}/palette/${SESSION_ID}.png`
/**
 * Where the session's signed URL writes; never a final path. Round 3 (2026-11-19) keys it on the
 * owner, the kind and the session: `staging/<userId>/palette/<session>.<ext>`.
 */
const STAGING_PATH = `staging/${USER_ID}/palette/${SESSION_ID}.png`
const FOREIGN_PATH = `wardrobe/user-2/palette/${SESSION_ID}.png`

/** The storage signed upload session the adapter double hands out. */
const SIGNED_UPLOAD = {
  uploadUrl: `https://storage.test/storage/v1/object/upload/sign/wardrobe-images/${SELFIE_PATH}?token=signed-upload-token`,
  uploadToken: 'signed-upload-token',
  tokenExpiresAt: new Date('2099-06-01T00:00:00.000Z'),
}

/** A selfie session whose declaration describes `bytes`. */
function selfieSession(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return profileRow({
    ...CONSENTED,
    status: 'pending_upload',
    selfie_object_path: SELFIE_PATH,
    selfie_upload_session_id: SESSION_ID,
    selfie_upload_expires_at: NOT_YET_EXPIRED,
    selfie_file_size_bytes: bytes.length,
    selfie_mime_type: 'image/png',
    selfie_content_sha256: createHash('sha256').update(bytes).digest('hex'),
    selfie_width_px: 300,
    selfie_height_px: 300,
    ...overrides,
  })
}

describe('PaletteAdvisorService', () => {
  const paletteFindUnique = vi.fn()
  const paletteUpdate = vi.fn()
  const paletteUpdateMany = vi.fn()
  const paletteUpsert = vi.fn()
  const stateFindMany = vi.fn()
  const stateDeleteMany = vi.fn()
  const stateUpsert = vi.fn()
  const auditLogCreate = vi.fn()
  const executeRaw = vi.fn()
  const queryRaw = vi.fn()

  /**
   * The deletion outbox as a small in-memory table, so a test reads what was recorded, when it
   * falls due and what was settled. `createMany` and `updateMany` are the rows the service
   * writes; `findUnique`, `update` and `delete` are the outbox's own per-key settle.
   */
  type OutboxRow = {
    id: string
    object_path: string
    reason: string
    not_before: Date
    attempts: number
    repeat_until: Date | null
  }
  const outbox = new Map<string, OutboxRow>()
  /** A recorded row is due at once unless the writer deferred it; this is long past. */
  const RECORDED_AT = new Date('2026-01-01T00:00:00.000Z')
  const deletionCreateMany = vi.fn(
    ({
      data,
    }: {
      data: {
        object_path: string
        reason: string
        not_before?: Date
        repeat_until?: Date
      }[]
    }) => {
      for (const row of data) {
        if (outbox.has(row.object_path)) continue
        outbox.set(row.object_path, {
          id: `deletion:${row.object_path}`,
          object_path: row.object_path,
          reason: row.reason,
          not_before: row.not_before ?? RECORDED_AT,
          attempts: 0,
          repeat_until: row.repeat_until ?? null,
        })
      }
      return Promise.resolve({ count: data.length })
    }
  )
  const deletionUpdateMany = vi.fn()
  const deletionFindMany = vi.fn()
  const deletionFindUnique = vi.fn(({ where }: { where: { object_path: string } }) =>
    Promise.resolve(outbox.get(where.object_path) ?? null)
  )
  const deletionDelete = vi.fn(({ where }: { where: { id: string } }) => {
    for (const [path, row] of outbox) if (row.id === where.id) outbox.delete(path)
    return Promise.resolve({})
  })
  /** The outbox's own per-row update: a deferral, or a repeating row's next attempt. */
  const deletionUpdate = vi.fn(
    ({ where, data }: { where: { id: string }; data: Partial<OutboxRow> }) => {
      for (const row of outbox.values()) if (row.id === where.id) Object.assign(row, data)
      return Promise.resolve({})
    }
  )
  /**
   * The profile the outbox judges a key against, read under its row lock. Null by default: no
   * row keeps the key, so it is removable.
   */
  const judgedProfile = vi.fn()

  /** The client the outbox's per-key settle transaction runs on. */
  const settleTx = {
    $queryRaw: queryRaw,
    paletteProfile: { findUnique: judgedProfile },
    wardrobeObjectDeletion: {
      findUnique: deletionFindUnique,
      update: deletionUpdate,
      delete: deletionDelete,
    },
  }

  const prisma = {
    paletteProfile: {
      findUnique: paletteFindUnique,
      update: paletteUpdate,
      updateMany: paletteUpdateMany,
      upsert: paletteUpsert,
      findUniqueOrThrow: vi.fn(),
    },
    wardrobeObjectDeletion: {
      createMany: deletionCreateMany,
      updateMany: deletionUpdateMany,
      findMany: deletionFindMany,
    },
    advisorRecommendationState: {
      findMany: stateFindMany,
      deleteMany: stateDeleteMany,
      upsert: stateUpsert,
    },
    auditLog: { create: auditLogCreate },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    // The outbox's settle is the only transaction opened with options (its timeout); the
    // service's own transactions run on this client itself.
    $transaction: vi.fn(
      (work: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) =>
        work(options === undefined ? prisma : settleTx)
    ),
  } as unknown as PrismaClient
  const findUniqueOrThrow = (
    prisma.paletteProfile as unknown as { findUniqueOrThrow: ReturnType<typeof vi.fn> }
  ).findUniqueOrThrow

  const hasPremiumAccess = vi.fn().mockResolvedValue(true)
  const entitlements = { hasPremiumAccess } as unknown as PremiumEntitlementService

  const getFeatureFlag = vi.fn().mockResolvedValue(true)
  const featureFlags = { getFeatureFlag } as unknown as FeatureFlagsService

  const captureEvent = vi.fn().mockResolvedValue(undefined)
  const telemetry = { captureEvent } as unknown as TelemetryService

  const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
  const guardian = { assertWardrobeUploadAllowed } as unknown as GuardianService

  const resolveAdvisorOffers = vi.fn().mockResolvedValue(new Map())
  const affiliateOffers = { resolveAdvisorOffers } as unknown as AffiliateOfferService

  const enqueue = vi.fn().mockResolvedValue(undefined)
  const processingQueue = { enqueue } as unknown as PaletteAnalysisProcessingQueue

  const createUploadSession = vi.fn().mockResolvedValue(SIGNED_UPLOAD)
  const downloadBounded = vi.fn().mockResolvedValue({ status: 'missing' })
  const publish = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  /** The selfie flow never signs a read; the double exists so a test can say so outright. */
  const signReadUrl = vi.fn()
  const storage = {
    createUploadSession,
    downloadBounded,
    publish,
    remove,
    signReadUrl,
  } as unknown as WardrobeStorage

  /** The objects recorded for deletion, across every `createMany` call. */
  function recordedDeletions(): string[] {
    return deletionCreateMany.mock.calls
      .flatMap(([args]) => (args as { data: { object_path: string }[] }).data)
      .map((row) => row.object_path)
  }

  let service: PaletteAdvisorService

  beforeEach(() => {
    vi.clearAllMocks()
    hasPremiumAccess.mockResolvedValue(true)
    getFeatureFlag.mockResolvedValue(true)
    captureEvent.mockResolvedValue(undefined)
    assertWardrobeUploadAllowed.mockResolvedValue(undefined)
    resolveAdvisorOffers.mockResolvedValue(new Map())
    enqueue.mockResolvedValue(undefined)
    createUploadSession.mockResolvedValue(SIGNED_UPLOAD)
    downloadBounded.mockResolvedValue({ status: 'missing' })
    publish.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
    outbox.clear()
    deletionUpdateMany.mockResolvedValue({ count: 0 })
    deletionFindMany.mockResolvedValue([])
    judgedProfile.mockResolvedValue(null)
    queryRaw.mockResolvedValue([])
    findUniqueOrThrow.mockResolvedValue(
      profileRow({ ...CONSENTED, status: 'processing', source: 'selfie' })
    )
    stateFindMany.mockResolvedValue([])
    paletteUpdateMany.mockResolvedValue({ count: 1 })
    service = new PaletteAdvisorService(
      prisma,
      entitlements,
      featureFlags,
      telemetry,
      guardian,
      affiliateOffers,
      processingQueue,
      storage as never
    )
  })

  describe('getProfile', () => {
    it('reports the locked/unconsented shape with no profile row at all', async () => {
      hasPremiumAccess.mockResolvedValueOnce(false)
      paletteFindUnique.mockResolvedValueOnce(null)

      const result = await service.getProfile(USER_ID)

      expect(result).toEqual({
        // Null until a consent grant creates the row. Published because an
        // advisor click sends it back as its `recommendationId` (Decision 7).
        profileId: null,
        isEntitled: false,
        analysisEnabled: true,
        hasConsent: false,
        analysis: null,
        recommendations: [],
      })
    })

    it('is not entitlement- or flag-gated: it always answers', async () => {
      hasPremiumAccess.mockResolvedValueOnce(false)
      getFeatureFlag.mockResolvedValueOnce(false)
      paletteFindUnique.mockResolvedValueOnce(null)

      await expect(service.getProfile(USER_ID)).resolves.toMatchObject({
        isEntitled: false,
        analysisEnabled: false,
      })
    })

    it('5.4-API-050 resolves recommendation cards only once analysis is ready, skipping dismissed items', async () => {
      paletteFindUnique.mockResolvedValueOnce(
        profileRow({
          ...CONSENTED,
          status: 'ready',
          source: 'selfie',
          undertone: 'warm',
          depth: 'medium',
          confidence: 0.83,
          analysis_version: 'palette-advisor-v1',
          analyzed_at: new Date('2026-08-20T00:00:00Z'),
        })
      )
      stateFindMany.mockResolvedValueOnce([
        { item_key: 'advisor:foundation:warm:medium', action: 'dismissed' },
        { item_key: 'advisor:jewelry:warm', action: 'saved' },
      ])

      const result = await service.getProfile(USER_ID)

      expect(result.analysis).toMatchObject({ status: 'ready', undertone: 'warm' })
      // 6 cards total (foundation + 2 blush + jewelry + bag + eyewear) minus
      // the dismissed foundation card.
      expect(result.recommendations).toHaveLength(5)
      expect(
        result.recommendations.find((card) => card.itemKey === 'advisor:jewelry:warm')
      ).toMatchObject({ saved: true })
      expect(
        result.recommendations.some(
          (card) => card.itemKey === 'advisor:foundation:warm:medium'
        )
      ).toBe(false)
    })
  })

  describe('setConsent', () => {
    it('refuses when the flag is disabled', async () => {
      getFeatureFlag.mockResolvedValueOnce(false)

      await expect(service.setConsent(USER_ID, true)).rejects.toThrow(
        PALETTE_ANALYSIS_DISABLED_MESSAGE
      )
      expect(paletteUpsert).not.toHaveBeenCalled()
    })

    it('grants consent and writes an audit row recording the prior state', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(null) // existing lookup inside setConsent
        .mockResolvedValueOnce(profileRow(CONSENTED)) // getProfile's own read

      await service.setConsent(USER_ID, true)

      expect(paletteUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID },
          create: expect.objectContaining({ user_id: USER_ID }),
        })
      )
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'palette_analysis_consent_changed',
            event_data: { from: 'none', to: 'granted', source: 'user' },
          }),
        })
      )
    })

    it('revoking runs the same erase path as DELETE', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow({ ...CONSENTED, selfie_object_path: null }))
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))

      await service.setConsent(USER_ID, false)

      expect(stateDeleteMany).toHaveBeenCalledWith({ where: { user_id: USER_ID } })
      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_data: { from: 'granted', to: 'revoked', source: 'user' },
          }),
        })
      )
    })
  })

  describe('analyzeWardrobe', () => {
    it('5.4-API-010 requires consent before the flag, per Decision 10', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow()) // no consent
      // Deliberately NOT stubbing getFeatureFlag to false here: a queued
      // mockResolvedValueOnce that assertConsent's throw never reaches would
      // leak into a later test, since vi.clearAllMocks() does not drain the
      // once-queue. The assertion below already proves the flag was never
      // consulted.

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow(
        PALETTE_CONSENT_REQUIRED_MESSAGE
      )
      expect(getFeatureFlag).not.toHaveBeenCalled()
    })

    it('5.4-API-061 reports the disabled flag once consent is present', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow(CONSENTED))
      getFeatureFlag.mockResolvedValueOnce(false)

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )
    })

    it('rejects a second analysis while one is already processing', async () => {
      // assertConsent's read, then the read under the member lock: both see the analysis.
      paletteFindUnique
        .mockResolvedValueOnce(profileRow({ ...CONSENTED, status: 'processing' }))
        .mockResolvedValueOnce(profileRow({ ...CONSENTED, status: 'processing' }))

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow(
        PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE
      )
      expect(paletteUpdateMany).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('marks the profile processing and enqueues on the happy path', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, status: 'processing', source: 'wardrobe' })
        )

      await service.analyzeWardrobe(USER_ID)

      // Round 5 (Codex C4-3): claimed under the member lock from the row read there, guarded on
      // the status and revision it read. Round 4 (C3-6): the analysis records its own attempt,
      // enqueues under it (job id `profile-1__<attempt>`), then records the handoff, fenced on
      // that same attempt.
      expect(executeRaw).toHaveBeenCalledOnce()
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'profile-1', status: null, revision: 0 },
        data: expect.objectContaining({
          source: 'wardrobe',
          status: 'processing',
          analysis_attempt_id: expect.any(String),
          processing_job_enqueued_at: null,
        }),
      })
      const attemptId = (
        paletteUpdateMany.mock.calls[0]![0] as { data: { analysis_attempt_id: string } }
      ).data.analysis_attempt_id
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', attemptId)
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'profile-1',
          status: 'processing',
          analysis_attempt_id: attemptId,
          processing_job_enqueued_at: null,
        },
        data: { processing_job_enqueued_at: expect.any(Date) },
      })
      expect(paletteUpdateMany).toHaveBeenCalledTimes(2)
    })

    /**
     * Round 5 (Codex C4-3): consent and the current attempt are rechecked under the lock erasure
     * takes. Round 4 read them, awaited the feature check, then updated by user id alone, so an
     * erasure that finished in between got an analysis on its revoked profile.
     */
    it('starts nothing when an erasure finished during the feature check', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            consent_revoked_at: new Date('2026-09-01T00:00:00Z'),
          })
        )

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow(
        PALETTE_CONSENT_REQUIRED_MESSAGE
      )
      expect(executeRaw).toHaveBeenCalledOnce()
      expect(paletteUpdateMany).not.toHaveBeenCalled()
      expect(paletteUpdate).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('leaves a selfie commit that reached processing during the feature check alone', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'processing',
            source: 'selfie',
            analysis_attempt_id: SESSION_ID,
          })
        )

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow(
        PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE
      )
      expect(paletteUpdateMany).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 5 (Codex C4-3, C4-5): an analysis that supersedes a pending selfie whose
     * publication is in flight clears that session and records its keys under the selfie's own
     * identity. They are removed at once and the removal repeats until 24 hours after the
     * publication's lease started, so the superseded publish never leaves a selfie behind.
     */
    it('supersedes a pending selfie mid-publication and removes its keys now and repeatedly', async () => {
      const bytes = await selfiePng()
      const startedAt = new Date(Date.now() - 60_000)
      const pending = selfieSession(bytes, {
        selfie_publish_attempt_id: 'publisher-1',
        selfie_publish_started_at: startedAt,
      })
      paletteFindUnique
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, status: 'processing', source: 'wardrobe' })
        )

      await service.analyzeWardrobe(USER_ID)

      expect(paletteUpdateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'profile-1', status: 'pending_upload', revision: 0 },
        data: expect.objectContaining({
          status: 'processing',
          source: 'wardrobe',
          selfie_upload_session_id: null,
          selfie_object_path: null,
          selfie_publish_attempt_id: null,
        }),
      })
      expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            object_path: SELFIE_PATH,
            reason: 'selfie_superseded',
            not_before: expect.any(Date),
            repeat_until: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000),
          },
          {
            object_path: STAGING_PATH,
            reason: 'selfie_superseded',
            not_before: expect.any(Date),
            repeat_until: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000),
          },
        ],
        skipDuplicates: true,
      })
      expect(remove).toHaveBeenCalledWith([SELFIE_PATH])
      expect(remove).toHaveBeenCalledWith([STAGING_PATH])
      expect(enqueue).toHaveBeenCalledOnce()
    })

    /**
     * Final review F-6: a finished selfie analysis keeps its selfie columns, and its purge may
     * still be repeating until the session's horizon. A wardrobe analysis started on that
     * profile records the selfie's keys under the selfie's own identity, repeating until that
     * horizon, and clears the selfie session, so neither the processing row it leaves nor an
     * enqueue failure that rolls it back can cancel the purge.
     */
    it('transfers a finished selfie purge to the outbox when a wardrobe analysis starts', async () => {
      const bytes = await selfiePng()
      const cleanupUntil = new Date(Date.now() + 6 * 60 * 60 * 1000)
      const finished = selfieSession(bytes, {
        status: 'ready',
        source: 'selfie',
        analysis_attempt_id: SESSION_ID,
        selfie_committed_at: new Date(Date.now() - 60_000),
        selfie_purged_at: new Date(Date.now() - 30_000),
        selfie_publish_cleanup_until: cleanupUntil,
      })
      paletteFindUnique.mockResolvedValueOnce(finished).mockResolvedValueOnce(finished)
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow('redis unavailable')

      expect(paletteUpdateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'profile-1', status: 'ready', revision: 0 },
        data: expect.objectContaining({
          status: 'processing',
          source: 'wardrobe',
          selfie_upload_session_id: null,
          selfie_object_path: null,
          selfie_publish_cleanup_until: null,
        }),
      })
      expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith({
        data: [SELFIE_PATH, STAGING_PATH].map((object_path) => ({
          object_path,
          reason: 'selfie_superseded',
          not_before: expect.any(Date),
          repeat_until: cleanupUntil,
        })),
        skipDuplicates: true,
      })
      expect(remove).toHaveBeenCalledWith([SELFIE_PATH])
    })

    /**
     * Round 4 (Codex C3-6): the rollback after a failed enqueue is fenced on this analysis's
     * own attempt. Round 3 released any processing row, so a selfie commit that reached
     * processing meanwhile was cleared and stranded.
     */
    it('releases only its own processing claim when the enqueue fails', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(profileRow(CONSENTED))
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow('redis unavailable')

      const attemptId = (
        paletteUpdateMany.mock.calls[0]![0] as { data: { analysis_attempt_id: string } }
      ).data.analysis_attempt_id
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'profile-1',
          status: 'processing',
          source: 'wardrobe',
          analysis_attempt_id: attemptId,
        },
        data: { status: null, source: null, analysis_attempt_id: null },
      })
    })
  })

  describe('createSelfieUploadUrl', () => {
    const input = {
      fileSizeBytes: 1024,
      mimeType: 'image/png' as const,
      sha256: '0'.repeat(64),
      widthPx: 300,
      heightPx: 300,
    }

    it('5.4-API-011 requires consent before the flag', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow())

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(PALETTE_CONSENT_REQUIRED_MESSAGE)
    })

    it('checks guardian consent for the acting role', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow(CONSENTED))
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'teen', input, 'key-1')
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('allocates a fresh session with a storage signed upload URL for its one object', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED)) // assertConsent
        .mockResolvedValueOnce(profileRow(CONSENTED)) // inside $transaction
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      const result = await service.createSelfieUploadUrl(
        USER_ID,
        'guardian',
        input,
        'key-1'
      )

      const [{ data }] = paletteUpdate.mock.calls[0] as [
        {
          data: {
            selfie_object_path: string
            selfie_upload_session_id: string
            selfie_upload_expires_at: Date
          }
        },
      ]
      // The signed URL names only the session's staging key, never the final path.
      expect(data.selfie_object_path).toBe(
        `wardrobe/${USER_ID}/palette/${data.selfie_upload_session_id}.png`
      )
      expect(createUploadSession).toHaveBeenCalledTimes(1)
      expect(createUploadSession).toHaveBeenCalledWith(
        `staging/${USER_ID}/palette/${data.selfie_upload_session_id}.png`
      )
      expect(result.replayed).toBe(false)
      expect(result.response.data).toEqual({
        uploadSessionId: data.selfie_upload_session_id,
        uploadUrl: SIGNED_UPLOAD.uploadUrl,
        uploadToken: SIGNED_UPLOAD.uploadToken,
        requiredHeaders: { 'content-type': 'image/png' },
        expiresAt: data.selfie_upload_expires_at.toISOString(),
      })
    })

    it('tells the client the token expiry when the token ends before the session', async () => {
      const tokenExpiresAt = new Date(Date.now() + 60_000)
      createUploadSession.mockResolvedValueOnce({ ...SIGNED_UPLOAD, tokenExpiresAt })
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(profileRow(CONSENTED))
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      const result = await service.createSelfieUploadUrl(
        USER_ID,
        'guardian',
        input,
        'key-1'
      )

      expect(result.response.data.expiresAt).toBe(tokenExpiresAt.toISOString())
    })

    it('replays a live session for the same idempotency key', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_upload_idempotency_key: 'key-1',
            selfie_upload_session_id: SESSION_ID,
            selfie_object_path: SELFIE_PATH,
            selfie_mime_type: 'image/png',
            selfie_upload_expires_at: NOT_YET_EXPIRED,
          })
        )

      const result = await service.createSelfieUploadUrl(
        USER_ID,
        'guardian',
        input,
        'key-1'
      )

      expect(result.replayed).toBe(true)
      expect(paletteUpdate).not.toHaveBeenCalled()
      // Signed afresh for the session's existing staging key, so a retry gets a live URL.
      expect(createUploadSession).toHaveBeenLastCalledWith(STAGING_PATH)
      expect(result.response.data).toEqual({
        uploadSessionId: SESSION_ID,
        uploadUrl: SIGNED_UPLOAD.uploadUrl,
        uploadToken: SIGNED_UPLOAD.uploadToken,
        requiredHeaders: { 'content-type': 'image/png' },
        expiresAt: NOT_YET_EXPIRED.toISOString(),
      })
    })

    /**
     * Round 4 (Codex C3-3): staging keys take one write, so a replay cannot re-sign a key that
     * already holds bytes. The adapter answers 409 UPLOAD_BYTES_PRESENT and the service passes
     * it on, touching nothing.
     */
    it('passes on 409 UPLOAD_BYTES_PRESENT when the replayed staging key already holds bytes', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_upload_idempotency_key: 'key-1',
            selfie_upload_session_id: SESSION_ID,
            selfie_object_path: SELFIE_PATH,
            selfie_mime_type: 'image/png',
            selfie_upload_expires_at: NOT_YET_EXPIRED,
          })
        )
      createUploadSession
        .mockResolvedValueOnce(SIGNED_UPLOAD) // the fresh key signed before the transaction
        .mockRejectedValueOnce(new ConflictException('UPLOAD_BYTES_PRESENT'))

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_BYTES_PRESENT'))
      expect(createUploadSession).toHaveBeenLastCalledWith(STAGING_PATH)
      expect(paletteUpdate).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
    })

    /**
     * Round 5 (Codex C4-5): a replacement that meets an unfinished publication of the replaced
     * session removes that session's keys at once and records a removal that repeats every
     * 15 minutes until 24 hours after the publication's lease started: the lease bounds who
     * owns the session, not when storage finishes a write it already received. Round 4 removed
     * nothing until the lease ended and then settled after one removal. The row is read under
     * the row lock, so a claim either precedes the read or waits for it.
     */
    describe('while the replaced session is publishing', () => {
      const NOW = new Date('2026-11-19T12:00:00.000Z')
      const CLAIMED_AT = new Date(NOW.getTime() - 5_000)
      const HORIZON = new Date(CLAIMED_AT.getTime() + 24 * 60 * 60 * 1000)
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('removes the replaced session keys now and keeps a repeating removal until the horizon', async () => {
        const oldFinal = `wardrobe/user-1/palette/${OLD_SESSION_ID}.png`
        const oldStaging = `staging/user-1/palette/${OLD_SESSION_ID}.png`
        paletteFindUnique
          .mockResolvedValueOnce(profileRow(CONSENTED))
          .mockResolvedValueOnce(
            profileRow({
              ...CONSENTED,
              status: 'pending_upload',
              selfie_object_path: oldFinal,
              selfie_upload_session_id: OLD_SESSION_ID,
              selfie_mime_type: 'image/png',
              selfie_upload_idempotency_key: 'key-0',
              selfie_publish_attempt_id: 'owning-attempt',
              selfie_publish_started_at: CLAIMED_AT,
            })
          )
        paletteUpdate.mockImplementationOnce(
          ({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve(profileRow({ ...CONSENTED, ...data }))
        )

        await service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')

        expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          paletteFindUnique.mock.invocationCallOrder[1]!
        )
        expect(paletteUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              selfie_publish_attempt_id: null,
              selfie_publish_started_at: null,
            }),
          })
        )
        expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith({
          data: [
            {
              object_path: oldFinal,
              reason: 'selfie_replaced',
              not_before: NOW,
              repeat_until: HORIZON,
            },
            {
              object_path: oldStaging,
              reason: 'selfie_replaced',
              not_before: NOW,
              repeat_until: HORIZON,
            },
          ],
          skipDuplicates: true,
        })
        expect(remove.mock.calls).toEqual([[[oldFinal]], [[oldStaging]]])
        // Both rows stay, due again in 15 minutes.
        expect(
          [...outbox.values()].map((row) => [row.object_path, row.not_before])
        ).toEqual([
          [oldFinal, new Date(NOW.getTime() + 15 * 60 * 1000)],
          [oldStaging, new Date(NOW.getTime() + 15 * 60 * 1000)],
        ])
      })
    })

    it('keeps the current selfie when storage cannot sign the upload', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow(CONSENTED)) // assertConsent
      createUploadSession.mockRejectedValueOnce(new Error('storage down'))

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('storage down')
      // Signing runs before the transaction, so the current selfie is neither replaced nor removed.
      expect(paletteFindUnique).toHaveBeenCalledTimes(1)
      expect(paletteUpdate).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    /**
     * Review round 2 (Codex C2-4): erasure revokes consent under the `palette_profile:<userId>`
     * lock, and allocation re-reads consent under that same lock, so a session cannot be written
     * after an erasure that ran between the first consent check and the transaction.
     */
    it('refuses with 403 consent-required when consent was revoked under the lock', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED)) // assertConsent, before the lock
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            consent_revoked_at: new Date('2026-08-02T00:00:00Z'),
          })
        ) // inside the transaction, after an erasure took the lock first

      const allocation = service.createSelfieUploadUrl(
        USER_ID,
        'guardian',
        input,
        'key-1'
      )

      await expect(allocation).rejects.toBeInstanceOf(ForbiddenException)
      await expect(allocation).rejects.toThrow(PALETTE_CONSENT_REQUIRED_MESSAGE)
      expect(executeRaw).toHaveBeenCalledOnce()
      expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        paletteFindUnique.mock.invocationCallOrder[1]!
      )
      expect(paletteUpdate).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('rejects a replay whose upload window already closed', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_upload_idempotency_key: 'key-1',
            selfie_upload_session_id: SESSION_ID,
            selfie_upload_expires_at: ALREADY_EXPIRED,
          })
        )

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('rejects reuse of a key already spent on a committed selfie', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'ready',
            selfie_upload_idempotency_key: 'key-1',
          })
        )

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('removes the superseded object when reallocating', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'failed',
            selfie_object_path: `wardrobe/user-1/palette/${OLD_SESSION_ID}.png`,
            selfie_upload_idempotency_key: 'key-0',
          })
        )
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      await service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')

      // Recorded in the replacing transaction, then removed and its outbox row deleted.
      expect(recordedDeletions()).toEqual([
        `wardrobe/user-1/palette/${OLD_SESSION_ID}.png`,
      ])
      expect(deletionCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
        remove.mock.invocationCallOrder[0]!
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([
        `wardrobe/user-1/palette/${OLD_SESSION_ID}.png`,
      ])
      expect(deletionDelete).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion:wardrobe/user-1/palette/${OLD_SESSION_ID}.png` },
      })
      expect(outbox.size).toBe(0)
    })

    /**
     * Review round 1, 2026-11-19 (lens 2): a replaced session that never committed left its
     * unverified bytes at its staging key; reallocation removes them with the old selfie.
     */
    it('removes a replaced pending session staging key too', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_object_path: `wardrobe/user-1/palette/${OLD_SESSION_ID}.webp`,
            selfie_upload_session_id: OLD_SESSION_ID,
            selfie_mime_type: 'image/webp',
            selfie_upload_idempotency_key: 'key-0',
          })
        )
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      await service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')

      // One removal per key, each judged under its own row lock.
      expect(remove.mock.calls).toEqual([
        [[`wardrobe/user-1/palette/${OLD_SESSION_ID}.webp`]],
        [[`staging/user-1/palette/${OLD_SESSION_ID}.webp`]],
      ])
      expect(outbox.size).toBe(0)
    })

    /** Review round 1, 2026-11-19 (Codex 1): never delete what a member-written path names. */
    it('never removes a superseded path naming another member', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'failed',
            selfie_object_path: FOREIGN_PATH,
            selfie_upload_idempotency_key: 'key-0',
          })
        )
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      await service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')

      expect(remove).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
    })

    /**
     * Review round 2 (Codex C2-2): an untrusted row is retired as an expired session, never
     * signed. Round 2 answered 500 UPLOAD_PATH_INVALID here.
     */
    it('refuses a replay whose stored path is not the session own before signing it', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_upload_idempotency_key: 'key-1',
            selfie_upload_session_id: SESSION_ID,
            selfie_object_path: FOREIGN_PATH,
            selfie_mime_type: 'image/png',
            selfie_upload_expires_at: NOT_YET_EXPIRED,
          })
        )

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(createUploadSession).toHaveBeenCalledTimes(1)
      expect(createUploadSession).not.toHaveBeenCalledWith(STAGING_PATH)
    })

    /**
     * Review round 2 (Codex C2-2): a historical session id with path segments, and a stored
     * path built from that same id, match each other; the id itself must parse as a UUID.
     */
    it('retires a replay whose session id and path are malformed together', async () => {
      const malformed = '../../user-2/palette/x'
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_upload_idempotency_key: 'key-1',
            selfie_upload_session_id: malformed,
            selfie_object_path: `wardrobe/${USER_ID}/palette/${malformed}.png`,
            selfie_mime_type: 'image/png',
            selfie_upload_expires_at: NOT_YET_EXPIRED,
          })
        )

      await expect(
        service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      // Only the fresh key signed before the transaction; the malformed one never reaches storage.
      expect(createUploadSession).toHaveBeenCalledOnce()
      expect(createUploadSession.mock.calls[0]?.[0]).toMatch(
        /^staging\/user-1\/palette\/[0-9a-f-]{36}\.png$/
      )
    })
  })

  describe('commitSelfie', () => {
    const input = { uploadSessionId: SESSION_ID }

    /** A fixed clock: publication claims and their leases are measured against it. */
    const NOW = new Date('2026-11-19T12:00:00.000Z')
    /** Round 6 (Codex C5-2): the cleanup horizon a claim at NOW records, 24 hours out. */
    const CLEANUP_HORIZON = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * Round 4 (Codex C3-1): the first conditional write of every commit takes the session's
     * publication, before any storage I/O. It names an unexpired pending session (or a legacy
     * relay upload) with no claim, or one whose lease ran out.
     */
    const PUBLICATION_CLAIM_WHERE = {
      id: 'profile-1',
      selfie_upload_session_id: SESSION_ID,
      OR: [
        { status: 'pending_upload', selfie_upload_expires_at: { gt: NOW } },
        { status: 'bytes_uploaded' },
      ],
      AND: [
        {
          OR: [
            { selfie_publish_attempt_id: null },
            { selfie_publish_started_at: null },
            {
              selfie_publish_started_at: {
                lt: new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS),
              },
            },
          ],
        },
      ],
    }

    /** The attempt id this commit's publication claim wrote. */
    function publishAttemptId(): string {
      const [claim] = paletteUpdateMany.mock.calls[0] as [
        { data: { selfie_publish_attempt_id: string } },
      ]
      return claim.data.selfie_publish_attempt_id
    }

    /** The profile once this commit's claim moved it on, as the handoff reads it. */
    function committedRow(bytes: Buffer, overrides: Record<string, unknown> = {}) {
      return selfieSession(bytes, {
        status: 'processing',
        source: 'selfie',
        selfie_commit_idempotency_key: 'key-1',
        analysis_attempt_id: SESSION_ID,
        processing_job_enqueued_at: null,
        ...overrides,
      })
    }

    /**
     * Review round 1, 2026-11-19 (Codex 3): a mismatch removes the staged selfie and ends the
     * session, so a correction needs a fresh allocation and key. Round 4: only the attempt that
     * owns the publication verifies, and the end is guarded on that claim.
     */
    function expectSelfieSessionEnded() {
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(1, {
        where: PUBLICATION_CLAIM_WHERE,
        data: {
          selfie_publish_attempt_id: expect.any(String),
          selfie_publish_started_at: NOW,
          selfie_publish_cleanup_until: CLEANUP_HORIZON,
        },
      })
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'profile-1',
          selfie_upload_session_id: SESSION_ID,
          selfie_publish_attempt_id: publishAttemptId(),
          status: { in: ['pending_upload', 'bytes_uploaded'] },
        },
        data: expect.objectContaining({
          status: null,
          selfie_upload_session_id: null,
          selfie_upload_idempotency_key: null,
          selfie_object_path: null,
          selfie_publish_attempt_id: null,
        }),
      })
      // Recorded with the session's end, then removed: a failed removal stays recorded.
      expect(recordedDeletions()).toEqual([STAGING_PATH])
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(publish).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    }

    it('rejects a commit for an unknown session', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow(CONSENTED))

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('replays a commit that used the same idempotency key', async () => {
      // commitSelfie reads the profile TWICE before any getProfile() call:
      // once inside assertConsent, once as its own local `profile`.
      const processingRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'processing',
        // `processing` is a valid analysis-status variant only with a
        // non-null source (paletteAnalysisSchema), which getProfile()'s
        // read has to satisfy on the replay path below.
        source: 'selfie',
        selfie_commit_idempotency_key: 'key-1',
        analysis_attempt_id: SESSION_ID,
        processing_job_enqueued_at: new Date('2026-11-19T11:59:00.000Z'),
      })
      paletteFindUnique
        .mockResolvedValueOnce(processingRow) // assertConsent
        .mockResolvedValueOnce(processingRow) // local `profile`
        .mockResolvedValueOnce(processingRow) // getProfile() on the replay path

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      // Its job is recorded as handed off, so nothing is enqueued again.
      expect(enqueue).not.toHaveBeenCalled()
      expect(downloadBounded).not.toHaveBeenCalled()
    })

    /**
     * Round 4 (Codex C3-5): a commit that stopped between its claim and the queue left the row
     * processing with no handoff marker. The same-key replay enqueues it again under the same
     * job id, then records the handoff.
     */
    it('re-enqueues a processing selfie whose handoff marker is missing on a same-key replay', async () => {
      const processingRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'processing',
        source: 'selfie',
        selfie_commit_idempotency_key: 'key-1',
        analysis_attempt_id: SESSION_ID,
        processing_job_enqueued_at: null,
      })
      paletteFindUnique
        .mockResolvedValueOnce(processingRow) // assertConsent
        .mockResolvedValueOnce(processingRow) // local `profile`
        .mockResolvedValueOnce(processingRow) // getProfile()

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      expect(paletteUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'profile-1',
          status: 'processing',
          analysis_attempt_id: SESSION_ID,
          processing_job_enqueued_at: null,
        },
        data: { processing_job_enqueued_at: NOW },
      })
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('rejects a second commit under a different idempotency key', async () => {
      const readyRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'ready',
        selfie_commit_idempotency_key: 'key-1',
      })
      paletteFindUnique
        .mockResolvedValueOnce(readyRow) // assertConsent
        .mockResolvedValueOnce(readyRow) // local `profile`

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-2')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('refuses when the flag is disabled, before reading storage', async () => {
      const bytes = await selfiePng()
      paletteFindUnique.mockResolvedValueOnce(selfieSession(bytes)) // assertConsent
      getFeatureFlag.mockResolvedValueOnce(false)

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(paletteUpdateMany).not.toHaveBeenCalled()
    })

    it('answers 409 UPLOAD_BYTES_MISSING when storage has no object yet', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`
      downloadBounded.mockResolvedValueOnce({ status: 'missing' })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_BYTES_MISSING'))
      // The session stays pending, so the client can finish the PUT and commit again: the claim
      // is given back at once, since no write of the final key was started.
      expect(downloadBounded).toHaveBeenCalledWith(STAGING_PATH, MAX_GARMENT_IMAGE_BYTES)
      expect(publish).not.toHaveBeenCalled()
      expect(paletteUpdateMany.mock.calls).toEqual([
        [
          {
            where: PUBLICATION_CLAIM_WHERE,
            data: {
              selfie_publish_attempt_id: expect.any(String),
              selfie_publish_started_at: NOW,
              selfie_publish_cleanup_until: CLEANUP_HORIZON,
            },
          },
        ],
        [
          {
            where: { id: 'profile-1', selfie_publish_attempt_id: publishAttemptId() },
            data: { selfie_publish_attempt_id: null, selfie_publish_started_at: null },
          },
        ],
      ])
      expect(remove).not.toHaveBeenCalled()
    })

    it('answers 409 UPLOAD_SESSION_EXPIRED for a pending session past its window', async () => {
      const bytes = await selfiePng()
      const expiredRow = selfieSession(bytes, {
        selfie_upload_expires_at: ALREADY_EXPIRED,
      })
      paletteFindUnique
        .mockResolvedValueOnce(expiredRow) // assertConsent
        .mockResolvedValueOnce(expiredRow) // local `profile`

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(paletteUpdateMany).not.toHaveBeenCalled()
    })

    it('rejects a commit for a session with no upload in flight', async () => {
      const idleRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: null,
      })
      paletteFindUnique
        .mockResolvedValueOnce(idleRow) // assertConsent
        .mockResolvedValueOnce(idleRow) // local `profile`

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(downloadBounded).not.toHaveBeenCalled()
    })

    it('checks guardian consent at commit, before reading storage', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.commitSelfie(USER_ID, 'teen', input, 'key-1')
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(USER_ID, 'teen')
      expect(downloadBounded).not.toHaveBeenCalled()
    })

    it('rejects stored bytes whose checksum differs from the declaration with 400, and removes them', async () => {
      const bytes = await selfiePng()
      const mismatched = selfieSession(bytes, { selfie_content_sha256: 'f'.repeat(64) })
      paletteFindUnique
        .mockResolvedValueOnce(mismatched) // assertConsent
        .mockResolvedValueOnce(mismatched) // local `profile`
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new BadRequestException('IMAGE_CHECKSUM_MISMATCH'))
      expectSelfieSessionEnded()
    })

    /**
     * Round 6 (Codex C5-2): a rejection by an attempt that took over a stale claim clears the
     * session, and its recorded cleanup horizon with it, while the earlier attempt may still
     * write the final key. The rejection records both keys as a removal that repeats until that
     * horizon, so the late write never leaves a selfie behind.
     */
    it('repeats the removal of the rejected session keys until the horizon an earlier claim recorded', async () => {
      const bytes = await selfiePng()
      const earlierHorizon = new Date(NOW.getTime() + 23 * 60 * 60 * 1000)
      const takenOver = selfieSession(bytes, {
        selfie_content_sha256: 'f'.repeat(64),
        selfie_publish_attempt_id: 'earlier-attempt',
        selfie_publish_started_at: new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 1),
        selfie_publish_cleanup_until: earlierHorizon,
      })
      paletteFindUnique
        .mockResolvedValueOnce(takenOver) // assertConsent
        .mockResolvedValueOnce(takenOver) // local `profile`
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new BadRequestException('IMAGE_CHECKSUM_MISMATCH'))

      expect(recordedDeletions()).toEqual([STAGING_PATH, SELFIE_PATH, STAGING_PATH])
      expect(deletionUpdateMany).toHaveBeenCalledWith({
        where: {
          object_path: { in: [SELFIE_PATH, STAGING_PATH] },
          OR: [{ repeat_until: null }, { repeat_until: { lt: earlierHorizon } }],
        },
        data: { repeat_until: earlierHorizon, not_before: NOW },
      })
      expect(remove).toHaveBeenCalledWith([SELFIE_PATH])
      expect(publish).not.toHaveBeenCalled()
    })

    /**
     * Review round 1, 2026-11-19 (TEA): commit is the only byte check, so a size mismatch names
     * itself (422 IMAGE_SIZE_MISMATCH); the other selfie mismatches keep their 400.
     */
    it('maps a size disagreement with the allocation to 422 IMAGE_SIZE_MISMATCH', async () => {
      const bytes = await selfiePng()
      const mismatched = selfieSession(bytes, {
        selfie_file_size_bytes: bytes.length + 1,
      })
      paletteFindUnique
        .mockResolvedValueOnce(mismatched) // assertConsent
        .mockResolvedValueOnce(mismatched) // local `profile`
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_SIZE_MISMATCH'))
      expectSelfieSessionEnded()
    })

    /**
     * Review round 2 (Codex C2-10): the object is read through a hard ceiling, and storage
     * holding more than the bucket limit is a size mismatch, never buffered whole.
     */
    it('treats a staged object past the byte ceiling as a size mismatch', async () => {
      const bytes = await selfiePng()
      const row = selfieSession(bytes)
      paletteFindUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row)
      downloadBounded.mockResolvedValueOnce({ status: 'too_large' })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_SIZE_MISMATCH'))
      expect(downloadBounded).toHaveBeenCalledWith(STAGING_PATH, MAX_GARMENT_IMAGE_BYTES)
      expectSelfieSessionEnded()
    })

    it('maps stored bytes of another type than declared to 415, and removes them', async () => {
      const jpegBytes = await sharp({
        create: {
          width: 300,
          height: 300,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .jpeg()
        .toBuffer()
      // Declared PNG; storage holds a JPEG of the same size and digest.
      const row = selfieSession(jpegBytes)
      paletteFindUnique
        .mockResolvedValueOnce(row) // assertConsent
        .mockResolvedValueOnce(row) // local `profile`
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes: jpegBytes })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
      expectSelfieSessionEnded()
    })

    it('claims the publication, verifies and publishes the staged bytes, moves the row on, hands the job off, then releases staging', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`
        .mockResolvedValueOnce(committedRow(bytes)) // getProfile() after the commit succeeds
      findUniqueOrThrow.mockResolvedValueOnce(committedRow(bytes)) // the handoff's read
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(USER_ID, 'guardian')
      expect(downloadBounded).toHaveBeenCalledWith(STAGING_PATH, MAX_GARMENT_IMAGE_BYTES)
      // Review round 2 (Codex C2-1, C2-9): the server writes exactly the verified buffer to the
      // final key with the verified type; nothing reads the staged object again.
      expect(publish).toHaveBeenCalledExactlyOnceWith(SELFIE_PATH, bytes, 'image/png')
      expect(paletteUpdateMany.mock.calls).toEqual([
        [
          {
            where: PUBLICATION_CLAIM_WHERE,
            data: {
              selfie_publish_attempt_id: expect.any(String),
              selfie_publish_started_at: NOW,
              selfie_publish_cleanup_until: CLEANUP_HORIZON,
            },
          },
        ],
        // Only the attempt that owns the publication moves the row on, recording its analysis
        // attempt (the session) and an empty handoff marker.
        [
          {
            where: {
              id: 'profile-1',
              selfie_upload_session_id: SESSION_ID,
              selfie_publish_attempt_id: publishAttemptId(),
              status: { in: ['pending_upload', 'bytes_uploaded'] },
            },
            data: {
              status: 'processing',
              source: 'selfie',
              selfie_committed_at: NOW,
              selfie_commit_idempotency_key: 'key-1',
              selfie_publish_attempt_id: null,
              selfie_publish_started_at: null,
              analysis_attempt_id: SESSION_ID,
              processing_job_enqueued_at: null,
              revision: { increment: 1 },
            },
          },
        ],
        [
          {
            where: {
              id: 'profile-1',
              status: 'processing',
              analysis_attempt_id: SESSION_ID,
              processing_job_enqueued_at: null,
            },
            data: { processing_job_enqueued_at: NOW },
          },
        ],
      ])
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      // Claim before any storage I/O; publish before the row moves on; the job handoff before
      // any cleanup (Codex C3-5); staging released last (Codex C2-5).
      const claimOrder = paletteUpdateMany.mock.invocationCallOrder
      expect(claimOrder[0]).toBeLessThan(downloadBounded.mock.invocationCallOrder[0]!)
      expect(publish.mock.invocationCallOrder[0]).toBeLessThan(claimOrder[1]!)
      expect(claimOrder[1]).toBeLessThan(enqueue.mock.invocationCallOrder[0]!)
      expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
        remove.mock.invocationCallOrder[0]!
      )
      expect(recordedDeletions()).toEqual([STAGING_PATH])
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(result.replayed).toBe(false)
    })

    it('enqueues processing for a legacy bytes_uploaded session past its upload window', async () => {
      const bytes = await selfiePng()
      const uploadedRow = selfieSession(bytes, {
        status: 'bytes_uploaded',
        selfie_upload_expires_at: ALREADY_EXPIRED,
      })
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
      paletteFindUnique
        .mockResolvedValueOnce(uploadedRow) // assertConsent
        .mockResolvedValueOnce(uploadedRow) // local `profile`
        .mockResolvedValueOnce(committedRow(bytes)) // getProfile() after the commit succeeds
      findUniqueOrThrow.mockResolvedValueOnce(committedRow(bytes))

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      // Its bytes already sit at the final path: verified there, never published again.
      expect(downloadBounded).toHaveBeenCalledWith(SELFIE_PATH, MAX_GARMENT_IMAGE_BYTES)
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      expect(result.replayed).toBe(false)
    })

    /**
     * Round 4 (Codex C3-1): another commit of the same session owns its publication. This one
     * touches no storage at all, and answers UPLOAD_IN_PROGRESS so the client keeps its attempt
     * and replays the owner's outcome later.
     */
    it('answers 409 UPLOAD_IN_PROGRESS without touching storage while another attempt owns the publication', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      const publishing = selfieSession(bytes, {
        selfie_publish_attempt_id: 'owning-attempt',
        selfie_publish_started_at: new Date(NOW.getTime() - 10_000),
      })
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`
        .mockResolvedValueOnce(publishing) // reread after the claim matched nothing
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_IN_PROGRESS'))
      expect(paletteUpdateMany).toHaveBeenCalledOnce()
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 4 (Codex C3-1, "duplicate finishing after automatic purge"): two same-key commits
     * read the pending session. The first published, claimed, and its analysis finished and
     * purged the selfie. The second, arriving late, finds the publication gone with the session
     * terminal: it replays that outcome and never writes the final key again.
     */
    it('replays a duplicate same-key commit that arrives after the owner finished and the selfie was purged, and never publishes', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      const purged = selfieSession(bytes, {
        status: 'ready',
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.8,
        analysis_version: 'palette-advisor-v1',
        analyzed_at: new Date('2026-11-19T11:59:00.000Z'),
        selfie_commit_idempotency_key: 'key-1',
        selfie_purged_at: new Date('2026-11-19T11:59:00.000Z'),
      })
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`, read before the owner claimed
        .mockResolvedValueOnce(purged) // reread after the claim matched nothing
        .mockResolvedValueOnce(purged) // getProfile()
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
    })

    it('answers UPLOAD_SESSION_EXPIRED when the session ended before the publication claim', async () => {
      const bytes = await selfiePng()
      const uploadedRow = selfieSession(bytes, { status: 'bytes_uploaded' })
      paletteFindUnique
        .mockResolvedValueOnce(uploadedRow) // assertConsent
        .mockResolvedValueOnce(uploadedRow) // local `profile`
        .mockResolvedValueOnce(profileRow(CONSENTED)) // erased meanwhile: no session left
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 4 (Codex C3-5): an enqueue failure no longer rolls the claim back. The row stays
     * processing without its handoff marker, staging stays, and the same-key replay (or the
     * hourly maintenance job) enqueues under the same job id. Round 3 cleared the session and
     * forced a fresh allocation instead, and a function that stopped before its rollback left
     * the row processing with no job.
     */
    it('leaves the row processing without a handoff marker when the enqueue fails, for the replay to hand off', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`
      findUniqueOrThrow.mockResolvedValueOnce(committedRow(bytes))
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('redis unavailable')

      // The claim and the transition only: no rollback, no marker.
      expect(paletteUpdateMany).toHaveBeenCalledTimes(2)
      expect(paletteUpdateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'processing',
            processing_job_enqueued_at: null,
          }),
        })
      )
      expect(remove).not.toHaveBeenCalled()

      // The member's retry replays the commit and hands the job off.
      paletteUpdateMany.mockClear()
      paletteFindUnique
        .mockResolvedValueOnce(committedRow(bytes)) // assertConsent
        .mockResolvedValueOnce(committedRow(bytes)) // local `profile`
        .mockResolvedValueOnce(committedRow(bytes)) // getProfile()

      const replay = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(replay.replayed).toBe(true)
      expect(enqueue).toHaveBeenCalledTimes(2)
      expect(enqueue).toHaveBeenLastCalledWith('profile-1', SESSION_ID)
      expect(paletteUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'profile-1',
          status: 'processing',
          analysis_attempt_id: SESSION_ID,
          processing_job_enqueued_at: null,
        },
        data: { processing_job_enqueued_at: NOW },
      })
      expect(downloadBounded).toHaveBeenCalledOnce()
      expect(publish).toHaveBeenCalledOnce()
    })

    /**
     * Review round 2 (Codex C2-5): the session was replaced while this commit verified and
     * published, so nothing will claim the published selfie. The publish returned, so the write
     * has landed and is recorded and removed now.
     */
    it('removes the published selfie when a replacement took the session before the row moved on', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(
          selfieSession(bytes, { selfie_upload_session_id: REPLACEMENT_SESSION_ID })
        ) // reread after the lost transition
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
      paletteUpdateMany
        .mockResolvedValueOnce({ count: 1 }) // the publication claim
        .mockResolvedValueOnce({ count: 0 }) // the transition

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      // The claim is given back: the publish finished, nothing of this attempt is in flight.
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(3, {
        where: { id: 'profile-1', selfie_publish_attempt_id: publishAttemptId() },
        data: { selfie_publish_attempt_id: null, selfie_publish_started_at: null },
      })
      expect(recordedDeletions()).toEqual([SELFIE_PATH])
      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_PATH])
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Review round 2 (Codex C2-5): a transition lost to another commit of the same session
     * (one that took the publication over once this attempt's lease ran out) leaves the final
     * object to that commit and keeps staging.
     */
    it('keeps the published selfie and staging when the same session was claimed under another key', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(
          selfieSession(bytes, {
            status: 'processing',
            source: 'selfie',
            selfie_commit_idempotency_key: 'key-other',
          })
        )
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
      paletteUpdateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      expect(remove).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
    })

    it('replays the winner when a matching concurrent commit moved the row on first', async () => {
      const bytes = await selfiePng()
      const pendingRow = selfieSession(bytes)
      const committed = selfieSession(bytes, {
        status: 'processing',
        source: 'selfie',
        selfie_commit_idempotency_key: 'key-1',
      })
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(pendingRow)
        .mockResolvedValueOnce(committed) // reread after the lost transition
        .mockResolvedValueOnce(committed) // getProfile()
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
      paletteUpdateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Review round 2 (Codex C2-5), round 4: a crash between publish and the transition left the
     * final object, the staged one and a publication claim in place. Once that claim's lease has
     * run out, the retry takes the publication over (the claim's stale branch), verifies staging
     * and publishes the same bytes again.
     */
    it('takes over a stale publication on retry after a publish whose transition never ran', async () => {
      const bytes = await selfiePng()
      const crashed = selfieSession(bytes, {
        selfie_publish_attempt_id: 'crashed-attempt',
        selfie_publish_started_at: new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 1),
      })
      paletteFindUnique
        .mockResolvedValueOnce(crashed)
        .mockResolvedValueOnce(crashed)
        .mockResolvedValueOnce(committedRow(bytes)) // getProfile()
      findUniqueOrThrow.mockResolvedValueOnce(committedRow(bytes))
      downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(false)
      expect(paletteUpdateMany).toHaveBeenNthCalledWith(1, {
        where: PUBLICATION_CLAIM_WHERE,
        data: {
          selfie_publish_attempt_id: expect.any(String),
          selfie_publish_started_at: NOW,
          selfie_publish_cleanup_until: CLEANUP_HORIZON,
        },
      })
      expect(publishAttemptId()).not.toBe('crashed-attempt')
      expect(publish).toHaveBeenCalledExactlyOnceWith(SELFIE_PATH, bytes, 'image/png')
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
    })

    /**
     * Review round 2 (Codex C2-2): the stored path must be the one the row derives, and a row
     * that fails is retired as an expired session before any storage call. Round 2 answered
     * 500 UPLOAD_PATH_INVALID here.
     */
    it('refuses a row whose path names another member before any storage call', async () => {
      const bytes = await selfiePng()
      const row = selfieSession(bytes, { selfie_object_path: FOREIGN_PATH })
      paletteFindUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row)

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    /**
     * Round 4: the three orders two commits of one session can arrive in, each forced
     * explicitly. Only the attempt holding the publication claim touches storage; every other
     * attempt answers from the row.
     */
    describe('forced commit orders (round 4)', () => {
      afterEach(() => {
        // The row these orders hold lives in the shared doubles' implementations.
        paletteFindUnique.mockReset()
        findUniqueOrThrow.mockReset()
      })

      /**
       * One profile row that every read returns and every conditional write updates (a
       * `{ increment }` included), so the winner's commit leaves the row exactly as the next
       * commit reads it. The orders here run one attempt after the other, so each write matches.
       */
      function holdOneRow(initial: PaletteProfile): () => PaletteProfile {
        let row = initial
        paletteFindUnique.mockImplementation(() => Promise.resolve(row))
        ;(findUniqueOrThrow as Mock).mockImplementation(() => Promise.resolve(row))
        paletteUpdateMany.mockImplementation(
          ({ data }: { data: Record<string, unknown> }) => {
            const next: Record<string, unknown> = { ...row }
            for (const [column, value] of Object.entries(data)) {
              next[column] =
                value !== null && typeof value === 'object' && 'increment' in value
                  ? (next[column] as number) + (value as { increment: number }).increment
                  : value
            }
            row = next as unknown as PaletteProfile
            return Promise.resolve({ count: 1 })
          }
        )
        return () => row
      }

      it('5.4-API-070 answers a commit that meets another attempt live claim 409 UPLOAD_IN_PROGRESS with no storage call at all', async () => {
        const bytes = await selfiePng()
        const pendingRow = selfieSession(bytes)
        paletteFindUnique
          .mockResolvedValueOnce(pendingRow) // assertConsent
          .mockResolvedValueOnce(pendingRow) // local `profile`
          .mockResolvedValueOnce(
            selfieSession(bytes, {
              selfie_publish_attempt_id: 'owning-attempt',
              selfie_publish_started_at: new Date(NOW.getTime() - 10_000),
            })
          ) // reread after the claim matched nothing
        paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

        const failure = service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

        await expect(failure).rejects.toBeInstanceOf(ConflictException)
        await expect(failure).rejects.toThrow('UPLOAD_IN_PROGRESS')
        // The claim attempt is the only write, and it matched nothing.
        expect(paletteUpdateMany).toHaveBeenCalledExactlyOnceWith({
          where: PUBLICATION_CLAIM_WHERE,
          data: {
            selfie_publish_attempt_id: expect.any(String),
            selfie_publish_started_at: NOW,
            selfie_publish_cleanup_until: CLEANUP_HORIZON,
          },
        })
        expect(downloadBounded).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
        expect(createUploadSession).not.toHaveBeenCalled()
        expect(signReadUrl).not.toHaveBeenCalled()
        expect(deletionCreateMany).not.toHaveBeenCalled()
        expect(enqueue).not.toHaveBeenCalled()
      })

      it('5.4-API-071 refuses a different key after the winner finished 409 IDEMPOTENCY_KEY_REUSED and writes nothing to storage', async () => {
        const bytes = await selfiePng()
        const currentRow = holdOneRow(selfieSession(bytes))
        downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
        const winner = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
        expect(winner.replayed).toBe(false)
        expect(currentRow()).toMatchObject({
          status: 'processing',
          source: 'selfie',
          selfie_commit_idempotency_key: 'key-1',
          selfie_publish_attempt_id: null,
          processing_job_enqueued_at: NOW,
          revision: 1,
        })
        const rowWritesByWinner = paletteUpdateMany.mock.calls.length

        const loser = service.commitSelfie(USER_ID, 'guardian', input, 'key-2')

        await expect(loser).rejects.toBeInstanceOf(ConflictException)
        await expect(loser).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
        // Storage saw the winner's calls only: one read of staging, one publish of the
        // verified bytes, one release of staging.
        expect(downloadBounded).toHaveBeenCalledExactlyOnceWith(
          STAGING_PATH,
          MAX_GARMENT_IMAGE_BYTES
        )
        expect(publish).toHaveBeenCalledExactlyOnceWith(SELFIE_PATH, bytes, 'image/png')
        expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        expect(enqueue).toHaveBeenCalledOnce()
        // The loser wrote nothing to the row either; it still holds the winner's commit.
        expect(paletteUpdateMany).toHaveBeenCalledTimes(rowWritesByWinner)
        expect(currentRow()).toMatchObject({
          status: 'processing',
          selfie_commit_idempotency_key: 'key-1',
          revision: 1,
        })
      })

      it('5.4-API-072 replays the winner key after it finished with the same body and no second download or publish', async () => {
        const bytes = await selfiePng()
        holdOneRow(selfieSession(bytes))
        downloadBounded.mockResolvedValueOnce({ status: 'present', bytes })
        const winner = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

        const replay = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

        expect(winner.replayed).toBe(false)
        expect(replay.replayed).toBe(true)
        expect(replay.response).toEqual(winner.response)
        expect(winner.response.data).toMatchObject({
          profileId: 'profile-1',
          hasConsent: true,
          analysis: { status: 'processing', source: 'selfie' },
          recommendations: [],
        })
        expect(downloadBounded).toHaveBeenCalledExactlyOnceWith(
          STAGING_PATH,
          MAX_GARMENT_IMAGE_BYTES
        )
        expect(publish).toHaveBeenCalledExactlyOnceWith(SELFIE_PATH, bytes, 'image/png')
        expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        expect(signReadUrl).not.toHaveBeenCalled()
        // The winner recorded its job handoff, so the replay enqueues nothing again.
        expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      })
    })
  })

  describe('updateRecommendation', () => {
    it('upserts a saved state and emits telemetry', async () => {
      paletteFindUnique.mockResolvedValueOnce(null)

      await service.updateRecommendation(USER_ID, {
        itemKey: 'advisor:jewelry:warm',
        slot: 'jewelry',
        action: 'saved',
      })

      expect(stateUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ action: 'saved' }),
          update: { action: 'saved' },
        })
      )
      expect(captureEvent).toHaveBeenCalledWith(USER_ID, 'advisor_recommendation_acted', {
        slot: 'jewelry',
        action: 'saved',
      })
    })

    it('deletes the row when action is null, without emitting telemetry', async () => {
      paletteFindUnique.mockResolvedValueOnce(null)

      await service.updateRecommendation(USER_ID, {
        itemKey: 'advisor:jewelry:warm',
        slot: 'jewelry',
        action: null,
      })

      expect(stateDeleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID, slot: 'jewelry', item_key: 'advisor:jewelry:warm' },
      })
      expect(stateUpsert).not.toHaveBeenCalled()
      expect(captureEvent).not.toHaveBeenCalled()
    })

    it('fails open when telemetry emission throws', async () => {
      paletteFindUnique.mockResolvedValueOnce(null)
      captureEvent.mockRejectedValueOnce(new Error('telemetry down'))

      await expect(
        service.updateRecommendation(USER_ID, {
          itemKey: 'advisor:jewelry:warm',
          slot: 'jewelry',
          action: 'dismissed',
        })
      ).resolves.toBeDefined()
    })
  })

  describe('erase', () => {
    it('clears state, revokes consent, and purges a retained selfie object', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, status: 'ready', selfie_object_path: SELFIE_PATH })
        )
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))

      await service.erase(USER_ID)

      expect(stateDeleteMany).toHaveBeenCalledWith({ where: { user_id: USER_ID } })
      expect(paletteUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            source: null,
            selfie_object_path: null,
          }),
        })
      )
      expect(recordedDeletions()).toEqual([SELFIE_PATH])
      expect(remove).toHaveBeenCalledExactlyOnceWith([SELFIE_PATH])
      expect(deletionDelete).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion:${SELFIE_PATH}` },
      })
      expect(outbox.size).toBe(0)
    })

    /**
     * Review round 2 (Codex C2-4): erasure takes the per-member lock allocation takes before it
     * reads any path, so a replacement that committed first is the row it reads, and the keys
     * it records are that replacement's, not a snapshot taken before the transaction.
     */
    it('records the keys of a replacement that won the lock, read under the lock', async () => {
      const replacementPath = `wardrobe/${USER_ID}/palette/${REPLACEMENT_SESSION_ID}.png`
      const replacementStaging = `staging/${USER_ID}/palette/${REPLACEMENT_SESSION_ID}.png`
      paletteFindUnique
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'processing',
            source: 'selfie',
            selfie_object_path: replacementPath,
            selfie_upload_session_id: REPLACEMENT_SESSION_ID,
            selfie_mime_type: 'image/png',
          })
        ) // read inside the transaction, after the lock
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() })) // getProfile()

      await service.erase(USER_ID)

      // The advisory lock, then the row lock (round 4), both before the read.
      expect(executeRaw).toHaveBeenCalledOnce()
      expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        paletteFindUnique.mock.invocationCallOrder[0]!
      )
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        paletteFindUnique.mock.invocationCallOrder[0]!
      )
      expect(recordedDeletions()).toEqual([replacementPath, replacementStaging])
      expect(deletionCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
        auditLogCreate.mock.invocationCallOrder[0]!
      )
      expect(remove.mock.calls).toEqual([[[replacementPath]], [[replacementStaging]]])
    })

    /**
     * Round 5 (Codex C4-5, "an outstanding publish finishing after erasure with a lost
     * response"): a commit owns the session's publication and may still write the final key
     * after this erasure, its acknowledgement lost so it never compensates, and storage may
     * finish that write after the lease. Erasure removes the current final and staging keys at
     * once, and the removal repeats every 15 minutes until 24 hours after the lease start, so
     * the late write is removed whenever it lands. Round 4 left the current object readable
     * until the lease ended and settled after a single removal.
     */
    describe('during an unfinished publication', () => {
      const NOW = new Date('2026-11-19T12:00:00.000Z')
      const CLAIMED_AT = new Date(NOW.getTime() - 5_000)
      const HORIZON = new Date(CLAIMED_AT.getTime() + 24 * 60 * 60 * 1000)
      const FIFTEEN_MINUTES = 15 * 60 * 1000
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('removes the selfie now, removes a late write when it lands, and settles only after the horizon', async () => {
        paletteFindUnique
          .mockResolvedValueOnce(
            profileRow({
              ...CONSENTED,
              status: 'pending_upload',
              selfie_object_path: SELFIE_PATH,
              selfie_upload_session_id: SESSION_ID,
              selfie_mime_type: 'image/png',
              selfie_publish_attempt_id: 'owning-attempt',
              selfie_publish_started_at: CLAIMED_AT,
            })
          )
          .mockResolvedValueOnce(profileRow({ consent_revoked_at: NOW }))

        await service.erase(USER_ID)

        expect(paletteUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              selfie_publish_attempt_id: null,
              selfie_publish_started_at: null,
              analysis_attempt_id: null,
            }),
          })
        )
        expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith({
          data: [
            {
              object_path: SELFIE_PATH,
              reason: 'selfie_erased',
              not_before: NOW,
              repeat_until: HORIZON,
            },
            {
              object_path: STAGING_PATH,
              reason: 'selfie_erased',
              not_before: NOW,
              repeat_until: HORIZON,
            },
          ],
          skipDuplicates: true,
        })
        // An already recorded key takes the later horizon and is due now.
        expect(deletionUpdateMany).toHaveBeenCalledExactlyOnceWith({
          where: {
            object_path: { in: [SELFIE_PATH, STAGING_PATH] },
            OR: [{ repeat_until: null }, { repeat_until: { lt: HORIZON } }],
          },
          data: { repeat_until: HORIZON, not_before: NOW },
        })
        // The current generation is gone at once.
        expect(remove.mock.calls).toEqual([[[SELFIE_PATH]], [[STAGING_PATH]]])
        expect(outbox.size).toBe(2)

        // Hours later, past the lease, the late publish lands; the next repeat removes it and
        // keeps the obligation.
        const outbox$ = new WardrobeObjectDeletionOutbox(prisma, storage)
        const later = new Date(NOW.getTime() + 6 * 60 * 60 * 1000)
        vi.setSystemTime(later)
        deletionFindMany.mockResolvedValueOnce([...outbox.values()])
        expect(await outbox$.drainDue(later)).toBe(2)
        expect(remove.mock.calls.slice(2)).toEqual([[[SELFIE_PATH]], [[STAGING_PATH]]])
        expect([...outbox.values()].map((row) => row.not_before)).toEqual([
          new Date(later.getTime() + FIFTEEN_MINUTES),
          new Date(later.getTime() + FIFTEEN_MINUTES),
        ])

        // The first removal past the horizon settles the rows.
        const pastHorizon = new Date(HORIZON.getTime() + 1)
        vi.setSystemTime(pastHorizon)
        deletionFindMany.mockResolvedValueOnce([...outbox.values()])
        expect(await outbox$.drainDue(pastHorizon)).toBe(2)
        expect(remove).toHaveBeenCalledTimes(6)
        expect(outbox.size).toBe(0)
      })
    })

    /**
     * Review round 2 (Codex C2-4): a transient storage failure no longer discards the only
     * cleanup record. The row stays, with its attempt counted and pushed back, and the hourly
     * drain removes the selfie later.
     */
    it('keeps a failed removal recorded until the hourly drain removes it', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, status: 'ready', selfie_object_path: SELFIE_PATH })
        )
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))
      remove.mockRejectedValueOnce(new Error('storage down'))
      const before = Date.now()

      await expect(service.erase(USER_ID)).resolves.toMatchObject({ hasConsent: false })

      expect(recordedDeletions()).toEqual([SELFIE_PATH])
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(deletionUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: { object_path: SELFIE_PATH },
        data: {
          attempts: { increment: 1 },
          last_error: 'Error',
          not_before: expect.any(Date),
        },
      })
      const [{ data }] = deletionUpdateMany.mock.calls[0] as [
        { data: { not_before: Date } },
      ]
      expect(data.not_before.getTime()).toBeGreaterThan(before)

      // The fake outbox has no `updateMany`; mirror the pushed-back row the drain reads.
      const row = outbox.get(SELFIE_PATH)!
      outbox.set(SELFIE_PATH, { ...row, attempts: 1, not_before: data.not_before })
      deletionFindMany.mockResolvedValueOnce([outbox.get(SELFIE_PATH)])
      const drained = await new WardrobeObjectDeletionOutbox(prisma, storage).drainDue(
        new Date(data.not_before.getTime() + 1)
      )

      expect(drained).toBe(1)
      expect(remove).toHaveBeenLastCalledWith([SELFIE_PATH])
      expect(deletionDelete).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion:${SELFIE_PATH}` },
      })
    })

    /** Review round 1, 2026-11-19 (Codex 1): erasure never removes another member's object. */
    it('never removes a selfie path naming another member', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, selfie_object_path: FOREIGN_PATH })
        )
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))

      await service.erase(USER_ID)

      expect(remove).not.toHaveBeenCalled()
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(paletteUpsert).toHaveBeenCalledOnce()
    })

    /** Review round 1, 2026-11-19: a pending session's unverified bytes go with the erasure. */
    it('removes a pending session staging key along with the selfie', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            status: 'pending_upload',
            selfie_object_path: SELFIE_PATH,
            selfie_upload_session_id: SESSION_ID,
            selfie_mime_type: 'image/png',
          })
        )
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))

      await service.erase(USER_ID)

      expect(remove.mock.calls).toEqual([[[SELFIE_PATH]], [[STAGING_PATH]]])
    })

    it('skips storage removal when there is nothing stored', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow())
        .mockResolvedValueOnce(profileRow({ consent_revoked_at: new Date() }))

      await service.erase(USER_ID)

      expect(remove).not.toHaveBeenCalled()
    })
  })
})
