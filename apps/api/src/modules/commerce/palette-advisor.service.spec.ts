// Story 5.4 Task 5/6: PaletteAdvisorService, mirroring
// wardrobe-silhouette.service.spec.ts's mocking shape for the upload
// lifecycle, plus coverage for consent, wardrobe analysis, recommendations,
// and erasure that have no sibling to mirror.
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions read vi.fn() members off their mock object, the established pattern for these suites. */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
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
import type { WardrobeStorage } from '../wardrobe/wardrobe-storage.adapter.js'
import type { AffiliateOfferService } from './affiliate-offer.service.js'
import type { PaletteAnalysisProcessingQueue } from './palette-analysis-processing.queue.js'
import { PaletteAdvisorService } from './palette-advisor.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'

const USER_ID = 'user-1'
const SESSION_ID = 'session-1'

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

  const prisma = {
    paletteProfile: {
      findUnique: paletteFindUnique,
      update: paletteUpdate,
      updateMany: paletteUpdateMany,
      upsert: paletteUpsert,
    },
    advisorRecommendationState: {
      findMany: stateFindMany,
      deleteMany: stateDeleteMany,
      upsert: stateUpsert,
    },
    auditLog: { create: auditLogCreate },
    $executeRaw: executeRaw,
    $transaction: vi.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => Promise<unknown>)(prisma)
    ),
  } as unknown as PrismaClient

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

  const upload = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  const storage = { upload, remove } as unknown as WardrobeStorage

  let service: PaletteAdvisorService

  beforeEach(() => {
    vi.clearAllMocks()
    hasPremiumAccess.mockResolvedValue(true)
    getFeatureFlag.mockResolvedValue(true)
    captureEvent.mockResolvedValue(undefined)
    assertWardrobeUploadAllowed.mockResolvedValue(undefined)
    resolveAdvisorOffers.mockResolvedValue(new Map())
    enqueue.mockResolvedValue(undefined)
    upload.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
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
      paletteFindUnique.mockResolvedValueOnce(
        profileRow({ ...CONSENTED, status: 'processing' })
      )
      // Consent read carries the status too (assertConsent's own findUnique
      // IS the row analyzeWardrobe branches on), so the flag stays enabled
      // here -- otherwise the disabled check would fire first.

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow(
        PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE
      )
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('marks the profile processing and enqueues on the happy path', async () => {
      paletteFindUnique
        .mockResolvedValueOnce(profileRow(CONSENTED))
        .mockResolvedValueOnce(
          profileRow({ ...CONSENTED, status: 'processing', source: 'wardrobe' })
        )

      await service.analyzeWardrobe(USER_ID)

      expect(paletteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID },
          data: expect.objectContaining({ source: 'wardrobe', status: 'processing' }),
        })
      )
      expect(enqueue).toHaveBeenCalledWith('profile-1', expect.any(String))
    })

    it('releases the processing claim when the enqueue fails', async () => {
      paletteFindUnique.mockResolvedValueOnce(profileRow(CONSENTED))
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

      await expect(service.analyzeWardrobe(USER_ID)).rejects.toThrow('redis unavailable')

      expect(paletteUpdateMany).toHaveBeenCalledWith({
        where: { id: 'profile-1', status: 'processing' },
        data: { status: null, source: null },
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

    it('allocates a fresh session and issues a verifiable upload token', async () => {
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

      expect(result.replayed).toBe(false)
      expect(result.response.data.uploadToken).toEqual(expect.any(String))
      expect(result.response.data.requiredHeaders['content-type']).toBe('image/png')
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
            selfie_object_path: 'palette/user-1/selfie/old.png',
            selfie_upload_idempotency_key: 'key-0',
          })
        )
      paletteUpdate.mockImplementationOnce(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(profileRow({ ...CONSENTED, ...data }))
      )

      await service.createSelfieUploadUrl(USER_ID, 'guardian', input, 'key-1')

      expect(remove).toHaveBeenCalledWith(['palette/user-1/selfie/old.png'])
    })
  })

  describe('uploadSelfieBytes', () => {
    it('refuses when the flag is disabled', async () => {
      getFeatureFlag.mockResolvedValueOnce(false)

      await expect(
        service.uploadSelfieBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          1,
          Buffer.alloc(1)
        )
      ).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(paletteFindUnique).not.toHaveBeenCalled()
    })

    it('rejects an unknown upload session with 404', async () => {
      paletteFindUnique.mockResolvedValueOnce(null)

      await expect(
        service.uploadSelfieBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          1,
          Buffer.alloc(1)
        )
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('stores the bytes and claims the session on the happy path', async () => {
      const bytes = await selfiePng()
      const profile = profileRow({
        ...CONSENTED,
        status: 'pending_upload',
        selfie_object_path: 'palette/user-1/selfie/session-1.png',
        selfie_upload_session_id: SESSION_ID,
        selfie_upload_expires_at: NOT_YET_EXPIRED,
        selfie_file_size_bytes: bytes.length,
        selfie_mime_type: 'image/png',
        selfie_content_sha256: createHash('sha256').update(bytes).digest('hex'),
        selfie_width_px: 300,
        selfie_height_px: 300,
      })
      paletteFindUnique.mockResolvedValueOnce(profile)
      paletteUpdateMany.mockResolvedValueOnce({ count: 1 })

      const { generateUploadToken, requireUploadTokenSecret } = await import(
        '../wardrobe/wardrobe-upload-token.js'
      )
      const token = generateUploadToken(
        SESSION_ID,
        USER_ID,
        NOT_YET_EXPIRED.toISOString(),
        requireUploadTokenSecret()
      )

      await service.uploadSelfieBytes(
        SESSION_ID,
        token,
        USER_ID,
        'guardian',
        'image/png',
        bytes.length,
        bytes
      )

      expect(upload).toHaveBeenCalledWith(
        'palette/user-1/selfie/session-1.png',
        bytes,
        'image/png'
      )
      expect(paletteUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'profile-1',
            selfie_upload_session_id: SESSION_ID,
            status: 'pending_upload',
          },
          data: { status: 'bytes_uploaded' },
        })
      )
    })

    it('removes the stored object when a concurrent caller won the session', async () => {
      const bytes = await selfiePng()
      const profile = profileRow({
        ...CONSENTED,
        status: 'pending_upload',
        selfie_object_path: 'palette/user-1/selfie/session-1.png',
        selfie_upload_session_id: SESSION_ID,
        selfie_upload_expires_at: NOT_YET_EXPIRED,
        selfie_file_size_bytes: bytes.length,
        selfie_mime_type: 'image/png',
        selfie_content_sha256: createHash('sha256').update(bytes).digest('hex'),
        selfie_width_px: 300,
        selfie_height_px: 300,
      })
      paletteFindUnique.mockResolvedValueOnce(profile)
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      const { generateUploadToken, requireUploadTokenSecret } = await import(
        '../wardrobe/wardrobe-upload-token.js'
      )
      const token = generateUploadToken(
        SESSION_ID,
        USER_ID,
        NOT_YET_EXPIRED.toISOString(),
        requireUploadTokenSecret()
      )

      await expect(
        service.uploadSelfieBytes(
          SESSION_ID,
          token,
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toThrow('UPLOAD_TOKEN_CONSUMED')
      expect(remove).toHaveBeenCalledWith(['palette/user-1/selfie/session-1.png'])
    })

    it('maps a checksum mismatch to a 400', async () => {
      const bytes = await selfiePng()
      const profile = profileRow({
        ...CONSENTED,
        status: 'pending_upload',
        selfie_object_path: 'palette/user-1/selfie/session-1.png',
        selfie_upload_session_id: SESSION_ID,
        selfie_upload_expires_at: NOT_YET_EXPIRED,
        selfie_file_size_bytes: bytes.length,
        selfie_mime_type: 'image/png',
        selfie_content_sha256: 'f'.repeat(64),
        selfie_width_px: 300,
        selfie_height_px: 300,
      })
      paletteFindUnique.mockResolvedValueOnce(profile)

      const { generateUploadToken, requireUploadTokenSecret } = await import(
        '../wardrobe/wardrobe-upload-token.js'
      )
      const token = generateUploadToken(
        SESSION_ID,
        USER_ID,
        NOT_YET_EXPIRED.toISOString(),
        requireUploadTokenSecret()
      )

      await expect(
        service.uploadSelfieBytes(
          SESSION_ID,
          token,
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toThrow('IMAGE_CHECKSUM_MISMATCH')
      expect(upload).not.toHaveBeenCalled()
    })
  })

  describe('commitSelfie', () => {
    const input = { uploadSessionId: SESSION_ID }

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
      })
      paletteFindUnique
        .mockResolvedValueOnce(processingRow) // assertConsent
        .mockResolvedValueOnce(processingRow) // local `profile`
        .mockResolvedValueOnce(processingRow) // getProfile() on the replay path

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(enqueue).not.toHaveBeenCalled()
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

    it('rejects a commit before the bytes were uploaded', async () => {
      const pendingRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'pending_upload',
      })
      paletteFindUnique
        .mockResolvedValueOnce(pendingRow) // assertConsent
        .mockResolvedValueOnce(pendingRow) // local `profile`

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('enqueues processing keyed on the upload session on the happy path', async () => {
      const uploadedRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'bytes_uploaded',
      })
      paletteFindUnique
        .mockResolvedValueOnce(uploadedRow) // assertConsent
        .mockResolvedValueOnce(uploadedRow) // local `profile`
        .mockResolvedValueOnce(
          profileRow({
            ...CONSENTED,
            selfie_upload_session_id: SESSION_ID,
            status: 'processing',
            source: 'selfie',
          })
        ) // getProfile() after the commit succeeds
      paletteUpdateMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.commitSelfie(USER_ID, 'guardian', input, 'key-1')

      expect(enqueue).toHaveBeenCalledWith('profile-1', SESSION_ID)
      expect(result.replayed).toBe(false)
    })

    it('reports a lost commit race as a conflict', async () => {
      const uploadedRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'bytes_uploaded',
      })
      paletteFindUnique
        .mockResolvedValueOnce(uploadedRow) // assertConsent
        .mockResolvedValueOnce(uploadedRow) // local `profile`
      paletteUpdateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(ConflictException)
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('releases the claim when the enqueue fails', async () => {
      const uploadedRow = profileRow({
        ...CONSENTED,
        selfie_upload_session_id: SESSION_ID,
        status: 'bytes_uploaded',
      })
      paletteFindUnique
        .mockResolvedValueOnce(uploadedRow) // assertConsent
        .mockResolvedValueOnce(uploadedRow) // local `profile`
      paletteUpdateMany.mockResolvedValueOnce({ count: 1 })
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))
      paletteUpdateMany.mockResolvedValueOnce({ count: 1 })

      await expect(
        service.commitSelfie(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('redis unavailable')

      expect(paletteUpdateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', status: 'processing' },
        data: expect.objectContaining({
          status: 'bytes_uploaded',
          source: null,
          selfie_upload_session_id: null,
        }),
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
          profileRow({ ...CONSENTED, selfie_object_path: 'palette/user-1/selfie/x.png' })
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
      expect(remove).toHaveBeenCalledWith(['palette/user-1/selfie/x.png'])
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
