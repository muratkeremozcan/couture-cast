// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { createHash } from 'node:crypto'
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
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
import { PUBLISH_CLAIM_LEASE_MS } from './wardrobe-publication'
import {
  createDeletionTable,
  type DeletionTable,
} from '../../testing/wardrobe-object-deletion-table'

const USER_ID = 'user-123'
const OTHER_USER_ID = 'other-user-456'
// API-allocated ids are UUIDs; a row whose ids are not never reaches a storage key (round 3).
const GARMENT_ID = '9b2f6c1e-3d4a-4e5b-8c6d-7e8f9a0b1c2d'
const SESSION_ID = '4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const IDEMPOTENCY_KEY = '34eff0f2-39b2-454e-b6b1-44a9ebfdb8ec' // gitleaks:allow
const FIXTURE_NOW = new Date('2026-08-04T09:25:00.000Z')
const FIXTURE_EXPIRY = new Date('2026-08-04T09:35:00.000Z')
/** A storage signed upload token outlives the 15-minute session by default. */
const TOKEN_EXPIRY = new Date('2026-08-04T11:25:00.000Z')
const SIGNED_UPLOAD_URL =
  'https://project.supabase.test/storage/v1/object/upload/sign/wardrobe-images/garment.png?token=signed'
const SIGNED_UPLOAD_TOKEN = 'storage-signed-upload-token'
/**
 * Where the session's signed URL writes; never a final path (review round 1, 2026-11-19). Round 3
 * keys it by owner and kind too, under a top folder the bucket's read policy does not admit.
 */
const STAGING_PATH = `staging/${USER_ID}/garment/${SESSION_ID}.png`
const MAX_IMAGE_BYTES = 10_485_760
const FINAL_PATH = `wardrobe/${USER_ID}/${GARMENT_ID}.png`

type MockGarmentRepository = {
  create: Mock
  findFirst: Mock
  findMany: Mock
  findUnique: Mock
  findUniqueOrThrow: Mock
  updateMany: Mock
}

type MockPrisma = {
  garmentItem: MockGarmentRepository
  wardrobeObjectDeletion: DeletionTable
  $queryRaw: Mock
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
    publish_attempt_id: null,
    publish_started_at: null,
    upload_ended_at: null,
    held_source_sha256: null,
    held_source_captured_at: null,
    failure_code: null,
    created_at: FIXTURE_NOW,
    updated_at: FIXTURE_NOW,
    ...overrides,
  } as Omit<GarmentFixture, keyof T> & T
}

function createWardrobeServiceHarness(validImage: Buffer) {
  const garmentItem: MockGarmentRepository = {
    create: vi.fn(),
    // The outbox's read of a key's authoritative row; no row means nothing keeps the key.
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  }
  const mockPrisma: MockPrisma = {
    garmentItem,
    // Round 4: the outbox locks a key's row, then reads and settles its obligation.
    wardrobeObjectDeletion: createDeletionTable(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: MockPrisma) => Promise<unknown>) =>
      callback(mockPrisma)
    ),
  }
  const telemetryCapture = vi.fn().mockResolvedValue(undefined)
  const guardianAuthorization = vi.fn().mockResolvedValue(undefined)
  const storageCreateUploadSession = vi.fn().mockResolvedValue({
    uploadUrl: SIGNED_UPLOAD_URL,
    uploadToken: SIGNED_UPLOAD_TOKEN,
    tokenExpiresAt: TOKEN_EXPIRY,
  })
  const storageDownloadBounded = vi
    .fn()
    .mockResolvedValue({ status: 'present', bytes: validImage })
  const storageSignReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed.png')
  const storageRemove = vi.fn().mockResolvedValue(undefined)
  const storagePublish = vi.fn().mockResolvedValue(undefined)
  const enqueue = vi.fn().mockResolvedValue(undefined)
  const invalidateUserCache = vi.fn().mockResolvedValue(true)

  const service = new WardrobeService(
    mockPrisma as unknown as PrismaClient,
    { captureEvent: telemetryCapture } as unknown as TelemetryService,
    { assertWardrobeUploadAllowed: guardianAuthorization } as unknown as GuardianService,
    {
      createUploadSession: storageCreateUploadSession,
      downloadBounded: storageDownloadBounded,
      publish: storagePublish,
      signReadUrl: storageSignReadUrl,
      remove: storageRemove,
    } as unknown as SupabaseWardrobeStorageAdapter,
    { enqueue } as unknown as WardrobeProcessingQueue,
    { invalidateUserCache } as unknown as RitualService
  )

  return {
    enqueue,
    guardianAuthorization,
    mockPrisma,
    service,
    storageCreateUploadSession,
    storageDownloadBounded,
    storagePublish,
    storageRemove,
    storageSignReadUrl,
    telemetryCapture,
  }
}

describe('WardrobeService', () => {
  let validImage: Buffer
  let validSha256: string
  let mockPrisma: MockPrisma
  let telemetryCapture: Mock
  let guardianAuthorization: Mock
  let storageCreateUploadSession: Mock
  let storageDownloadBounded: Mock
  let storageRemove: Mock
  let storagePublish: Mock
  let storageSignReadUrl: Mock
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
    ;({
      enqueue,
      guardianAuthorization,
      mockPrisma,
      service,
      storageCreateUploadSession,
      storageDownloadBounded,
      storagePublish,
      storageRemove,
      storageSignReadUrl,
      telemetryCapture,
    } = createWardrobeServiceHarness(validImage))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Round 5 (Codex C4-4): a commit classifies and claims inside locked transactions of its own,
   * so the transition is told apart as the one serializable transaction.
   */
  function isTransition(options: unknown): boolean {
    return (
      (options as { isolationLevel?: unknown } | undefined)?.isolationLevel ===
      Prisma.TransactionIsolationLevel.Serializable
    )
  }

  /** The invocation orders of the commit transitions run so far. */
  function transitionOrders(): number[] {
    return mockPrisma.$transaction.mock.calls.flatMap(([, options], index) =>
      isTransition(options)
        ? [mockPrisma.$transaction.mock.invocationCallOrder[index]!]
        : []
    )
  }

  /** The next commit transition fails with `error`; every other transaction runs. */
  function failNextTransition(error: Error): void {
    const run = mockPrisma.$transaction.getMockImplementation()!
    let pending = true
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: MockPrisma) => Promise<unknown>, options?: unknown) => {
        if (pending && isTransition(options)) {
          pending = false
          return Promise.reject(error)
        }
        return run(callback, options) as Promise<unknown>
      }
    )
  }

  /**
   * The garment reads of a commit that moves the row on: the classification read, the claim
   * read and the transition's key-owner read see `initial`; the transition's result and the
   * response are read from `committed`.
   */
  function readsThenCommitted(initial: GarmentItem, committed: GarmentItem): void {
    mockPrisma.garmentItem.findUnique
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(committed)
    mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(committed)
  }

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
      // The storage signed upload URL as given: bytes never pass through an API function.
      expect(result.response.data.uploadUrl).toBe(SIGNED_UPLOAD_URL)
      expect(result.response.data.uploadToken).toBe(SIGNED_UPLOAD_TOKEN)
      const created = mockPrisma.garmentItem.create.mock.calls[0]?.[0] as {
        data: {
          id: string
          object_path: string
          upload_session_id: string
          upload_expires_at: Date
        }
      }
      expect(created.data.object_path).toBe(`wardrobe/${USER_ID}/${created.data.id}.png`)
      // Review round 1, 2026-11-19: the signed URL names a staging key, never the final path a
      // later delete, replacement or purge could see written again. Round 3 keys it by owner,
      // kind and session under staging/, which no member read policy admits.
      expect(storageCreateUploadSession).toHaveBeenCalledExactlyOnceWith(
        `staging/${USER_ID}/garment/${created.data.upload_session_id}.png`
      )
      // Signed before the row is written, so a storage outage leaves no session behind.
      expect(storageCreateUploadSession.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.garmentItem.create.mock.invocationCallOrder[0]!
      )
      // The 15-minute session ends before the 2-hour token, so the client is told the session.
      expect(result.response.data.expiresAt).toBe(
        created.data.upload_expires_at.toISOString()
      )
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
      // A replay signs a fresh URL for the same staging key.
      expect(storageCreateUploadSession).toHaveBeenCalledExactlyOnceWith(STAGING_PATH)
      expect(result.response.data.uploadUrl).toBe(SIGNED_UPLOAD_URL)
      expect(mockPrisma.garmentItem.create).not.toHaveBeenCalled()
    })

    it('tells the client the token expiry when storage signs a shorter token than the session', async () => {
      const existing = garmentFixture({
        file_size_bytes: declaration.fileSizeBytes,
        content_sha256: declaration.sha256,
        width_px: declaration.widthPx,
        height_px: declaration.heightPx,
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(existing)
      const shortToken = new Date(FIXTURE_EXPIRY.getTime() - 60_000)
      storageCreateUploadSession.mockResolvedValueOnce({
        uploadUrl: SIGNED_UPLOAD_URL,
        uploadToken: SIGNED_UPLOAD_TOKEN,
        tokenExpiresAt: shortToken,
      })

      const result = await service.createUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(result.response.data.expiresAt).toBe(shortToken.toISOString())
    })

    it('writes no session row when storage cannot sign', async () => {
      storageCreateUploadSession.mockRejectedValueOnce(new Error('storage down'))

      await expect(
        service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('storage down')
      expect(mockPrisma.garmentItem.create).not.toHaveBeenCalled()
    })

    /**
     * Review round 1, 2026-11-19 (Codex 1): a member could write their row's path columns, and
     * the service role then acted on whatever object they named. A replay whose stored path is
     * not the one derived from the row is refused before any storage call. Round 3 (Codex round 2
     * finding 2): such a session is retired, so it answers as expired.
     */
    it('refuses a replay whose stored path names another member before signing', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        garmentFixture({
          file_size_bytes: declaration.fileSizeBytes,
          content_sha256: declaration.sha256,
          width_px: declaration.widthPx,
          height_px: declaration.heightPx,
          object_path: `wardrobe/${OTHER_USER_ID}/${GARMENT_ID}.png`,
        })
      )

      await expect(
        service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageCreateUploadSession).not.toHaveBeenCalled()
    })

    /**
     * Codex round 2 finding 2: the id columns are text and were member-writable, so a historical
     * session id can carry path segments. Such a session is retired before any signing, even
     * when its stored path was built from the same malformed id.
     */
    it.each([
      ['a session id that is not a UUID', { upload_session_id: '../wardrobe/x' }],
      [
        'a garment id and path that are both malformed',
        { id: '../other', object_path: `wardrobe/${USER_ID}/../other.png` },
      ],
      [
        'a stored path whose extension disagrees with the MIME type',
        { object_path: `wardrobe/${USER_ID}/${GARMENT_ID}.jpg` },
      ],
    ])('retires a replay with %s before signing', async (_case, overrides) => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        garmentFixture({
          file_size_bytes: declaration.fileSizeBytes,
          content_sha256: declaration.sha256,
          width_px: declaration.widthPx,
          height_px: declaration.heightPx,
          ...overrides,
        })
      )

      await expect(
        service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageCreateUploadSession).not.toHaveBeenCalled()
    })

    it('checks guardian upload permission before signing anything', async () => {
      guardianAuthorization.mockRejectedValueOnce(new Error('GUARDIAN_CONSENT_REQUIRED'))

      await expect(
        service.createUploadUrl(USER_ID, 'teen', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      expect(storageCreateUploadSession).not.toHaveBeenCalled()
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
              user_id: OTHER_USER_ID,
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

      const created = mockPrisma.garmentItem.create.mock.calls[0]?.[0] as {
        data: { id: string; upload_session_id: string }
      }
      expect(result.response.data.garmentId).toBe(created.data.id)
      expect(result.response.data.uploadSessionId).toBe(created.data.upload_session_id)
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

  describe('commitGarment of bytes the client PUT straight to storage', () => {
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

    const commitInput = {
      garmentId: GARMENT_ID,
      uploadSessionId: SESSION_ID,
      hasCropping: true,
      hasBgCleanup: false,
    }

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

    function expectRecordedForDeletion(objectPath: string, reason: string) {
      expect(mockPrisma.wardrobeObjectDeletion.createMany).toHaveBeenCalledWith({
        data: [{ object_path: objectPath, reason }],
        skipDuplicates: true,
      })
    }

    /**
     * The publication claim a commit takes before any storage I/O (round 4). Round 5 (Codex
     * C4-4) takes it in the same locked transaction that classified the row, as a
     * compare-and-set on the claim it read.
     */
    const claimWhere = {
      id: GARMENT_ID,
      upload_session_id: SESSION_ID,
      publish_attempt_id: null,
    }

    function claimCall() {
      return mockPrisma.garmentItem.updateMany.mock.calls.find(
        ([args]) =>
          typeof (args as { data: { publish_attempt_id?: unknown } }).data
            .publish_attempt_id === 'string'
      )?.[0] as { where: unknown; data: { publish_attempt_id: string } } | undefined
    }

    function claimedAttemptId(): string {
      const attemptId = claimCall()?.data.publish_attempt_id
      expect(attemptId).toEqual(expect.any(String))
      return attemptId as string
    }

    /** The release of the claim, written when no write of the final key was started. */
    function releaseOf(attemptId: string) {
      return {
        where: { id: GARMENT_ID, publish_attempt_id: attemptId },
        data: { publish_attempt_id: null, publish_started_at: null },
      }
    }

    it('rejects a missing session', async () => {
      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow(NotFoundException)
      expect(storageDownloadBounded).not.toHaveBeenCalled()
    })

    it('preserves cross-user ownership rejection', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ user_id: OTHER_USER_ID })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_NOT_FOUND')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
    })

    it('answers 409 UPLOAD_BYTES_MISSING and leaves the session open when storage has no object', async () => {
      const garment = pendingUpload()
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)
      storageDownloadBounded.mockResolvedValueOnce({ status: 'missing' })

      const failure = service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      await expect(failure).rejects.toThrow(ConflictException)
      await expect(failure).rejects.toThrow('UPLOAD_BYTES_MISSING')
      // Read through the bucket's ceiling (Codex round 2 finding 10).
      expect(storageDownloadBounded).toHaveBeenCalledExactlyOnceWith(
        STAGING_PATH,
        MAX_IMAGE_BYTES
      )
      expect(garment.object_path).toBe(FINAL_PATH)
      expect(storagePublish).not.toHaveBeenCalled()
      expect(transitionOrders()).toEqual([])
      // Round 4: the claim taken before the read is given back, since no write of the final
      // key started, so the member's retry can claim at once. Nothing else changed.
      const attemptId = claimedAttemptId()
      expect(mockPrisma.garmentItem.updateMany.mock.calls).toEqual([
        [
          {
            where: claimWhere,
            // Round 6 (Codex C5-2): the claim records its cleanup horizon, 24 hours out.
            data: {
              publish_attempt_id: attemptId,
              publish_started_at: FIXTURE_NOW,
              publish_cleanup_until: new Date(
                FIXTURE_NOW.getTime() + 24 * 60 * 60 * 1000
              ),
            },
          },
        ],
        [releaseOf(attemptId)],
      ])
      expect(storageRemove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('treats a null expiry as an expired session', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ upload_expires_at: null })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
    })

    it('rejects an expired session when current system time exceeds upload_expires_at', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ upload_expires_at: FIXTURE_EXPIRY })
      )
      vi.setSystemTime(new Date(FIXTURE_EXPIRY.getTime() + 1000))

      const failure = service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      await expect(failure).rejects.toThrow(ConflictException)
      await expect(failure).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
    })

    /**
     * Review round 1, 2026-11-19: commit is now the only byte check, so a size mismatch says so
     * (422 IMAGE_SIZE_MISMATCH, was IMAGE_DECODE_FAILED). The staged object is removed and the
     * session ends (Codex 3), so a correction needs a fresh allocation and key. Round 3: the
     * session end and the deletion record commit in one transaction.
     */
    it('enforces the declared byte count, removes the staged object and ends the session', async () => {
      const garment = pendingUpload({ file_size_bytes: validImage.length - 1 })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)

      const failure = service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      await expect(failure).rejects.toThrow(UnprocessableEntityException)
      await expect(failure).rejects.toThrow('IMAGE_SIZE_MISMATCH')
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      // Round 5 (Codex C4-2): rejection ends the session with upload_ended_at and keeps its id,
      // so the outbox still finds the garment a staging key belongs to. The update is guarded on
      // active retention, this attempt's own publication claim and the session, and gives the
      // claim back.
      const attemptId = claimedAttemptId()
      expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: GARMENT_ID,
          user_id: USER_ID,
          upload_session_id: SESSION_ID,
          publish_attempt_id: attemptId,
          retention_status: 'active',
          upload_ended_at: null,
          upload_status: { in: ['pending_upload', 'bytes_uploaded'] },
        },
        data: {
          upload_status: 'pending_upload',
          upload_ended_at: FIXTURE_NOW,
          upload_expires_at: FIXTURE_NOW,
          publish_attempt_id: null,
          publish_started_at: null,
        },
      })
      expectRecordedForDeletion(STAGING_PATH, 'upload_rejected')
      expect(storagePublish).not.toHaveBeenCalled()
      // The classification and claim transactions, the rejection's own transaction, then the
      // outbox's locked removal of the staged key; no transition.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(4)
      expect(transitionOrders()).toEqual([])
      expect(mockPrisma.wardrobeObjectDeletion.rows.size).toBe(0)
    })

    /**
     * Codex round 2 finding 10: an object past the bucket's ceiling is refused from the bounded
     * read, never buffered whole, and handled as the size mismatch it is.
     */
    it('rejects an object storage reports past the ceiling as IMAGE_SIZE_MISMATCH', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
      storageDownloadBounded.mockResolvedValueOnce({ status: 'too_large' })

      const failure = service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      await expect(failure).rejects.toThrow(UnprocessableEntityException)
      await expect(failure).rejects.toThrow('IMAGE_SIZE_MISMATCH')
      expectRecordedForDeletion(STAGING_PATH, 'upload_rejected')
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(storagePublish).not.toHaveBeenCalled()
    })

    /**
     * Review round 1, 2026-11-19 (Codex 3): a validator still running for a session it ended
     * must not delete a corrected upload. The ended session is expired, so a second commit on it
     * is refused before any storage call, and a correction lives under a fresh session's key.
     */
    it('refuses the ended session again before touching storage', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        pendingUpload({ upload_expires_at: FIXTURE_NOW })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(storageRemove).not.toHaveBeenCalled()
      expect(storagePublish).not.toHaveBeenCalled()
    })

    /**
     * Review round 1 (Codex 1) and round 3 (Codex round 2 finding 2): a stored path or id the
     * service cannot derive from the row retires the session before any storage call.
     */
    it.each([
      [
        'a stored path naming another member',
        { object_path: `wardrobe/${OTHER_USER_ID}/${GARMENT_ID}.png` },
      ],
      ['a session id that is not a UUID', { upload_session_id: 'session-123' }],
      [
        'a garment id and path that are both malformed',
        { id: 'garment/../x', object_path: `wardrobe/${USER_ID}/garment/../x.png` },
      ],
    ])('retires a row with %s before any storage call', async (_case, overrides) => {
      const garment = pendingUpload(overrides)
      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)

      await expect(
        service.commitGarment(
          USER_ID,
          'guardian',
          {
            ...commitInput,
            garmentId: garment.id,
            uploadSessionId: garment.upload_session_id as string,
          },
          IDEMPOTENCY_KEY
        )
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(storagePublish).not.toHaveBeenCalled()
      expect(storageRemove).not.toHaveBeenCalled()
      expect(guardianAuthorization).not.toHaveBeenCalled()
    })

    /**
     * Codex round 2 finding 1: the old move picked its source by name, so a write landing after
     * verification became the final object. Commit now writes the very buffer it verified. The
     * double swaps the staged bytes the moment they are read; the final key still gets the
     * verified buffer, with the verified type, and staging is never read again.
     */
    it('publishes exactly the verified buffer even when staging changes after verification', async () => {
      const staged = new Map<string, Buffer>([[STAGING_PATH, validImage]])
      storageDownloadBounded.mockImplementation((objectPath: string) => {
        const bytes = staged.get(objectPath)
        staged.set(objectPath, Buffer.from('a later write to the same staging key'))
        return Promise.resolve({ status: 'present', bytes })
      })
      mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        pendingUpload({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
        })
      )

      await service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)

      expect(storageDownloadBounded).toHaveBeenCalledTimes(1)
      expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
        FINAL_PATH,
        validImage,
        'image/png'
      )
      expect(storagePublish.mock.calls[0]?.[1]).toBe(validImage)
    })

    /** A concurrent commit of the same session claimed first: replay it, delete nothing. */
    it('replays the winner when a matching commit claimed the session first', async () => {
      mockPrisma.garmentItem.findUnique
        .mockResolvedValueOnce(pendingUpload())
        .mockResolvedValueOnce(pendingUpload())
        .mockResolvedValueOnce(
          pendingUpload({
            upload_status: 'processing',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: payloadHash,
            processing_job_enqueued_at: FIXTURE_NOW,
          })
        )
      failNextTransition(new ConflictException('UPLOAD_ALREADY_CLAIMED'))

      const result = await service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      // The winner owns both keys now; this commit removes neither.
      expect(storageRemove).not.toHaveBeenCalled()
      expect(mockPrisma.wardrobeObjectDeletion.createMany).not.toHaveBeenCalled()
    })

    /**
     * The garment left `active` while this commit published: nothing will ever claim the final
     * object, so it is recorded for deletion and removed. Staging is not this commit's to drop.
     */
    it('removes the published object when the claim fails for a garment no longer active', async () => {
      mockPrisma.garmentItem.findUnique
        .mockResolvedValueOnce(pendingUpload())
        .mockResolvedValueOnce(pendingUpload())
        .mockResolvedValueOnce(pendingUpload({ retention_status: 'deletion_pending' }))
        .mockResolvedValueOnce(pendingUpload({ retention_status: 'deletion_pending' }))
      failNextTransition(new ConflictException('UPLOAD_ALREADY_CLAIMED'))

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
        FINAL_PATH,
        validImage,
        'image/png'
      )
      expectRecordedForDeletion(FINAL_PATH, 'commit_compensation')
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([FINAL_PATH])
      expect(enqueue).not.toHaveBeenCalled()
      // Round 4: the publish returned, so it has landed; the claim is given back before the
      // compensation, and nothing of this attempt is left in flight.
      const release = releaseOf(claimedAttemptId())
      expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith(release)
      const releaseOrder = mockPrisma.garmentItem.updateMany.mock.calls.findIndex(
        ([args]) => JSON.stringify(args) === JSON.stringify(release)
      )
      expect(
        mockPrisma.garmentItem.updateMany.mock.invocationCallOrder[releaseOrder]
      ).toBeLessThan(
        mockPrisma.wardrobeObjectDeletion.createMany.mock.invocationCallOrder[0]!
      )
    })

    /**
     * Codex round 2 finding 5: a claim that fails after publication (a crash, a lost database
     * answer) used to strand the upload, because the move had already emptied staging. Staging
     * now stays until the claim succeeds, so the retry verifies the same staged bytes, publishes
     * them again and claims; only then is staging released.
     */
    it('keeps staging when the claim fails after publication, so the retry verifies, publishes and claims', async () => {
      const stillOpen = pendingUpload()
      mockPrisma.garmentItem.findUnique.mockResolvedValue(stillOpen)
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        pendingUpload({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
        })
      )
      failNextTransition(new Error('connection reset'))

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('connection reset')
      expect(storagePublish).toHaveBeenCalledTimes(1)
      expect(storageRemove).not.toHaveBeenCalled()
      expect(mockPrisma.wardrobeObjectDeletion.createMany).not.toHaveBeenCalled()
      // The publish landed, so the claim is given back and the retry may claim at once.
      expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith(
        releaseOf(claimedAttemptId())
      )

      const retry = await service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(retry.replayed).toBe(false)
      expect(storageDownloadBounded).toHaveBeenCalledTimes(2)
      expect(storageDownloadBounded).toHaveBeenLastCalledWith(
        STAGING_PATH,
        MAX_IMAGE_BYTES
      )
      expect(storagePublish).toHaveBeenCalledTimes(2)
      expect(storagePublish).toHaveBeenLastCalledWith(FINAL_PATH, validImage, 'image/png')
      expectRecordedForDeletion(STAGING_PATH, 'commit_staging_released')
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(enqueue).toHaveBeenCalledWith(GARMENT_ID, GARMENT_ID)
    })

    it('verifies the staged bytes, publishes them, claims the session, then releases staging', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
      mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        pendingUpload({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
        })
      )

      const result = await service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(false)
      expect(guardianAuthorization).toHaveBeenCalledExactlyOnceWith(USER_ID, 'guardian')
      expect(storageDownloadBounded).toHaveBeenCalledExactlyOnceWith(
        STAGING_PATH,
        MAX_IMAGE_BYTES
      )
      // The server writes the verified bytes to the final key before the row is claimed.
      expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
        FINAL_PATH,
        validImage,
        'image/png'
      )
      expect(storagePublish.mock.invocationCallOrder[0]).toBeLessThan(
        transitionOrders()[0]!
      )
      // Round 4: publication is claimed before any storage I/O, and only that attempt moves
      // the row on, clearing its claim as it does.
      const claim = claimCall()
      expect(claim?.where).toEqual(claimWhere)
      expect(mockPrisma.garmentItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        storageDownloadBounded.mock.invocationCallOrder[0]!
      )
      expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: GARMENT_ID,
          user_id: USER_ID,
          upload_session_id: SESSION_ID,
          upload_status: { in: ['pending_upload', 'bytes_uploaded'] },
          retention_status: 'active',
          publish_attempt_id: claimedAttemptId(),
        },
        data: expect.objectContaining({
          upload_status: 'processing',
          publish_attempt_id: null,
          publish_started_at: null,
          commit_idempotency_key: IDEMPOTENCY_KEY,
          has_cropping: true,
          has_bg_cleanup: false,
        }) as unknown,
      })
      // Staging is released only after the claim succeeded, and after the job handoff
      // (Codex round 3 finding 5: no storage work sits between the claim and the enqueue).
      expectRecordedForDeletion(STAGING_PATH, 'commit_staging_released')
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(storageRemove.mock.invocationCallOrder[0]).toBeGreaterThan(
        transitionOrders()[0]!
      )
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(GARMENT_ID, GARMENT_ID)
      expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.wardrobeObjectDeletion.createMany.mock.invocationCallOrder[0]!
      )
    })

    /**
     * Round 4 (Codex round 3 finding 1): publication ownership comes before any storage I/O.
     * Only the attempt that claims it reads staging, verifies, publishes and moves the row on.
     */
    describe('publication ownership', () => {
      /** A claim another attempt took a minute ago, still well inside its lease. */
      const liveClaim = {
        publish_attempt_id: 'attempt-other',
        publish_started_at: new Date(FIXTURE_NOW.getTime() - 60_000),
      }

      it('answers a concurrent commit 409 UPLOAD_IN_PROGRESS without touching storage', async () => {
        // The claim read under the row lock sees the other attempt's live claim.
        mockPrisma.garmentItem.findUnique
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValue(pendingUpload(liveClaim))

        const failure = service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        await expect(failure).rejects.toThrow(ConflictException)
        await expect(failure).rejects.toThrow('UPLOAD_IN_PROGRESS')
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(storagePublish).not.toHaveBeenCalled()
        expect(storageRemove).not.toHaveBeenCalled()
        expect(mockPrisma.wardrobeObjectDeletion.createMany).not.toHaveBeenCalled()
      })

      /**
       * A claim older than the lease belongs to an attempt that has ended, finished or
       * stopped; the claim's guard admits taking it over, and the new owner publishes.
       */
      it('takes over a claim whose lease ran out and publishes', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(
          pendingUpload({
            publish_attempt_id: 'attempt-stalled',
            publish_started_at: new Date(
              FIXTURE_NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 1
            ),
          })
        )
        mockPrisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
          pendingUpload({
            upload_status: 'processing',
            commit_idempotency_key: IDEMPOTENCY_KEY,
          })
        )

        const result = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(result.replayed).toBe(false)
        expect(claimCall()?.where).toEqual({
          ...claimWhere,
          publish_attempt_id: 'attempt-stalled',
        })
        expect(claimedAttemptId()).not.toBe('attempt-stalled')
        expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
          FINAL_PATH,
          validImage,
          'image/png'
        )
      })

      /**
       * The duplicate of finding 1: a same-key commit that arrives after the owner finished
       * replays the owner's outcome and never reads, publishes or claims again, so it cannot
       * restore a photo the owner's purge already removed.
       */
      it('replays a same-key commit after the owner finished without publishing again', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(
          pendingUpload({
            upload_status: 'processing',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: payloadHash,
            processing_job_enqueued_at: FIXTURE_NOW,
          })
        )

        const result = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(result.replayed).toBe(true)
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(storagePublish).not.toHaveBeenCalled()
        expect(enqueue).not.toHaveBeenCalled()
      })

      /** A same-key commit that lost the claim to the owner who finished replays it. */
      it('replays the owner outcome when the claim is lost to an attempt that finished', async () => {
        mockPrisma.garmentItem.findUnique
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValue(
            pendingUpload({
              upload_status: 'processing',
              commit_idempotency_key: IDEMPOTENCY_KEY,
              commit_payload_hash: payloadHash,
              processing_job_enqueued_at: FIXTURE_NOW,
            })
          )
        mockPrisma.garmentItem.updateMany.mockResolvedValueOnce({ count: 0 })

        const result = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(result.replayed).toBe(true)
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(storagePublish).not.toHaveBeenCalled()
      })

      /**
       * A publish that failed may still land, so its claim stays until the lease runs out:
       * a purge or retry meeting it then waits until the write has landed.
       */
      it('keeps the claim when the publish itself failed', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
        storagePublish.mockRejectedValueOnce(new Error('socket hang up'))

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('socket hang up')

        expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledOnce()
        expect(claimCall()?.where).toEqual(claimWhere)
        expect(transitionOrders()).toEqual([])
      })

      it('gives the claim back when reading staging failed before any publish', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
        storageDownloadBounded.mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE'))

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('STORAGE_UNAVAILABLE')

        expect(mockPrisma.garmentItem.updateMany).toHaveBeenLastCalledWith(
          releaseOf(claimedAttemptId())
        )
        expect(storagePublish).not.toHaveBeenCalled()
      })
    })

    /**
     * Round 4: the three orders two commits of one session can arrive in, each forced
     * explicitly. Only the attempt holding the publication claim touches storage; every other
     * attempt answers from the row.
     */
    describe('forced commit orders (round 4)', () => {
      /** The key a second, separate commit attempt of the same session carries. */
      const OTHER_IDEMPOTENCY_KEY = '5d0e8a7b-1c2f-4a3e-9b6d-2f7a8c9e0b1d' // gitleaks:allow
      /** The harness's fixed signed read URL; the clock is frozen at FIXTURE_NOW. */
      const SIGNED_READ_URL = 'https://storage.test/signed.png'
      const READ_URL_EXPIRES_AT = new Date(
        FIXTURE_NOW.getTime() + 900 * 1000
      ).toISOString()

      /**
       * One garment row that every read returns and every conditional write updates, so the
       * winner's commit leaves the row exactly as the next commit reads it. The orders here run
       * one attempt after the other, so each write matches its row.
       */
      function holdOneRow(initial: GarmentItem): () => GarmentItem {
        let row = initial
        mockPrisma.garmentItem.findUnique.mockImplementation(() => Promise.resolve(row))
        mockPrisma.garmentItem.findUniqueOrThrow.mockImplementation(() =>
          Promise.resolve(row)
        )
        mockPrisma.garmentItem.updateMany.mockImplementation(
          ({ data }: { data: Partial<GarmentItem> }) => {
            row = { ...row, ...data }
            return Promise.resolve({ count: 1 })
          }
        )
        return () => row
      }

      it('R4-GAR-ORD-01 answers a commit that meets another attempt live claim 409 UPLOAD_IN_PROGRESS with no storage call at all', async () => {
        mockPrisma.garmentItem.findUnique
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValue(
            pendingUpload({
              publish_attempt_id: 'attempt-owner',
              publish_started_at: new Date(FIXTURE_NOW.getTime() - 60_000),
            })
          )

        const failure = service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        await expect(failure).rejects.toBeInstanceOf(ConflictException)
        await expect(failure).rejects.toThrow('UPLOAD_IN_PROGRESS')
        // Round 5: the live claim is read under the row lock, so nothing is written at all.
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(storagePublish).not.toHaveBeenCalled()
        expect(storageRemove).not.toHaveBeenCalled()
        expect(storageCreateUploadSession).not.toHaveBeenCalled()
        expect(storageSignReadUrl).not.toHaveBeenCalled()
        expect(mockPrisma.wardrobeObjectDeletion.createMany).not.toHaveBeenCalled()
        expect(enqueue).not.toHaveBeenCalled()
      })

      it('R4-GAR-ORD-02 refuses a different key after the winner finished 409 IDEMPOTENCY_KEY_REUSED and writes nothing to storage', async () => {
        const currentRow = holdOneRow(pendingUpload())
        const winner = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )
        expect(winner.replayed).toBe(false)
        expect(currentRow()).toMatchObject({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
          publish_attempt_id: null,
          processing_job_enqueued_at: FIXTURE_NOW,
        })
        const rowWritesByWinner = mockPrisma.garmentItem.updateMany.mock.calls.length

        const loser = service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          OTHER_IDEMPOTENCY_KEY
        )

        await expect(loser).rejects.toBeInstanceOf(ConflictException)
        await expect(loser).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
        // Storage saw the winner's calls only: one read of staging, one publish of the
        // verified bytes, one release of staging, one signed read for its response.
        expect(storageDownloadBounded).toHaveBeenCalledExactlyOnceWith(
          STAGING_PATH,
          MAX_IMAGE_BYTES
        )
        expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
          FINAL_PATH,
          validImage,
          'image/png'
        )
        expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        expect(storageSignReadUrl).toHaveBeenCalledOnce()
        expect(enqueue).toHaveBeenCalledOnce()
        // The loser wrote nothing to the row either; it still holds the winner's commit.
        expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledTimes(rowWritesByWinner)
        expect(currentRow()).toMatchObject({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
        })
      })

      it('R4-GAR-ORD-03 replays the winner key after it finished with the same body and no second download or publish', async () => {
        holdOneRow(pendingUpload())
        const winner = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        const replay = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(winner.replayed).toBe(false)
        expect(replay.replayed).toBe(true)
        expect(replay.response).toEqual(winner.response)
        expect(winner.response.data).toMatchObject({
          id: GARMENT_ID,
          status: 'processing',
          committedAt: FIXTURE_NOW.toISOString(),
          imageAccess: { url: SIGNED_READ_URL, expiresAt: READ_URL_EXPIRES_AT },
        })
        // Both responses sign the same final key; only the winner read and wrote storage.
        expect(storageSignReadUrl).toHaveBeenCalledTimes(2)
        expect(storageSignReadUrl).toHaveBeenNthCalledWith(1, FINAL_PATH, 900)
        expect(storageSignReadUrl).toHaveBeenNthCalledWith(2, FINAL_PATH, 900)
        expect(storageDownloadBounded).toHaveBeenCalledExactlyOnceWith(
          STAGING_PATH,
          MAX_IMAGE_BYTES
        )
        expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
          FINAL_PATH,
          validImage,
          'image/png'
        )
        expect(storageRemove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        // The winner recorded its job handoff, so the replay enqueues nothing again.
        expect(enqueue).toHaveBeenCalledExactlyOnceWith(GARMENT_ID, GARMENT_ID)
      })
    })

    /**
     * Round 4 (Codex round 3 finding 7): rejection used to leave the row pending with its expiry
     * set to now, so an attempt that verified valid bytes earlier could still claim it. Round 4
     * cleared the session id; round 5 (C4-2) keeps the id and sets upload_ended_at instead (see
     * "a rejection that meets a legal hold"). A row a round 4 rejection cleared stays ended.
     */
    describe('an ended session', () => {
      it('answers a commit of a rejected session UPLOAD_SESSION_EXPIRED before any storage call', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(
          pendingUpload({ upload_session_id: null, upload_expires_at: FIXTURE_NOW })
        )

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')

        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(guardianAuthorization).not.toHaveBeenCalled()
      })

      /**
       * The rejection lands between this attempt's verification and its claim of the row: the
       * claim is guarded on this attempt's publication claim and the session, both of which the
       * rejection cleared, so the claim matches nothing. The commit fails and removes the final
       * object it had published, which nothing will ever claim.
       */
      it('lets no attempt claim a session rejected after it verified', async () => {
        let row = pendingUpload()
        mockPrisma.garmentItem.findUnique.mockImplementation(
          (args: { where: { id?: string } }) =>
            Promise.resolve(args.where.id === GARMENT_ID ? row : null)
        )
        mockPrisma.garmentItem.updateMany.mockImplementation(
          (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (args.data.upload_status === 'processing') {
              const matches =
                row.upload_session_id === args.where.upload_session_id &&
                row.publish_attempt_id === args.where.publish_attempt_id
              return Promise.resolve({ count: matches ? 1 : 0 })
            }
            if (typeof args.data.publish_attempt_id === 'string') {
              row = pendingUpload({
                publish_attempt_id: args.data.publish_attempt_id,
                publish_started_at: FIXTURE_NOW,
              })
            }
            return Promise.resolve({ count: 1 })
          }
        )
        storagePublish.mockImplementation(() => {
          // Another path ends the session while this attempt is publishing.
          row = pendingUpload({
            upload_session_id: null,
            upload_expires_at: FIXTURE_NOW,
            publish_attempt_id: null,
            publish_started_at: null,
          })
          return Promise.resolve()
        })

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')

        expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              upload_session_id: SESSION_ID,
              publish_attempt_id: claimedAttemptId(),
            }) as unknown,
            data: expect.objectContaining({ upload_status: 'processing' }) as unknown,
          })
        )
        expect(enqueue).not.toHaveBeenCalled()
        expectRecordedForDeletion(FINAL_PATH, 'commit_compensation')
        expect(storageRemove).toHaveBeenCalledExactlyOnceWith([FINAL_PATH])
      })

      it('answers an allocation replay of a rejected session as expired without signing', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValueOnce(
          pendingUpload({
            upload_session_id: null,
            // Still inside the window: the cleared session alone ends it.
            upload_expires_at: FIXTURE_EXPIRY,
          })
        )

        await expect(
          service.createUploadUrl(
            USER_ID,
            'guardian',
            {
              fileSizeBytes: validImage.length,
              mimeType: 'image/png',
              sha256: validSha256,
              widthPx: 300,
              heightPx: 300,
            },
            IDEMPOTENCY_KEY
          )
        ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
        expect(storageCreateUploadSession).not.toHaveBeenCalled()
      })
    })

    /**
     * Round 5 (Codex C4-2): rejection marks the session ended with upload_ended_at and keeps its
     * id, guarded on active retention, so a legal hold that lands between the claim and the
     * failed validation keeps the staged source and the session as they are.
     */
    describe('a rejection that meets a legal hold', () => {
      it('records no deletion and removes nothing when the hold landed after the claim', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(
          pendingUpload({ file_size_bytes: validImage.length - 1 })
        )
        // The claim matches; the rejection, guarded on active retention, meets the hold.
        mockPrisma.garmentItem.updateMany.mockImplementation(
          (args: { data: Record<string, unknown> }) =>
            Promise.resolve({ count: 'upload_ended_at' in args.data ? 0 : 1 })
        )

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('IMAGE_SIZE_MISMATCH')

        expect(mockPrisma.garmentItem.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              retention_status: 'active',
              upload_session_id: SESSION_ID,
            }) as unknown,
          })
        )
        expect(mockPrisma.wardrobeObjectDeletion.createMany).not.toHaveBeenCalled()
        expect(storageRemove).not.toHaveBeenCalled()
        // The claim is still given back: no write of the final key was started.
        expect(mockPrisma.garmentItem.updateMany).toHaveBeenLastCalledWith(
          releaseOf(claimedAttemptId())
        )
      })

      it('answers a commit of a session ended with upload_ended_at as expired before any storage call', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue(
          pendingUpload({
            upload_ended_at: FIXTURE_NOW,
            upload_expires_at: FIXTURE_EXPIRY,
          })
        )

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
        expect(storageDownloadBounded).not.toHaveBeenCalled()
        expect(guardianAuthorization).not.toHaveBeenCalled()
      })

      it('answers an allocation replay of an ended session as expired without signing', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValueOnce(
          pendingUpload({
            upload_ended_at: FIXTURE_NOW,
            upload_expires_at: FIXTURE_EXPIRY,
          })
        )

        await expect(
          service.createUploadUrl(
            USER_ID,
            'guardian',
            {
              fileSizeBytes: validImage.length,
              mimeType: 'image/png',
              sha256: validSha256,
              widthPx: 300,
              heightPx: 300,
            },
            IDEMPOTENCY_KEY
          )
        ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
        expect(storageCreateUploadSession).not.toHaveBeenCalled()
      })
    })

    /**
     * Round 5 (Codex C4-4): every commit decision comes from one read of the row under its lock,
     * with retention checked before any read is signed or any job enqueued. Round 4 signed a
     * reconciled winner's read before looking at retention, and could answer a valid same-key
     * loser UPLOAD_SESSION_EXPIRED when the winner committed between its two reads.
     */
    describe('one locked classification', () => {
      const committedWinner = () =>
        pendingUpload({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
        })

      it('refuses to reconcile a winner whose garment went under hold, without signing or enqueuing', async () => {
        mockPrisma.garmentItem.findUnique
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValueOnce({ ...committedWinner(), retention_status: 'legal_hold' })
        failNextTransition(new ConflictException('UPLOAD_ALREADY_CLAIMED'))

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('WARDROBE_UPLOAD_FORBIDDEN')
        expect(storageSignReadUrl).not.toHaveBeenCalled()
        expect(enqueue).not.toHaveBeenCalled()
      })

      it('refuses a same-key replay of a garment under hold before signing or enqueuing', async () => {
        mockPrisma.garmentItem.findUnique.mockResolvedValue({
          ...committedWinner(),
          retention_status: 'legal_hold',
        })

        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('WARDROBE_UPLOAD_FORBIDDEN')
        expect(storageSignReadUrl).not.toHaveBeenCalled()
        expect(enqueue).not.toHaveBeenCalled()
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
      })

      it('replays a winner that committed between the classification and the claim, never answering expired', async () => {
        mockPrisma.garmentItem.findUnique
          .mockResolvedValueOnce(pendingUpload())
          .mockResolvedValue(committedWinner())

        const result = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(result.replayed).toBe(true)
        expect(result.response.data.status).toBe('processing')
        expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: claimWhere })
        )
        expect(storageDownloadBounded).not.toHaveBeenCalled()
      })

      it('claims a valid session whose owner released its claim before writing', async () => {
        let row: GarmentItem = pendingUpload()
        mockPrisma.garmentItem.findUnique.mockImplementation(() => Promise.resolve(row))
        mockPrisma.garmentItem.findUniqueOrThrow.mockImplementation(() =>
          Promise.resolve(row)
        )
        mockPrisma.garmentItem.updateMany.mockImplementation(
          ({ data }: { data: Partial<GarmentItem> }) => {
            row = { ...row, ...data }
            return Promise.resolve({ count: 1 })
          }
        )
        // The owner claims, then fails reading staging and releases its claim.
        storageDownloadBounded.mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE'))
        await expect(
          service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
        ).rejects.toThrow('STORAGE_UNAVAILABLE')
        expect(row.publish_attempt_id).toBeNull()

        const retry = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(retry.replayed).toBe(false)
        expect(retry.response.data.status).toBe('processing')
        expect(storagePublish).toHaveBeenCalledExactlyOnceWith(
          FINAL_PATH,
          validImage,
          'image/png'
        )
      })

      it('answers a commit whose garment left active after it moved on without image access', async () => {
        readsThenCommitted(pendingUpload(), {
          ...committedWinner(),
          retention_status: 'legal_hold',
        })

        const result = await service.commitGarment(
          USER_ID,
          'guardian',
          commitInput,
          IDEMPOTENCY_KEY
        )

        expect(result.replayed).toBe(false)
        expect(result.response.data.imageAccess).toBeNull()
        expect(storageSignReadUrl).not.toHaveBeenCalled()
      })
    })

    it('checks guardian permission at commit before reading storage', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(pendingUpload())
      guardianAuthorization.mockRejectedValueOnce(new Error('GUARDIAN_CONSENT_REQUIRED'))

      await expect(
        service.commitGarment(USER_ID, 'teen', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(mockPrisma.garmentItem.updateMany).not.toHaveBeenCalled()
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
      expect(storageDownloadBounded).not.toHaveBeenCalled()
      expect(telemetryCapture).not.toHaveBeenCalled()
    })

    it('refuses to commit a garment whose processing already failed', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(
        uploadedGarment({ upload_status: 'failed' })
      )

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('INVALID_GARMENT_COMMIT')
      expect(storageDownloadBounded).not.toHaveBeenCalled()
    })

    it('still commits a legacy relay upload whose session has since expired', async () => {
      // `bytes_uploaded` rows had their bytes accepted by the retired relay before this deploy.
      readsThenCommitted(
        uploadedGarment(),
        uploadedGarment({ upload_status: 'processing' })
      )
      vi.setSystemTime(new Date(FIXTURE_EXPIRY.getTime() + 60_000))

      await expect(
        service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).resolves.toMatchObject({
        replayed: false,
        response: { data: { status: 'processing' } },
      })
      // Its bytes already sit at the final path, so it is verified there and never published.
      expect(storageDownloadBounded).toHaveBeenCalledExactlyOnceWith(
        FINAL_PATH,
        MAX_IMAGE_BYTES
      )
      expect(storagePublish).not.toHaveBeenCalled()
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
      readsThenCommitted(initial, committed)

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
      expect(enqueue).toHaveBeenCalledWith(GARMENT_ID, GARMENT_ID)
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
      readsThenCommitted(initial, committed)
      failNextTransition(
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

      expect(transitionOrders()).toHaveLength(2)
      expect(enqueue).toHaveBeenCalledWith(GARMENT_ID, GARMENT_ID)
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
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(raced)
      failNextTransition(new ConflictException('UPLOAD_ALREADY_CLAIMED'))

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
      readsThenCommitted(initial, committed)
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
