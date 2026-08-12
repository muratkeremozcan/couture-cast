// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import { createHash, createHmac } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type GarmentItem, type PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import type { GuardianService } from '../guardian/guardian.service'
import type { RitualService } from '../personalization/ritual.service'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { WardrobeService } from './wardrobe.service'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'

const USER_ID = 'user-123'
const OTHER_USER_ID = 'other-user-456'
const GARMENT_ID = 'garment-123'
const SESSION_ID = 'session-123'
const IDEMPOTENCY_KEY = '34eff0f2-39b2-454e-b6b1-44a9ebfdb8ec' // gitleaks:allow
const UPLOAD_SECRET = 'wardrobe-test-secret-at-least-32-bytes' // gitleaks:allow
const FIXTURE_NOW = new Date('2026-08-04T09:25:00.000Z')
const FIXTURE_EXPIRY = new Date('2026-08-04T09:35:00.000Z')

type MockGarmentRepository = {
  create: Mock
  findMany: Mock
  findUnique: Mock
  findUniqueOrThrow: Mock
  updateMany: Mock
}

type MockPrisma = {
  garmentItem: MockGarmentRepository
  $transaction: Mock
}

type GarmentFixture = GarmentItem & {
  object_path: string
  file_size_bytes: number
  mime_type: string
  content_sha256: string
  width_px: number
  height_px: number
  upload_expires_at: Date
  consent_checked_at: Date
}

function garmentFixture<T extends Partial<GarmentItem> = Record<never, never>>(
  overrides = {} as T
): Omit<GarmentFixture, keyof T> & T {
  return {
    id: GARMENT_ID,
    user_id: USER_ID,
    image_url: null,
    object_path: `wardrobe/${USER_ID}/${GARMENT_ID}.png`,
    category: null,
    material: null,
    comfort_range: null,
    color_palette: null,
    tag_suggestions: null,
    tagging_model_version: null,
    tag_suggested_at: null,
    tags_confirmed_at: null,
    tagging_failure_code: null,
    tagging_telemetry_emitted_at: null,
    upload_session_id: SESSION_ID,
    upload_idempotency_key: IDEMPOTENCY_KEY,
    commit_idempotency_key: null,
    commit_payload_hash: null,
    upload_status: 'pending_upload',
    retention_status: 'active',
    retention_trigger: null,
    deletion_requested_at: null,
    file_size_bytes: 0,
    mime_type: 'image/png',
    content_sha256: '',
    width_px: 300,
    height_px: 300,
    upload_expires_at: FIXTURE_EXPIRY,
    consent_checked_at: FIXTURE_NOW,
    committed_at: null,
    has_cropping: false,
    has_bg_cleanup: false,
    completion_telemetry_emitted_at: null,
    processing_job_enqueued_at: null,
    failure_code: null,
    created_at: FIXTURE_NOW,
    updated_at: FIXTURE_NOW,
    ...overrides,
  } as Omit<GarmentFixture, keyof T> & T
}

function uploadToken(expiresAt: Date, userId = USER_ID): string {
  return createHmac('sha256', UPLOAD_SECRET)
    .update(`${SESSION_ID}.${userId}.${expiresAt.toISOString()}`)
    .digest('base64url')
}

function createWardrobeServiceHarness(validImage: Buffer) {
  const garmentItem: MockGarmentRepository = {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  }
  const mockPrisma: MockPrisma = {
    garmentItem,
    $transaction: vi.fn(async (callback: (tx: MockPrisma) => Promise<unknown>) =>
      callback(mockPrisma)
    ),
  }
  const telemetryCapture = vi.fn().mockResolvedValue(undefined)
  const guardianAuthorization = vi.fn().mockResolvedValue(undefined)
  const storageUpload = vi.fn().mockResolvedValue(undefined)
  const storageDownload = vi.fn().mockResolvedValue(validImage)
  const storageSignReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed.png')
  const storageRemove = vi.fn().mockResolvedValue(undefined)
  const enqueue = vi.fn().mockResolvedValue(undefined)
  const invalidateUserCache = vi.fn().mockResolvedValue(true)

  const service = new WardrobeService(
    mockPrisma as unknown as PrismaClient,
    { captureEvent: telemetryCapture } as unknown as TelemetryService,
    { assertWardrobeUploadAllowed: guardianAuthorization } as unknown as GuardianService,
    {
      upload: storageUpload,
      download: storageDownload,
      signReadUrl: storageSignReadUrl,
      remove: storageRemove,
    } as unknown as SupabaseWardrobeStorageAdapter,
    { enqueue } as unknown as WardrobeProcessingQueue,
    { invalidateUserCache } as unknown as RitualService
  )

  return {
    enqueue,
    mockPrisma,
    service,
    storageDownload,
    storageUpload,
    telemetryCapture,
  }
}

describe('WardrobeService', () => {
  let validImage: Buffer
  let validSha256: string
  let mockPrisma: MockPrisma
  let telemetryCapture: Mock
  let storageUpload: Mock
  let storageDownload: Mock
  let enqueue: Mock
  let service: WardrobeService

  beforeAll(async () => {
    validImage = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 80, g: 120, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    validSha256 = createHash('sha256').update(validImage).digest('hex')
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXTURE_NOW)

    vi.stubEnv('WARDROBE_UPLOAD_TOKEN_SECRET', UPLOAD_SECRET)
    ;({ enqueue, mockPrisma, service, storageDownload, storageUpload, telemetryCapture } =
      createWardrobeServiceHarness(validImage))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('createUploadUrl', () => {
    const declaration = {
      fileSizeBytes: 1024,
      mimeType: 'image/png' as const,
      sha256: 'a'.repeat(64),
      widthPx: 500,
      heightPx: 500,
    }

    it('creates a private upload session with a user-scoped idempotency key', async () => {
      mockPrisma.garmentItem.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            garmentFixture({
              ...data,
              created_at: FIXTURE_NOW,
              updated_at: FIXTURE_NOW,
            })
          )
      )

      const result = await service.createUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(false)
      expect(result.response.data.uploadUrl).toContain('/api/v1/wardrobe/uploads/')
      expect(result.response.data.uploadToken).not.toHaveLength(0)
      expect(mockPrisma.garmentItem.findUnique).toHaveBeenCalledWith({
        where: {
          user_id_upload_idempotency_key: {
            user_id: USER_ID,
            upload_idempotency_key: IDEMPOTENCY_KEY,
          },
        },
      })
    })

    it('returns the same active session for a matching caller replay', async () => {
      const existing = garmentFixture({
        file_size_bytes: declaration.fileSizeBytes,
        content_sha256: declaration.sha256,
        width_px: declaration.widthPx,
        height_px: declaration.heightPx,
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(existing)

      const result = await service.createUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      expect(result.response.data.garmentId).toBe(GARMENT_ID)
      expect(result.response.data.uploadSessionId).toBe(SESSION_ID)
      expect(mockPrisma.garmentItem.create).not.toHaveBeenCalled()
    })

    it('does not disclose another caller upload session for the same key', async () => {
      const firstCallerGarment = garmentFixture({ user_id: USER_ID })
      mockPrisma.garmentItem.findUnique.mockImplementation(
        ({ where }: { where: Record<string, { user_id?: string }> }) =>
          Promise.resolve(
            where.user_id_upload_idempotency_key?.user_id === USER_ID
              ? firstCallerGarment
              : null
          )
      )
      mockPrisma.garmentItem.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            garmentFixture({
              ...data,
              id: 'second-caller-garment',
              user_id: OTHER_USER_ID,
              upload_session_id: 'second-caller-session',
              created_at: FIXTURE_NOW,
              updated_at: FIXTURE_NOW,
            })
          )
      )

      const result = await service.createUploadUrl(
        OTHER_USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(result.response.data.garmentId).toBe('second-caller-garment')
      expect(result.response.data.uploadSessionId).toBe('second-caller-session')
      expect(result.response.data).not.toEqual(
        expect.objectContaining({ garmentId: GARMENT_ID, uploadSessionId: SESSION_ID })
      )
    })

    it('preserves payload mismatch conflict behavior', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        garmentFixture({
          file_size_bytes: declaration.fileSizeBytes,
          content_sha256: declaration.sha256,
          width_px: declaration.widthPx,
          height_px: declaration.heightPx,
        })
      )

      await expect(
        service.createUploadUrl(
          USER_ID,
          'guardian',
          { ...declaration, fileSizeBytes: 2048 },
          IDEMPOTENCY_KEY
        )
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })
  })

  describe('uploadBytes', () => {
    function pendingUpload<T extends Partial<GarmentItem> = Record<never, never>>(
      overrides = {} as T
    ) {
      return garmentFixture({
        file_size_bytes: validImage.length,
        content_sha256: validSha256,
        width_px: 300,
        height_px: 300,
        ...overrides,
      })
    }

    it('rejects a missing session', async () => {
      await expect(
        service.uploadBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          validImage.length,
          validImage
        )
      ).rejects.toThrow(NotFoundException)
    })

    it('preserves cross-user ownership rejection', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ user_id: OTHER_USER_ID })
      )

      await expect(
        service.uploadBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          validImage.length,
          validImage
        )
      ).rejects.toThrow(ForbiddenException)
      expect(storageUpload).not.toHaveBeenCalled()
    })

    it('rejects a tampered upload token before persistence', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())

      await expect(
        service.uploadBytes(
          SESSION_ID,
          'tampered-token',
          USER_ID,
          'guardian',
          'image/png',
          validImage.length,
          validImage
        )
      ).rejects.toThrow('INVALID_UPLOAD_TOKEN')
      expect(storageUpload).not.toHaveBeenCalled()
      expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
    })

    it('treats a null expiry as an expired session before token validation', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ upload_expires_at: null })
      )

      await expect(
        service.uploadBytes(
          SESSION_ID,
          'tampered-token',
          USER_ID,
          'guardian',
          'image/png',
          validImage.length,
          validImage
        )
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('rejects an expired session when current system time exceeds upload_expires_at', async () => {
      const garment = pendingUpload({ upload_expires_at: FIXTURE_EXPIRY })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)
      const token = uploadToken(garment.upload_expires_at)

      // Advance system time past expiry window
      vi.setSystemTime(new Date(FIXTURE_EXPIRY.getTime() + 1000))

      await expect(
        service.uploadBytes(
          SESSION_ID,
          token,
          USER_ID,
          'guardian',
          'image/png',
          validImage.length,
          validImage
        )
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageUpload).not.toHaveBeenCalled()
    })

    it('enforces the declared byte count', async () => {
      const garment = pendingUpload()
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)

      await expect(
        service.uploadBytes(
          SESSION_ID,
          uploadToken(garment.upload_expires_at),
          USER_ID,
          'guardian',
          'image/png',
          validImage.length - 1,
          validImage
        )
      ).rejects.toThrow(BadRequestException)
      expect(storageUpload).not.toHaveBeenCalled()
    })

    it('verifies and stores image bytes before consuming the upload state', async () => {
      const garment = pendingUpload()
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)

      await service.uploadBytes(
        SESSION_ID,
        uploadToken(garment.upload_expires_at),
        USER_ID,
        'guardian',
        'image/png',
        validImage.length,
        validImage
      )

      expect(storageUpload).toHaveBeenCalledWith(
        garment.object_path,
        validImage,
        'image/png'
      )
      expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: GARMENT_ID,
          upload_status: 'pending_upload',
          retention_status: 'active',
        },
        data: {
          upload_status: 'bytes_uploaded',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          consent_checked_at: expect.any(Date),
        },
      })
    })
  })

  describe('commitGarment', () => {
    function uploadedGarment<T extends Partial<GarmentItem> = Record<never, never>>(
      overrides = {} as T
    ) {
      return garmentFixture({
        upload_status: 'bytes_uploaded',
        file_size_bytes: validImage.length,
        content_sha256: validSha256,
        width_px: 300,
        height_px: 300,
        upload_session_id: SESSION_ID,
        ...overrides,
      })
    }

    const commitInput = {
      garmentId: GARMENT_ID,
      uploadSessionId: SESSION_ID,
      hasCropping: true,
      hasBgCleanup: true,
    }

    it('rejects a mismatched upload session before mutation or telemetry', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(uploadedGarment())

      await expect(
        service.commitGarment(
          USER_ID,
          'guardian',
          { ...commitInput, uploadSessionId: 'mismatched-session' },
          IDEMPOTENCY_KEY
        )
      ).rejects.toThrow(ConflictException)
      expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
      expect(storageDownload).not.toHaveBeenCalled()
      expect(telemetryCapture).not.toHaveBeenCalled()
    })

    it('accepts only bytes_uploaded state for a new commit', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        uploadedGarment({ upload_status: 'pending_upload' })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('INVALID_GARMENT_COMMIT')
    })

    it('commits verified bytes, enqueues processing, signs the read URL, and emits telemetry', async () => {
      const initial = uploadedGarment()
      const committed = uploadedGarment({
        upload_status: 'processing',
        committed_at: new Date('2026-08-04T09:26:22.000Z'),
        commit_idempotency_key: IDEMPOTENCY_KEY,
        has_cropping: true,
        has_bg_cleanup: true,
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(initial)
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(committed)

      const result = await service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(false)
      expect(result.response.data.status).toBe('processing')
      expect(result.response.data.imageAccess?.url).toBe(
        'https://storage.test/signed.png'
      )
      expect(enqueue).toHaveBeenCalledWith(GARMENT_ID)
      expect(telemetryCapture).toHaveBeenCalledWith(
        USER_ID,
        'garment_upload_completed',
        expect.objectContaining({
          garmentId: GARMENT_ID,
          fileSizeBytes: validImage.length,
          mimeType: 'image/png',
          hasCropping: true,
          hasBgCleanup: true,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          durationMs: expect.any(Number),
        })
      )
    })

    it('retries a serializable commit transaction after a Prisma write conflict', async () => {
      const initial = uploadedGarment()
      const committed = uploadedGarment({
        upload_status: 'processing',
        committed_at: new Date('2026-08-04T09:26:22.000Z'),
        commit_idempotency_key: IDEMPOTENCY_KEY,
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(initial)
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(committed)
      mockPrisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Serializable write conflict', {
          code: 'P2034',
          clientVersion: '6.19.0',
        })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).resolves.toMatchObject({
        replayed: false,
        response: { data: { status: 'processing' } },
      })

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2)
      expect(enqueue).toHaveBeenCalledWith(GARMENT_ID)
    })

    it('replays the committed garment when a concurrent matching commit wins', async () => {
      const initial = uploadedGarment()
      const payloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            garmentId: commitInput.garmentId,
            uploadSessionId: commitInput.uploadSessionId,
            hasCropping: commitInput.hasCropping,
            hasBgCleanup: commitInput.hasBgCleanup,
          })
        )
        .digest('hex')
      const raced = uploadedGarment({
        upload_status: 'processing',
        committed_at: new Date('2026-08-04T09:26:22.000Z'),
        commit_idempotency_key: IDEMPOTENCY_KEY,
        commit_payload_hash: payloadHash,
        processing_job_enqueued_at: new Date('2026-08-04T09:26:23.000Z'),
      })
      mockPrisma.garmentItem.findUnique
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(raced)
      mockPrisma.$transaction.mockRejectedValueOnce(
        new ConflictException('UPLOAD_ALREADY_CLAIMED')
      )

      const result = await service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      expect(result.response.data.status).toBe('processing')
      expect(telemetryCapture).not.toHaveBeenCalled()
    })

    it('keeps a successful commit response when upload telemetry delivery fails', async () => {
      const initial = uploadedGarment()
      const committed = uploadedGarment({
        upload_status: 'processing',
        committed_at: new Date('2026-08-04T09:26:22.000Z'),
        commit_idempotency_key: IDEMPOTENCY_KEY,
        has_cropping: true,
        has_bg_cleanup: true,
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(initial)
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(committed)
      telemetryCapture.mockRejectedValueOnce(new Error('telemetry unavailable'))

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).resolves.toMatchObject({
        replayed: false,
        response: { data: { status: 'processing' } },
      })
    })
  })
})
