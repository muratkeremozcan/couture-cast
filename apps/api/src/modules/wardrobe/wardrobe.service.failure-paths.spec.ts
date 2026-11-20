// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off the mock boundary objects, which is the established pattern for these suites. */
import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Prisma, type GarmentItem, type PrismaClient } from '@prisma/client'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
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
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { WardrobeService } from './wardrobe.service'
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
const SIGNED_UPLOAD_URL =
  'https://project.supabase.test/storage/v1/object/upload/sign/wardrobe-images/garment.png?token=signed'
const FIXTURE_NOW = new Date('2026-08-04T09:25:00.000Z')
const FIXTURE_EXPIRY = new Date('2026-08-04T09:35:00.000Z')

type MockGarmentRepository = {
  create: Mock
  findMany: Mock
  findFirst: Mock
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

function garmentFixture(overrides: Partial<GarmentItem> = {}): GarmentItem {
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
  } as GarmentItem
}

function commitPayloadHash(input: {
  garmentId: string
  uploadSessionId: string
  hasCropping: boolean
  hasBgCleanup: boolean
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: '6.19.0',
  })
}

function createHarness() {
  const garmentItem: MockGarmentRepository = {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
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
  const captureEvent = vi.fn().mockResolvedValue(undefined)
  const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
  const createUploadSession = vi.fn().mockResolvedValue({
    uploadUrl: SIGNED_UPLOAD_URL,
    uploadToken: 'storage-signed-upload-token',
    tokenExpiresAt: new Date('2026-08-04T11:25:00.000Z'),
  })
  const downloadBounded = vi
    .fn()
    .mockResolvedValue({ status: 'present', bytes: Buffer.alloc(0) })
  const signReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed.png')
  const remove = vi.fn().mockResolvedValue(undefined)
  const publish = vi.fn().mockResolvedValue(undefined)
  const enqueue = vi.fn().mockResolvedValue(undefined)
  const invalidateUserCache = vi.fn().mockResolvedValue(true)

  const service = new WardrobeService(
    mockPrisma as unknown as PrismaClient,
    { captureEvent } as unknown as TelemetryService,
    { assertWardrobeUploadAllowed } as unknown as GuardianService,
    {
      createUploadSession,
      downloadBounded,
      signReadUrl,
      remove,
      publish,
    } as unknown as SupabaseWardrobeStorageAdapter,
    { enqueue } as unknown as WardrobeProcessingQueue,
    { invalidateUserCache } as unknown as RitualService
  )

  return {
    service,
    prisma: mockPrisma,
    captureEvent,
    assertWardrobeUploadAllowed,
    createUploadSession,
    downloadBounded,
    signReadUrl,
    remove,
    publish,
    enqueue,
    invalidateUserCache,
  }
}

type Harness = ReturnType<typeof createHarness>

/**
 * Round 5 (Codex C4-4): a commit classifies and claims inside locked transactions of its own, so
 * the transition is told apart as the one serializable transaction.
 */
function transitionCount(h: Harness): number {
  return h.prisma.$transaction.mock.calls.filter(
    ([, options]) =>
      (options as { isolationLevel?: unknown } | undefined)?.isolationLevel ===
      Prisma.TransactionIsolationLevel.Serializable
  ).length
}

describe('WardrobeService failure and degraded-dependency paths', () => {
  let validPng: Buffer
  let validPngSha: string
  let jpegBytes: Buffer
  let h: Harness

  beforeAll(async () => {
    validPng = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 80, g: 120, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    validPngSha = createHash('sha256').update(validPng).digest('hex')
    jpegBytes = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .toBuffer()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXTURE_NOW)
    h = createHarness()
  })

  afterEach(() => {
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

    function matchingExisting(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        file_size_bytes: declaration.fileSizeBytes,
        mime_type: declaration.mimeType,
        content_sha256: declaration.sha256,
        width_px: declaration.widthPx,
        height_px: declaration.heightPx,
        ...overrides,
      })
    }

    /**
     * The object extension is derived from the declared MIME type, and the stored
     * path is what every later read signs against. A wrong extension makes the
     * object unreadable by anything that trusts the path suffix.
     */
    it.each([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ] as const)(
      'stores %s bytes under a .%s object path',
      async (mimeType, extension) => {
        h.prisma.garmentItem.create.mockImplementation(
          ({ data }: { data: Partial<GarmentItem> }) =>
            Promise.resolve(garmentFixture({ ...data, created_at: FIXTURE_NOW }))
        )

        await h.service.createUploadUrl(
          USER_ID,
          'guardian',
          { ...declaration, mimeType },
          IDEMPOTENCY_KEY
        )

        const [{ data }] = h.prisma.garmentItem.create.mock.calls[0] as [
          { data: { id: string; object_path: string; upload_session_id: string } },
        ]
        expect(data.object_path).toBe(`wardrobe/${USER_ID}/${data.id}.${extension}`)
        // The signed upload URL is scoped to the session's staging key, same extension.
        expect(h.createUploadSession).toHaveBeenCalledExactlyOnceWith(
          `staging/${USER_ID}/garment/${data.upload_session_id}.${extension}`
        )
      }
    )

    /**
     * Storage refusing to sign surfaces as the 503 the adapter raises. Review round 2,
     * 2026-11-19: the URL is signed before the row is written, so the outage leaves no session
     * behind and a same-key retry allocates as if for the first time.
     */
    it('answers 503 when storage cannot sign and writes no session row', async () => {
      h.prisma.garmentItem.create.mockImplementation(
        ({ data }: { data: Partial<GarmentItem> }) =>
          Promise.resolve(garmentFixture({ ...data, created_at: FIXTURE_NOW }))
      )
      h.createUploadSession.mockRejectedValueOnce(
        new ServiceUnavailableException('STORAGE_PERMISSION_DENIED')
      )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow(ServiceUnavailableException)
      expect(h.prisma.garmentItem.create).not.toHaveBeenCalled()

      const retry = await h.service.createUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(retry.replayed).toBe(false)
      expect(retry.response.data.uploadUrl).toBe(SIGNED_UPLOAD_URL)
      expect(h.prisma.garmentItem.create).toHaveBeenCalledTimes(1)
    })

    it('rejects a replay against a lapsed upload session', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        matchingExisting({ upload_expires_at: new Date(FIXTURE_NOW.getTime() - 1) })
      )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('rejects a replay once the bytes for that key were already uploaded', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        matchingExisting({ upload_status: 'bytes_uploaded' })
      )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('rejects a replay for a garment that is no longer retained', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        matchingExisting({ retention_status: 'deletion_pending' })
      )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    /**
     * A row with no session id cannot produce a signable upload URL. Reporting it
     * as expired is what stops the service from emitting an `undefined` path.
     */
    it('reports an allocation with no upload session id as expired', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        matchingExisting({ upload_session_id: null })
      )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    /**
     * Two concurrent requests with the same key race on the unique index. The
     * loser must recover the winner's session rather than surface a 500.
     */
    it('recovers the winner session when the unique index rejects a racing insert', async () => {
      h.prisma.garmentItem.create.mockRejectedValue(prismaError('P2002'))
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(matchingExisting())

      const result = await h.service.createUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      expect(result.response.data.uploadSessionId).toBe(SESSION_ID)
      // The loser's own pre-signed URL goes unused; the winner's staging key is signed.
      expect(h.createUploadSession).toHaveBeenCalledTimes(2)
      expect(h.createUploadSession).toHaveBeenLastCalledWith(
        `staging/${USER_ID}/garment/${SESSION_ID}.png`
      )
    })

    it('reports key reuse when the racing winner declared different bytes', async () => {
      h.prisma.garmentItem.create.mockRejectedValue(prismaError('P2002'))
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(matchingExisting({ file_size_bytes: 4096 }))

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /** A unique violation with nothing to recover is not a replay; it is a conflict. */
    it('reports key reuse when the racing row cannot be re-read', async () => {
      h.prisma.garmentItem.create.mockRejectedValue(prismaError('P2002'))
      h.prisma.garmentItem.findUnique.mockResolvedValue(null)

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('reports an expired session when the racing winner already lapsed', async () => {
      h.prisma.garmentItem.create.mockRejectedValue(prismaError('P2002'))
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          matchingExisting({ upload_expires_at: new Date(FIXTURE_NOW.getTime() - 1) })
        )

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    /** Only a unique violation means "someone else won"; anything else is a real fault. */
    it('rethrows a database fault that is not a unique-constraint violation', async () => {
      h.prisma.garmentItem.create.mockRejectedValue(prismaError('P1001'))

      await expect(
        h.service.createUploadUrl(USER_ID, 'guardian', declaration, IDEMPOTENCY_KEY)
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError)
      expect(h.prisma.garmentItem.findUnique).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * Clients PUT the bytes straight to storage, so commit is the one place they are checked
   * against the allocation. Every mismatch removes the staged object, ends the session (review
   * round 1, 2026-11-19, Codex 3) and leaves no garment behind. Round 3: the session end and the
   * deletion record commit in one transaction, and nothing is published.
   */
  describe('commitGarment verification of the stored object', () => {
    const commitInput = {
      garmentId: GARMENT_ID,
      uploadSessionId: SESSION_ID,
      hasCropping: true,
      hasBgCleanup: false,
    }
    const stagingPath = `staging/${USER_ID}/garment/${SESSION_ID}.png`

    /**
     * Round 4: the attempt claims the publication first (updateMany call 1); the rejection
     * (call 2) ends the session, guarded on that same claim (Codex round 3 finding 7). Round 5
     * (C4-2): it sets upload_ended_at and keeps the session id, guarded on active retention as
     * well. The release that follows matches nothing in the database, since the rejection
     * consumed the claim.
     */
    function expectSessionEnded() {
      const [claim, rejection, ...rest] = h.prisma.garmentItem.updateMany.mock.calls
      const attemptId = (claim?.[0] as { data: { publish_attempt_id: string } }).data
        .publish_attempt_id
      expect(attemptId).toEqual(expect.any(String))
      expect(rejection?.[0]).toEqual({
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
      expect(rest).toEqual([
        [
          {
            where: { id: GARMENT_ID, publish_attempt_id: attemptId },
            data: { publish_attempt_id: null, publish_started_at: null },
          },
        ],
      ])
      expect(h.prisma.wardrobeObjectDeletion.createMany).toHaveBeenCalledExactlyOnceWith({
        data: [{ object_path: stagingPath, reason: 'upload_rejected' }],
        skipDuplicates: true,
      })
      expect(h.publish).not.toHaveBeenCalled()
      // The classification and claim, the rejection, then the outbox's locked removal; the row
      // was never moved on.
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(4)
      expect(transitionCount(h)).toBe(0)
    }

    function pending(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        file_size_bytes: validPng.length,
        content_sha256: validPngSha,
        width_px: 300,
        height_px: 300,
        ...overrides,
      })
    }

    async function commit(garment: GarmentItem, stored = validPng) {
      h.prisma.garmentItem.findUnique.mockResolvedValue(garment)
      h.downloadBounded.mockResolvedValue({ status: 'present', bytes: stored })
      return h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
    }

    it('refuses a garment row with an incomplete upload declaration', async () => {
      const failure = commit(pending({ content_sha256: null }))

      await expect(failure).rejects.toThrow(BadRequestException)
      await expect(failure).rejects.toThrow('INVALID_UPLOAD_DECLARATION')
      expect(h.downloadBounded).not.toHaveBeenCalled()
      expect(transitionCount(h)).toBe(0)
    })

    it('reports a checksum mismatch as unprocessable and removes the object', async () => {
      await expect(commit(pending({ content_sha256: 'f'.repeat(64) }))).rejects.toThrow(
        UnprocessableEntityException
      )
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([stagingPath])
      expectSessionEnded()
    })

    it('reports declared dimensions that the decoder disagrees with', async () => {
      await expect(commit(pending({ width_px: 1024 }))).rejects.toThrow(
        'IMAGE_DIMENSIONS_INVALID'
      )
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([stagingPath])
      expectSessionEnded()
    })

    /** Magic-byte sniffing, not the Content-Type the client sent storage, decides the format. */
    it('reports stored bytes whose real format contradicts the declared type', async () => {
      const garment = pending({
        file_size_bytes: jpegBytes.length,
        content_sha256: createHash('sha256').update(jpegBytes).digest('hex'),
      })

      await expect(commit(garment, jpegBytes)).rejects.toThrow(
        UnsupportedMediaTypeException
      )
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([stagingPath])
      expectSessionEnded()
    })

    /**
     * Review round 1, 2026-11-19 (TEA): commit is the only byte check now, so a size mismatch
     * names itself (422 IMAGE_SIZE_MISMATCH) instead of degrading to IMAGE_DECODE_FAILED.
     */
    it('reports a size mismatch against the allocation as IMAGE_SIZE_MISMATCH', async () => {
      const failure = commit(pending({ file_size_bytes: validPng.length + 1 }))

      await expect(failure).rejects.toThrow(UnprocessableEntityException)
      await expect(failure).rejects.toThrow('IMAGE_SIZE_MISMATCH')
      expect(h.remove).toHaveBeenCalledExactlyOnceWith([stagingPath])
      expectSessionEnded()
    })

    /** A storage fault is not a missing object: it must not read as "upload again". */
    it('surfaces a storage fault while reading the object as 503', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(pending())
      h.downloadBounded.mockRejectedValue(
        new ServiceUnavailableException('STORAGE_PERMISSION_DENIED')
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow(ServiceUnavailableException)
      expect(h.remove).not.toHaveBeenCalled()
      expect(h.publish).not.toHaveBeenCalled()
      // Round 4: only the publication claim and its release; the session stays open.
      const calls = h.prisma.garmentItem.updateMany.mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[1]?.[0]).toEqual({
        where: { id: GARMENT_ID, publish_attempt_id: expect.any(String) as unknown },
        data: { publish_attempt_id: null, publish_started_at: null },
      })
      expect(transitionCount(h)).toBe(0)
    })
  })

  describe('listGarments', () => {
    it('signs a read URL for every committed garment', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({
          id: 'g-1',
          upload_status: 'ready',
          object_path: `wardrobe/${USER_ID}/g-1.png`,
        }),
        garmentFixture({
          id: 'g-2',
          upload_status: 'awaiting_tags',
          object_path: `wardrobe/${USER_ID}/g-2.png`,
        }),
      ])

      const result = await h.service.listGarments(USER_ID)

      expect(result.data.map((item) => item.id)).toEqual(['g-1', 'g-2'])
      expect(result.data[0]?.imageAccess?.url).toBe('https://storage.test/signed.png')
      expect(h.signReadUrl).toHaveBeenCalledTimes(2)
    })

    /**
     * One image that cannot be signed, such as an object missing from storage,
     * costs that garment its image; the member keeps the rest of the wardrobe.
     */
    it('lists every garment when one image cannot be signed', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({
          id: 'g-1',
          upload_status: 'ready',
          object_path: `wardrobe/${USER_ID}/g-1.png`,
        }),
        garmentFixture({
          id: 'g-2',
          upload_status: 'ready',
          object_path: `wardrobe/${USER_ID}/g-2.png`,
        }),
      ])
      h.signReadUrl.mockImplementation((objectPath: string) =>
        objectPath.endsWith('g-2.png')
          ? Promise.reject(new ServiceUnavailableException('STORAGE_PERMISSION_DENIED'))
          : Promise.resolve('https://storage.test/signed.png')
      )

      const logged = vi.spyOn(
        (h.service as unknown as { logger: { error: (...args: unknown[]) => void } })
          .logger,
        'error'
      )

      const result = await h.service.listGarments(USER_ID)

      expect(result.data.map((item) => item.id)).toEqual(['g-1', 'g-2'])
      expect(result.data[0]?.imageAccess?.url).toBe('https://storage.test/signed.png')
      expect(result.data[1]?.imageAccess).toBeNull()
      // The garment id and the error's class only: the object path carries the owner's id.
      expect(logged).toHaveBeenCalledWith(
        { garmentId: 'g-2', errorClass: 'ServiceUnavailableException' },
        'garment_image_signing_failed'
      )
    })

    /**
     * Review round 1, 2026-11-19 (Codex 1): a path column naming another member's object must
     * never be signed for this member. That garment shows no image; storage is never asked.
     */
    it('never signs a path that is not the garment own object', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({
          id: 'g-1',
          upload_status: 'ready',
          object_path: `wardrobe/${OTHER_USER_ID}/g-1.png`,
        }),
      ])

      const result = await h.service.listGarments(USER_ID)

      expect(result.data[0]?.imageAccess).toBeNull()
      expect(h.signReadUrl).not.toHaveBeenCalled()
    })

    /**
     * Codex round 2 finding 8: seeded ready garments carry readable ids and no MIME type. Read
     * signing parses the stored path and compares owner, kind and this garment's own id in any
     * extension the bucket takes, so such a row keeps its image.
     */
    it('signs a seed-shaped ready garment with no MIME type and readable ids', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({
          id: 'teen-1-garment-1',
          user_id: 'teen-1',
          upload_session_id: null,
          upload_status: 'ready',
          mime_type: null,
          file_size_bytes: null,
          object_path: 'wardrobe/teen-1/teen-1-garment-1.png',
        }),
      ])

      const result = await h.service.listGarments('teen-1')

      expect(result.data[0]?.imageAccess?.url).toBe('https://storage.test/signed.png')
      expect(h.signReadUrl).toHaveBeenCalledExactlyOnceWith(
        'wardrobe/teen-1/teen-1-garment-1.png',
        900
      )
    })

    /** The exact object id counts: a sibling garment of the same member is not this one's image. */
    it('never signs a path naming another garment of the same member', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({
          id: 'g-1',
          upload_status: 'ready',
          mime_type: null,
          object_path: `wardrobe/${USER_ID}/g-2.png`,
        }),
      ])

      const result = await h.service.listGarments(USER_ID)

      expect(result.data[0]?.imageAccess).toBeNull()
      expect(h.signReadUrl).not.toHaveBeenCalled()
    })

    /**
     * A row with no object path has nothing to sign. Failing closed keeps the
     * response contract honest instead of emitting a garment with no image.
     */
    it('fails closed when a garment row has no stored object', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({ object_path: null, upload_status: 'ready' }),
      ])

      await expect(h.service.listGarments(USER_ID)).rejects.toThrow(
        ServiceUnavailableException
      )
    })
  })

  describe('suggestGarmentTags', () => {
    it('refuses to tag a garment that is pending deletion', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        garmentFixture({ upload_status: 'ready', retention_status: 'deletion_pending' })
      )

      await expect(
        h.service.suggestGarmentTags(USER_ID, 'teen', GARMENT_ID)
      ).rejects.toThrow('GARMENT_NOT_TAGGABLE')
    })

    it('refuses to tag a garment whose upload failed', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        garmentFixture({ upload_status: 'failed' })
      )

      await expect(
        h.service.suggestGarmentTags(USER_ID, 'teen', GARMENT_ID)
      ).rejects.toThrow('GARMENT_NOT_TAGGABLE')
    })
  })

  describe('updateGarmentTags', () => {
    const tags = {
      category: 'top' as const,
      material: 'cotton' as const,
      comfortRange: 'mild' as const,
    }

    function awaitingTags(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        upload_status: 'awaiting_tags',
        file_size_bytes: 2048,
        ...overrides,
      })
    }

    function confirmed(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        upload_status: 'ready',
        category: 'top',
        material: 'cotton',
        comfort_range: 'mild',
        file_size_bytes: 2048,
        ...overrides,
      })
    }

    /**
     * With no stored suggestion there is nothing to compare against, so the event
     * must record the absence rather than invent a suggested value.
     */
    it('records a confirmation with no suggestion as unavailable and not overridden', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(h.captureEvent).toHaveBeenCalledWith(
        USER_ID,
        'garment_tagging_completed',
        expect.objectContaining({
          suggestionAvailable: false,
          suggestedCategory: null,
          suggestedMaterial: null,
          suggestedComfortRange: null,
          analysisVersion: null,
          wasOverridden: false,
          overrideFields: [],
        })
      )
    })

    /** An omitted `material` keeps the stored value instead of clearing it. */
    it('keeps the stored material when the payload omits it', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        awaitingTags({ material: 'linen' })
      )
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        confirmed({ material: 'linen' })
      )

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, {
        category: 'top',
        comfortRange: 'mild',
      })

      expect(h.prisma.garmentItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ material: 'linen' }) as unknown,
        })
      )
    })

    it('flags each field the user changed away from the suggestion', async () => {
      const snapshot = createGarmentTagSuggestionSnapshotFixture()
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        awaitingTags({ tag_suggestions: snapshot as unknown as Prisma.JsonValue })
      )
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        confirmed({ category: 'outerwear' })
      )

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, {
        category: 'outerwear',
        material: snapshot.material.value,
        comfortRange: snapshot.comfortRange.value,
      })

      expect(h.captureEvent).toHaveBeenCalledWith(
        USER_ID,
        'garment_tagging_completed',
        expect.objectContaining({ wasOverridden: true, overrideFields: ['category'] })
      )
    })

    /**
     * A snapshot that no longer parses is unusable and must be cleared with a
     * failure code, otherwise every later read keeps re-reading corrupt state.
     */
    it('clears a malformed stored suggestion and stamps the failure code', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        awaitingTags({
          tag_suggestions: { category: 'top' } as unknown as Prisma.JsonValue,
        })
      )
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(h.prisma.garmentItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tag_suggestions: Prisma.DbNull,
            tagging_model_version: null,
            tag_suggested_at: null,
            tagging_failure_code: 'TAGGING_OUTPUT_INVALID',
          }) as unknown,
        })
      )
    })

    /**
     * Re-confirming an already-ready garment is an edit, not a first confirmation:
     * it must not re-emit the completion event or move `tags_confirmed_at`.
     */
    it('treats a later edit as neither a first confirmation nor a new event', async () => {
      const firstConfirmedAt = new Date('2026-08-03T08:00:00.000Z')
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        confirmed({
          category: 'bottom',
          tags_confirmed_at: firstConfirmedAt,
          tagging_telemetry_emitted_at: firstConfirmedAt,
        })
      )
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(h.prisma.garmentItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags_confirmed_at: firstConfirmedAt,
            tagging_telemetry_emitted_at: undefined,
          }) as unknown,
        })
      )
      expect(h.captureEvent).not.toHaveBeenCalled()
    })

    /**
     * A ready garment that somehow never got a confirmation timestamp must gain
     * one on this edit rather than be written back with null and stay unstamped
     * forever.
     */
    it('stamps a confirmation time on a ready garment that never had one', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(
        confirmed({ category: 'bottom', tags_confirmed_at: null })
      )
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())

      await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(h.prisma.garmentItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags_confirmed_at: FIXTURE_NOW,
          }) as unknown,
        })
      )
    })

    /**
     * Codex round 2 finding 8: a tag edit on a seed-shaped ready garment (no MIME type) used to
     * save the edit and then fail building its response. It now answers with the image.
     */
    it('answers a tag edit on a ready garment with no MIME type with its image', async () => {
      const seeded = confirmed({
        category: 'bottom',
        mime_type: null,
        upload_session_id: null,
      })
      h.prisma.garmentItem.findFirst.mockResolvedValue(seeded)
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue({
        ...seeded,
        category: 'top',
      })

      const result = await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(result.data.imageAccess?.url).toBe('https://storage.test/signed.png')
      expect(h.signReadUrl).toHaveBeenCalledExactlyOnceWith(
        `wardrobe/${USER_ID}/${GARMENT_ID}.png`,
        900
      )
    })

    /** Analytics is not on the critical path: the user's tags are already saved. */
    it('still returns the confirmed garment when telemetry delivery throws', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())
      h.captureEvent.mockRejectedValueOnce(new Error('posthog unreachable'))

      const result = await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(result.data.status).toBe('ready')
    })

    /** Redis is a cache: a refused invalidation must not fail the confirmation. */
    it('still returns the confirmed garment when cache invalidation reports failure', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())
      h.invalidateUserCache.mockResolvedValueOnce(false)

      const result = await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(result.data.status).toBe('ready')
    })

    it('still returns the confirmed garment when cache invalidation throws', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())
      h.invalidateUserCache.mockRejectedValueOnce(new Error('redis down'))

      const result = await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(result.data.status).toBe('ready')
    })

    /**
     * The conditional update is the concurrency guard. When it matches nothing the
     * row moved underneath us, and after the retry budget the caller is told to
     * re-read rather than being handed a stale garment.
     */
    it('gives up with a conflict after the retry budget for a contended row', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)
      ).rejects.toThrow('CONCURRENT_TAG_UPDATE')
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(3)
    })

    it('retries a serializable write conflict and succeeds on the next attempt', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(confirmed())
      const runTransaction = h.prisma.$transaction.getMockImplementation()
      h.prisma.$transaction
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockImplementationOnce(runTransaction as never)

      const result = await h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)

      expect(result.data.status).toBe('ready')
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(2)
    })

    /** A non-retriable fault must surface, not be laundered into a 409. */
    it('rethrows a transaction fault that retrying cannot fix', async () => {
      h.prisma.garmentItem.findFirst.mockResolvedValue(awaitingTags())
      h.prisma.$transaction.mockRejectedValue(prismaError('P1001'))

      await expect(
        h.service.updateGarmentTags(USER_ID, 'teen', GARMENT_ID, tags)
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError)
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('commitGarment', () => {
    const commitInput = {
      garmentId: GARMENT_ID,
      uploadSessionId: SESSION_ID,
      hasCropping: true,
      hasBgCleanup: true,
    }
    const payloadHash = commitPayloadHash(commitInput)

    function uploaded(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        upload_status: 'bytes_uploaded',
        file_size_bytes: 0,
        content_sha256: '',
        ...overrides,
      })
    }

    function verifiable(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return uploaded({
        file_size_bytes: validPng.length,
        content_sha256: validPngSha,
        width_px: 300,
        height_px: 300,
        ...overrides,
      })
    }

    beforeEach(() => {
      h.downloadBounded.mockResolvedValue({ status: 'present', bytes: validPng })
    })

    /**
     * The row move to processing matches nothing (another commit got there first); the
     * publication claim and every other conditional write still apply.
     */
    function transitionMatchesNothing({ data }: { data: Record<string, unknown> }) {
      return Promise.resolve({ count: data.upload_status === 'processing' ? 0 : 1 })
    }

    it('refuses a commit for a garment that does not exist', async () => {
      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow(NotFoundException)
    })

    /** Another user's garment must be indistinguishable from a missing one. */
    it('refuses a commit for another owner garment without disclosing it', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({ user_id: OTHER_USER_ID })
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_SESSION_NOT_FOUND')
    })

    it('refuses a commit for a garment that is pending deletion', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({ retention_status: 'deletion_pending' })
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow(ForbiddenException)
    })

    /**
     * A replay of an in-flight commit must re-drive the queue handoff, because the
     * first attempt may have committed the row and then failed to enqueue.
     */
    it('re-drives the processing handoff when replaying a still-processing commit', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
        })
      )

      const result = await h.service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      // The job id is the garment id until a legal hold defers the garment (round 6, C5-7).
      expect(h.enqueue).toHaveBeenCalledWith(GARMENT_ID, GARMENT_ID)
    })

    /** A garment past processing has already been handed off; do not enqueue twice. */
    it('replays a ready garment without re-enqueuing processing', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({
          upload_status: 'ready',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
        })
      )

      const result = await h.service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      expect(h.enqueue).not.toHaveBeenCalled()
    })

    /** The same key with a different payload is a client bug, not a replay. */
    it('reports key reuse when a replay carries a different payload', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: 'a-different-hash',
        })
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('reports key reuse when a replay presents a different idempotency key', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({
          upload_status: 'processing',
          commit_idempotency_key: 'someone-elses-key',
          commit_payload_hash: payloadHash,
        })
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /**
     * The stored object is re-verified at commit. Bytes that no longer match the
     * declaration are purged so an unverified image can never become a garment.
     */
    it('purges the stored object when the committed bytes fail verification', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        verifiable({ content_sha256: 'f'.repeat(64) })
      )

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow(UnprocessableEntityException)
      // A legacy relay row's bytes sit at the final path, so that is what is rejected.
      expect(h.remove).toHaveBeenCalledWith([`wardrobe/${USER_ID}/${GARMENT_ID}.png`])
      expect(h.prisma.wardrobeObjectDeletion.createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            object_path: `wardrobe/${USER_ID}/${GARMENT_ID}.png`,
            reason: 'upload_rejected',
          },
        ],
        skipDuplicates: true,
      })
      // The classification and claim, the rejection, then the outbox's locked removal; the row
      // was never moved on.
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(4)
      expect(transitionCount(h)).toBe(0)
      expect(h.prisma.garmentItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            upload_status: 'pending_upload',
            upload_ended_at: FIXTURE_NOW,
            upload_expires_at: FIXTURE_NOW,
            publish_attempt_id: null,
            publish_started_at: null,
          },
        })
      )
    })

    /** One commit key belongs to one garment; reusing it across garments conflicts. */
    it('reports key reuse when the key already belongs to a different garment', async () => {
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(garmentFixture({ id: 'a-different-garment' }))
        .mockResolvedValueOnce(null)

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /**
     * When the conditional transition matches nothing and the row is not in a
     * committed state either, there is nothing to replay, so the original conflict
     * must reach the caller.
     */
    it('surfaces the claim conflict when there is no committed row to reconcile', async () => {
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(verifiable())
      h.prisma.garmentItem.updateMany.mockImplementation(transitionMatchesNothing)

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
    })

    /**
     * The telemetry claim is a conditional update, so the loser of a race emits
     * nothing. That is what keeps retries from double-counting completed uploads.
     */
    it('emits no completion event when another attempt already claimed it', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(verifiable())
      h.prisma.garmentItem.findUniqueOrThrow.mockResolvedValue(
        verifiable({ upload_status: 'processing' })
      )
      h.prisma.garmentItem.updateMany.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve({
            count: 'completion_telemetry_emitted_at' in where ? 0 : 1,
          })
      )

      await h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)

      expect(h.captureEvent).not.toHaveBeenCalled()
    })

    it('reports key reuse when the racing winner committed a different payload', async () => {
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          verifiable({
            upload_status: 'processing',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: 'a-different-hash',
          })
        )
      h.prisma.garmentItem.updateMany.mockImplementation(transitionMatchesNothing)

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /** A racing winner that already advanced past processing needs no handoff. */
    it('replays a racing winner that reached awaiting_tags without enqueuing again', async () => {
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          verifiable({
            upload_status: 'awaiting_tags',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: payloadHash,
          })
        )
      h.prisma.garmentItem.updateMany.mockImplementation(transitionMatchesNothing)

      const result = await h.service.commitGarment(
        USER_ID,
        'guardian',
        commitInput,
        IDEMPOTENCY_KEY
      )

      expect(result.replayed).toBe(true)
      expect(h.enqueue).not.toHaveBeenCalled()
    })

    /** An already-enqueued garment must not be pushed onto the queue a second time. */
    it('skips the queue handoff for a garment that was already enqueued', async () => {
      h.prisma.garmentItem.findUnique.mockResolvedValue(
        uploaded({
          upload_status: 'processing',
          commit_idempotency_key: IDEMPOTENCY_KEY,
          commit_payload_hash: payloadHash,
          processing_job_enqueued_at: FIXTURE_NOW,
        })
      )

      await h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)

      expect(h.enqueue).not.toHaveBeenCalled()
    })
  })
})
