// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off the mock boundary objects, which is the established pattern for these suites. */
import { createHash, createHmac } from 'node:crypto'
import {
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
  findFirst: Mock
  findUnique: Mock
  findUniqueOrThrow: Mock
  updateMany: Mock
}

type MockPrisma = {
  garmentItem: MockGarmentRepository
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
    failure_code: null,
    created_at: FIXTURE_NOW,
    updated_at: FIXTURE_NOW,
    ...overrides,
  } as GarmentItem
}

function uploadToken(expiresAt: Date, userId = USER_ID, sessionId = SESSION_ID): string {
  return createHmac('sha256', UPLOAD_SECRET)
    .update(`${sessionId}.${userId}.${expiresAt.toISOString()}`)
    .digest('base64url')
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
    $transaction: vi.fn(async (callback: (tx: MockPrisma) => Promise<unknown>) =>
      callback(mockPrisma)
    ),
  }
  const captureEvent = vi.fn().mockResolvedValue(undefined)
  const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
  const upload = vi.fn().mockResolvedValue(undefined)
  const download = vi.fn().mockResolvedValue(Buffer.alloc(0))
  const signReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed.png')
  const remove = vi.fn().mockResolvedValue(undefined)
  const enqueue = vi.fn().mockResolvedValue(undefined)
  const invalidateUserCache = vi.fn().mockResolvedValue(true)

  const service = new WardrobeService(
    mockPrisma as unknown as PrismaClient,
    { captureEvent } as unknown as TelemetryService,
    { assertWardrobeUploadAllowed } as unknown as GuardianService,
    {
      upload,
      download,
      signReadUrl,
      remove,
    } as unknown as SupabaseWardrobeStorageAdapter,
    { enqueue } as unknown as WardrobeProcessingQueue,
    { invalidateUserCache } as unknown as RitualService
  )

  return {
    service,
    prisma: mockPrisma,
    captureEvent,
    assertWardrobeUploadAllowed,
    upload,
    download,
    signReadUrl,
    remove,
    enqueue,
    invalidateUserCache,
  }
}

type Harness = ReturnType<typeof createHarness>

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
    vi.stubEnv('WARDROBE_UPLOAD_TOKEN_SECRET', UPLOAD_SECRET)
    h = createHarness()
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
          { data: { object_path: string } },
        ]
        expect(data.object_path.endsWith(`.${extension}`)).toBe(true)
      }
    )

    /** A replay of a key whose session already lapsed must not hand back a dead URL. */
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

  describe('uploadBytes', () => {
    function pending(overrides: Partial<GarmentItem> = {}): GarmentItem {
      return garmentFixture({
        file_size_bytes: validPng.length,
        content_sha256: validPngSha,
        width_px: 300,
        height_px: 300,
        ...overrides,
      })
    }

    async function upload(garment: GarmentItem, bytes = validPng, mime = 'image/png') {
      h.prisma.garmentItem.findUnique.mockResolvedValue(garment)
      return h.service.uploadBytes(
        SESSION_ID,
        uploadToken(FIXTURE_EXPIRY),
        USER_ID,
        'guardian',
        mime as 'image/png',
        bytes.length,
        bytes
      )
    }

    it('refuses bytes for a garment that is pending deletion', async () => {
      await expect(
        upload(pending({ retention_status: 'deletion_pending' }))
      ).rejects.toThrow(ForbiddenException)
      expect(h.upload).not.toHaveBeenCalled()
    })

    /** The upload token is single-use: a second PUT must not overwrite stored bytes. */
    it('refuses a second upload against a consumed session', async () => {
      await expect(upload(pending({ upload_status: 'bytes_uploaded' }))).rejects.toThrow(
        'UPLOAD_TOKEN_CONSUMED'
      )
      expect(h.upload).not.toHaveBeenCalled()
    })

    /**
     * The Content-Type on the PUT must match what was declared at allocation, or a
     * caller could store WebP bytes under a path allocated for PNG.
     */
    it('refuses bytes whose content type differs from the declared type', async () => {
      await expect(
        upload(pending({ mime_type: 'image/webp' }), validPng, 'image/png')
      ).rejects.toThrow('INVALID_UPLOAD_BODY')
    })

    it('refuses a garment row with an incomplete upload declaration', async () => {
      await expect(upload(pending({ content_sha256: null }))).rejects.toThrow(
        'INVALID_UPLOAD_DECLARATION'
      )
    })

    it('reports a checksum mismatch as unprocessable', async () => {
      await expect(upload(pending({ content_sha256: 'f'.repeat(64) }))).rejects.toThrow(
        UnprocessableEntityException
      )
      expect(h.upload).not.toHaveBeenCalled()
    })

    it('reports declared dimensions that the decoder disagrees with', async () => {
      await expect(upload(pending({ width_px: 1024 }))).rejects.toThrow(
        'IMAGE_DIMENSIONS_INVALID'
      )
    })

    /** Magic-byte sniffing, not the header, decides the real format. */
    it('reports bytes whose real format contradicts the declared type', async () => {
      const garment = pending({
        file_size_bytes: jpegBytes.length,
        content_sha256: createHash('sha256').update(jpegBytes).digest('hex'),
      })

      await expect(upload(garment, jpegBytes, 'image/png')).rejects.toThrow(
        UnsupportedMediaTypeException
      )
    })

    /** Any other validation failure degrades to a generic decode failure. */
    it('reports a size mismatch against the allocation as a decode failure', async () => {
      await expect(
        upload(pending({ file_size_bytes: validPng.length + 1 }))
      ).rejects.toThrow('IMAGE_DECODE_FAILED')
    })

    /**
     * The state transition is the real mutex. If a concurrent request consumed the
     * session between verification and the update, the bytes just written must be
     * removed rather than left orphaned in storage.
     */
    it('removes the uploaded object when a concurrent request consumed the session', async () => {
      h.prisma.garmentItem.updateMany.mockResolvedValue({ count: 0 })

      await expect(upload(pending())).rejects.toThrow('UPLOAD_TOKEN_CONSUMED')
      expect(h.remove).toHaveBeenCalledWith([`wardrobe/${USER_ID}/${GARMENT_ID}.png`])
    })
  })

  describe('listGarments', () => {
    it('signs a read URL for every committed garment', async () => {
      h.prisma.garmentItem.findMany.mockResolvedValue([
        garmentFixture({ id: 'g-1', upload_status: 'ready' }),
        garmentFixture({ id: 'g-2', upload_status: 'awaiting_tags' }),
      ])

      const result = await h.service.listGarments(USER_ID)

      expect(result.data.map((item) => item.id)).toEqual(['g-1', 'g-2'])
      expect(result.data[0]?.imageAccess?.url).toBe('https://storage.test/signed.png')
      expect(h.signReadUrl).toHaveBeenCalledTimes(2)
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
      h.download.mockResolvedValue(validPng)
    })

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
      expect(h.enqueue).toHaveBeenCalledWith(GARMENT_ID)
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
      expect(h.remove).toHaveBeenCalledWith([`wardrobe/${USER_ID}/${GARMENT_ID}.png`])
      expect(h.prisma.$transaction).not.toHaveBeenCalled()
    })

    /** One commit key belongs to one garment; reusing it across garments conflicts. */
    it('reports key reuse when the key already belongs to a different garment', async () => {
      h.prisma.garmentItem.findUnique
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
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(verifiable())
      h.prisma.garmentItem.updateMany.mockResolvedValue({ count: 0 })

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
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          verifiable({
            upload_status: 'processing',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: 'a-different-hash',
          })
        )
      h.prisma.garmentItem.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        h.service.commitGarment(USER_ID, 'guardian', commitInput, IDEMPOTENCY_KEY)
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /** A racing winner that already advanced past processing needs no handoff. */
    it('replays a racing winner that reached awaiting_tags without enqueuing again', async () => {
      h.prisma.garmentItem.findUnique
        .mockResolvedValueOnce(verifiable())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          verifiable({
            upload_status: 'awaiting_tags',
            commit_idempotency_key: IDEMPOTENCY_KEY,
            commit_payload_hash: payloadHash,
          })
        )
      h.prisma.garmentItem.updateMany.mockResolvedValue({ count: 0 })

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
