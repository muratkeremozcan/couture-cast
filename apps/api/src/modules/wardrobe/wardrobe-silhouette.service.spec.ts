/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions read vi.fn() members off their mock object and nest expect.objectContaining(), which is the established pattern for these suites. */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import type { PrismaClient, SilhouetteProfile } from '@prisma/client'
import type { GuardianService } from '../guardian/guardian.service.js'
import type { SilhouettePhotoProcessingQueue } from './silhouette-photo-processing.queue.js'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter.js'
import {
  formatSilhouetteETag,
  parseSilhouetteIfMatchHeader,
  WardrobeSilhouetteService,
} from './wardrobe-silhouette.service.js'

const USER_ID = 'user-1'
const SESSION_ID = 'session-1'
const OBJECT_PATH = `wardrobe/${USER_ID}/silhouette/${SESSION_ID}.png`

/** The committed statuses always carry a commit timestamp in a real row. */
const COMMITTED_MY_FORM_STATUSES = new Set(['processing', 'ready', 'failed'])
const DEFAULT_MY_FORM_COMMITTED_AT = new Date('2026-08-09T11:00:00Z')

/**
 * A deliberately partial row: only the columns the service actually reads.
 *
 * `my_form_committed_at` defaults to a real timestamp whenever the status is one
 * the service only ever reaches after a commit. Leaving it null there describes
 * a row the database never holds, and the response contract now rejects it, so
 * defaulting keeps a caller from having to restate the invariant at every site.
 */
function profileRow(overrides: Record<string, unknown> = {}): SilhouetteProfile {
  const status = overrides.my_form_status
  if (
    typeof status === 'string' &&
    COMMITTED_MY_FORM_STATUSES.has(status) &&
    !('my_form_committed_at' in overrides)
  ) {
    overrides = { ...overrides, my_form_committed_at: DEFAULT_MY_FORM_COMMITTED_AT }
  }

  return {
    id: 'profile-1',
    user_id: USER_ID,
    mode: 'default_mannequin',
    height_slider: 50,
    build_slider: 50,
    revision: 1,
    updated_at: new Date('2026-08-09T10:00:00Z'),
    my_form_object_path: null,
    my_form_upload_session_id: null,
    my_form_upload_idempotency_key: null,
    my_form_commit_idempotency_key: null,
    my_form_commit_payload_hash: null,
    my_form_file_size_bytes: null,
    my_form_mime_type: null,
    my_form_content_sha256: null,
    my_form_width_px: null,
    my_form_height_px: null,
    my_form_upload_expires_at: null,
    my_form_committed_at: null,
    my_form_consent_checked_at: null,
    my_form_status: null,
    my_form_failure_reason: null,
    my_form_moderation_flagged_at: null,
    ...overrides,
  } as unknown as SilhouetteProfile
}

async function portraitPng(width = 300, height = 800): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 210, b: 220 } },
  })
    .png()
    .toBuffer()
}

describe('parseSilhouetteIfMatchHeader / formatSilhouetteETag', () => {
  it('4.4-UNIT-07 round-trips a strong entity tag', () => {
    expect(formatSilhouetteETag(USER_ID, 3)).toBe('"silhouette:user-1:3"')
    expect(parseSilhouetteIfMatchHeader('"silhouette:user-1:3"', USER_ID)).toBe(3)
  })

  it('4.4-UNIT-07 treats "*" as matching any revision', () => {
    expect(parseSilhouetteIfMatchHeader('*', USER_ID)).toBeNull()
  })

  it('4.4-UNIT-07 demands the header, rejecting missing and blank values with 428', () => {
    expect(() => parseSilhouetteIfMatchHeader(undefined, USER_ID)).toThrow(HttpException)
    expect(() => parseSilhouetteIfMatchHeader('   ', USER_ID)).toThrow(HttpException)
  })

  it('4.4-UNIT-07 rejects weak validators, foreign users, and malformed tags', () => {
    expect(() =>
      parseSilhouetteIfMatchHeader('W/"silhouette:user-1:1"', USER_ID)
    ).toThrow(PreconditionFailedException)
    expect(() =>
      parseSilhouetteIfMatchHeader('"silhouette:someone-else:1"', USER_ID)
    ).toThrow(PreconditionFailedException)
    expect(() => parseSilhouetteIfMatchHeader('"garbage"', USER_ID)).toThrow(
      PreconditionFailedException
    )
  })

  it('4.4-UNIT-07 accepts the first matching candidate in a list', () => {
    expect(
      parseSilhouetteIfMatchHeader(
        '"silhouette:someone-else:9", "silhouette:user-1:2"',
        USER_ID
      )
    ).toBe(2)
  })
})

describe('WardrobeSilhouetteService', () => {
  const findUnique = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const updateMany = vi.fn()
  const findUniqueOrThrow = vi.fn()
  const executeRaw = vi.fn()

  const prisma = {
    silhouetteProfile: { findUnique, create, update, updateMany, findUniqueOrThrow },
    $executeRaw: executeRaw,
    $transaction: vi.fn((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(prisma as unknown as PrismaClient)
    ),
  } as unknown as PrismaClient

  const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
  const guardian = { assertWardrobeUploadAllowed } as unknown as GuardianService

  const signReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed')
  const upload = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  const storage = {
    signReadUrl,
    upload,
    remove,
  } as unknown as SupabaseWardrobeStorageAdapter

  const enqueue = vi.fn().mockResolvedValue(undefined)
  const queue = { enqueue } as unknown as SilhouettePhotoProcessingQueue

  let service: WardrobeSilhouetteService

  beforeEach(() => {
    vi.clearAllMocks()
    assertWardrobeUploadAllowed.mockResolvedValue(undefined)
    signReadUrl.mockResolvedValue('https://storage.test/signed')
    upload.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
    enqueue.mockResolvedValue(undefined)
    service = new WardrobeSilhouetteService(prisma, guardian, storage, queue)
  })

  describe('getProfile', () => {
    it('4.4-UNIT-08 returns the virtual default profile when no row exists', async () => {
      findUnique.mockResolvedValueOnce(null)

      const { response, etag } = await service.getProfile(USER_ID)

      expect(response.data).toEqual({
        mode: 'default_mannequin',
        heightSlider: null,
        buildSlider: null,
        myForm: null,
        revision: 0,
        updatedAt: new Date(0).toISOString(),
      })
      expect(etag).toBe(formatSilhouetteETag(USER_ID, 0))
    })

    it('4.4-UNIT-08 signs a read URL only for a ready My Form photo', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'ready',
          my_form_object_path: OBJECT_PATH,
          my_form_committed_at: new Date('2026-08-09T11:00:00Z'),
        })
      )

      const { response } = await service.getProfile(USER_ID)

      expect(signReadUrl).toHaveBeenCalledWith(OBJECT_PATH, 900)
      expect(response.data.myForm).toMatchObject({
        status: 'ready',
        committedAt: '2026-08-09T11:00:00.000Z',
      })
      expect(response.data.myForm?.imageAccess?.url).toBe('https://storage.test/signed')
    })

    it('4.4-UNIT-08 withholds image access while a photo is still processing', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ my_form_status: 'processing', my_form_object_path: OBJECT_PATH })
      )

      const { response } = await service.getProfile(USER_ID)

      expect(signReadUrl).not.toHaveBeenCalled()
      expect(response.data.myForm).toMatchObject({
        status: 'processing',
        imageAccess: null,
      })
    })
  })

  describe('updateSliders', () => {
    it('4.4-UNIT-09 creates the first row at revision 1 in default_mannequin mode', async () => {
      findUnique.mockResolvedValueOnce(null)
      create.mockResolvedValueOnce(
        profileRow({ height_slider: 40, build_slider: 60, revision: 1 })
      )

      const result = await service.updateSliders(
        USER_ID,
        formatSilhouetteETag(USER_ID, 0),
        { heightSlider: 40, buildSlider: 60 }
      )

      expect(result.isNoOp).toBe(false)
      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: USER_ID,
          mode: 'default_mannequin',
          height_slider: 40,
          build_slider: 60,
          revision: 1,
        },
      })
    })

    it('4.4-UNIT-09 rejects a non-zero expected revision when no row exists', async () => {
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.updateSliders(USER_ID, formatSilhouetteETag(USER_ID, 4), {
          heightSlider: 40,
          buildSlider: 60,
        })
      ).rejects.toBeInstanceOf(PreconditionFailedException)
      expect(create).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-09 rejects a stale revision against an existing row', async () => {
      findUnique.mockResolvedValueOnce(profileRow({ revision: 5 }))

      await expect(
        service.updateSliders(USER_ID, formatSilhouetteETag(USER_ID, 4), {
          heightSlider: 40,
          buildSlider: 60,
        })
      ).rejects.toBeInstanceOf(PreconditionFailedException)
      expect(update).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-09 treats an identical save as a no-op that does not bump revision', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ mode: 'default_mannequin', height_slider: 40, build_slider: 60 })
      )

      const result = await service.updateSliders(
        USER_ID,
        formatSilhouetteETag(USER_ID, 1),
        { heightSlider: 40, buildSlider: 60 }
      )

      expect(result.isNoOp).toBe(true)
      expect(update).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-09 switches back from my_form to the mannequin on save', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ mode: 'my_form', height_slider: 40, build_slider: 60 })
      )
      update.mockResolvedValueOnce(profileRow({ revision: 2 }))

      const result = await service.updateSliders(
        USER_ID,
        formatSilhouetteETag(USER_ID, 1),
        { heightSlider: 40, buildSlider: 60 }
      )

      expect(result.isNoOp).toBe(false)
      expect(update).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        data: {
          mode: 'default_mannequin',
          height_slider: 40,
          build_slider: 60,
          revision: { increment: 1 },
        },
      })
    })
  })

  describe('createMyFormUploadUrl', () => {
    const declaration = {
      fileSizeBytes: 1024,
      mimeType: 'image/png' as const,
      sha256: '0'.repeat(64),
      widthPx: 300,
      heightPx: 800,
    }

    it('4.4-UNIT-10 refuses to allocate when guardian consent is missing', async () => {
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'teen', declaration, 'key-1')
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(findUnique).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-10 allocates a fresh session and issues a verifiable upload token', async () => {
      findUnique.mockResolvedValueOnce(null)
      create.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      const result = await service.createMyFormUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        'key-1'
      )

      expect(result.replayed).toBe(false)
      expect(result.response.data.uploadToken).toEqual(expect.any(String))
      expect(result.response.data.requiredHeaders['content-type']).toBe('image/png')
      expect(result.response.data.uploadUrl).toContain(
        '/api/v1/wardrobe/silhouette/my-form/uploads/'
      )
    })

    it('4.4-UNIT-10 replays a live session for the same idempotency key', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: new Date(Date.now() + 60_000),
        })
      )

      const result = await service.createMyFormUploadUrl(
        USER_ID,
        'guardian',
        declaration,
        'key-1'
      )

      expect(result.replayed).toBe(true)
      expect(create).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-10 rejects a replay whose upload window already closed', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_upload_expires_at: new Date(Date.now() - 1),
        })
      )

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('4.4-UNIT-10 rejects reuse of a key already spent on a committed photo', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'ready',
          my_form_upload_idempotency_key: 'key-1',
        })
      )

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('4.4-UNIT-10 removes the superseded object when reallocating', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'failed',
          my_form_object_path: 'wardrobe/user-1/silhouette/old.png',
          my_form_upload_idempotency_key: 'key-0',
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(remove).toHaveBeenCalledWith(['wardrobe/user-1/silhouette/old.png'])
    })

    it('4.4-UNIT-10 survives a failure to remove the superseded object', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'failed',
          my_form_object_path: 'wardrobe/user-1/silhouette/old.png',
          my_form_upload_idempotency_key: 'key-0',
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )
      remove.mockRejectedValueOnce(new Error('storage down'))

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).resolves.toMatchObject({ replayed: false })
    })
  })

  describe('uploadMyFormBytes', () => {
    function pendingSession(bytes: Buffer) {
      return profileRow({
        my_form_status: 'pending_upload',
        my_form_object_path: OBJECT_PATH,
        my_form_upload_session_id: SESSION_ID,
        my_form_upload_expires_at: new Date(Date.now() + 60_000),
        my_form_file_size_bytes: bytes.length,
        my_form_mime_type: 'image/png',
        my_form_content_sha256: createHash('sha256').update(bytes).digest('hex'),
        my_form_width_px: 300,
        my_form_height_px: 800,
      })
    }

    /** Mirrors the token the service itself issues, so the happy path is not
     * asserting against a hand-copied constant that can silently drift. */
    async function tokenFor(profile: SilhouetteProfile): Promise<string> {
      const { generateUploadToken, requireUploadTokenSecret } = await import(
        './wardrobe-upload-token.js'
      )
      return generateUploadToken(
        SESSION_ID,
        USER_ID,
        (profile.my_form_upload_expires_at as Date).toISOString(),
        requireUploadTokenSecret()
      )
    }

    it('4.4-UNIT-11 rejects an unknown upload session with 404', async () => {
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.uploadMyFormBytes(
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

    it('4.4-UNIT-11 refuses a session belonging to another user', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        profileRow({
          ...pendingSession(bytes),
          user_id: 'someone-else',
        })
      )

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('4.4-UNIT-11 refuses a session whose token was already consumed', async () => {
      findUnique.mockResolvedValueOnce(profileRow({ my_form_status: 'bytes_uploaded' }))

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          1,
          Buffer.alloc(1)
        )
      ).rejects.toThrow('UPLOAD_TOKEN_CONSUMED')
    })

    it('4.4-UNIT-11 refuses an expired session', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_expires_at: new Date(Date.now() - 1),
        })
      )

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          'token',
          USER_ID,
          'guardian',
          'image/png',
          1,
          Buffer.alloc(1)
        )
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })

    it('4.4-UNIT-11 refuses a forged upload token', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pendingSession(bytes))

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          'not-the-real-token',
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toThrow('INVALID_UPLOAD_TOKEN')
    })

    it('4.4-UNIT-11 rejects a Content-Length that disagrees with the body', async () => {
      const bytes = await portraitPng()
      const profile = pendingSession(bytes)
      findUnique.mockResolvedValueOnce(profile)

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          await tokenFor(profile),
          USER_ID,
          'guardian',
          'image/png',
          bytes.length + 1,
          bytes
        )
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('4.4-UNIT-11 rejects a content type that contradicts the declaration', async () => {
      const bytes = await portraitPng()
      const profile = pendingSession(bytes)
      findUnique.mockResolvedValueOnce(profile)

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          await tokenFor(profile),
          USER_ID,
          'guardian',
          'image/jpeg',
          bytes.length,
          bytes
        )
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('4.4-UNIT-11 maps a mistyped image body to 415', async () => {
      const bytes = await portraitPng()
      const jpegBytes = await sharp({
        create: {
          width: 300,
          height: 800,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .jpeg()
        .toBuffer()
      const profile = profileRow({
        ...pendingSession(bytes),
        my_form_file_size_bytes: jpegBytes.length,
        my_form_content_sha256: createHash('sha256').update(jpegBytes).digest('hex'),
      })
      findUnique.mockResolvedValueOnce(profile)

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          await tokenFor(profile),
          USER_ID,
          'guardian',
          'image/png',
          jpegBytes.length,
          jpegBytes
        )
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
    })

    it('4.4-UNIT-11 maps a landscape photo to 422 IMAGE_NOT_PORTRAIT_FRAMED', async () => {
      const bytes = await portraitPng(800, 300)
      const profile = profileRow({
        ...pendingSession(bytes),
        my_form_width_px: 800,
        my_form_height_px: 300,
      })
      findUnique.mockResolvedValueOnce(profile)

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          await tokenFor(profile),
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toBeInstanceOf(UnprocessableEntityException)
    })

    it('4.4-UNIT-11 stores the bytes and claims the session on the happy path', async () => {
      const bytes = await portraitPng()
      const profile = pendingSession(bytes)
      findUnique.mockResolvedValueOnce(profile)
      updateMany.mockResolvedValueOnce({ count: 1 })

      await service.uploadMyFormBytes(
        SESSION_ID,
        await tokenFor(profile),
        USER_ID,
        'guardian',
        'image/png',
        bytes.length,
        bytes
      )

      expect(upload).toHaveBeenCalledWith(OBJECT_PATH, bytes, 'image/png')
      // The session id belongs in the guard: a concurrent upload-url
      // reallocation swaps the session on this same one-row-per-user profile,
      // and a status-only guard would credit these bytes to the new session.
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'profile-1',
            my_form_upload_session_id: SESSION_ID,
            my_form_status: 'pending_upload',
          },
        })
      )
      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(USER_ID, 'guardian')
    })

    it('4.4-UNIT-11 removes the stored object when a concurrent caller won the session', async () => {
      const bytes = await portraitPng()
      const profile = pendingSession(bytes)
      findUnique.mockResolvedValueOnce(profile)
      updateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.uploadMyFormBytes(
          SESSION_ID,
          await tokenFor(profile),
          USER_ID,
          'guardian',
          'image/png',
          bytes.length,
          bytes
        )
      ).rejects.toThrow('UPLOAD_TOKEN_CONSUMED')
      expect(remove).toHaveBeenCalledWith([OBJECT_PATH])
    })
  })

  describe('commitMyForm', () => {
    const input = { uploadSessionId: SESSION_ID, confirmsBasewearGuidance: true as const }

    it('4.4-UNIT-12 rejects a commit for an unknown session', async () => {
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('4.4-UNIT-12 rejects a commit naming a different session', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ my_form_upload_session_id: 'other-session' })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('4.4-UNIT-12 replays a commit that used the same idempotency key', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-1',
        })
      )

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(result.response.data.myForm?.status).toBe('processing')
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 rejects a second commit under a different idempotency key', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'ready',
          my_form_commit_idempotency_key: 'key-1',
        })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-2')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    it('4.4-UNIT-12 rejects a commit before the bytes were uploaded', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'pending_upload',
        })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('4.4-UNIT-12 enqueues processing keyed on the upload session, not the profile alone', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'bytes_uploaded',
        })
      )
      updateMany.mockResolvedValueOnce({ count: 1 })
      findUniqueOrThrow.mockResolvedValueOnce(
        profileRow({ my_form_status: 'processing', revision: 2 })
      )

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      // The session id is what makes the BullMQ job id unique per commit; a
      // profile id alone is stable for the account's whole lifetime.
      expect(enqueue).toHaveBeenCalledWith('profile-1', SESSION_ID)
      expect(result.response.data.myForm?.status).toBe('processing')
    })

    it('4.4-UNIT-12 releases the claim when the enqueue fails, so a retry can re-commit', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'bytes_uploaded',
        })
      )
      updateMany.mockResolvedValueOnce({ count: 1 })
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))
      updateMany.mockResolvedValueOnce({ count: 1 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('redis unavailable')

      // Without the release the row stays `processing` with no job behind it:
      // a replay returns the cached processing response and a new key is
      // rejected as reused, so the photo could never be recovered. The
      // upload session identity is cleared too -- a retry against the same
      // session would recompute the same BullMQ job id, and if the failed
      // `enqueue` actually did create that job in Redis (an ambiguous
      // network failure, not a guaranteed no-op), a retry would silently
      // hit the exact collision this job-id scheme exists to prevent.
      expect(updateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', my_form_status: 'processing' },
        data: {
          my_form_status: 'bytes_uploaded',
          my_form_committed_at: null,
          my_form_commit_idempotency_key: null,
          my_form_upload_session_id: null,
          my_form_upload_idempotency_key: null,
        },
      })
    })

    it('4.4-UNIT-12 reports a lost commit race as a conflict', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_upload_session_id: SESSION_ID,
          my_form_status: 'bytes_uploaded',
        })
      )
      updateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(ConflictException)
      expect(enqueue).not.toHaveBeenCalled()
    })
  })

  describe('deleteMyForm', () => {
    it('4.4-UNIT-13 rejects a delete when no profile row exists', async () => {
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 1))
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('4.4-UNIT-13 rejects a delete against a stale revision', async () => {
      findUnique.mockResolvedValueOnce(profileRow({ revision: 5 }))

      await expect(
        service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 1))
      ).rejects.toBeInstanceOf(PreconditionFailedException)
      expect(remove).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-13 clears every My Form column and hard-deletes the stored object', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          revision: 3,
          mode: 'my_form',
          my_form_status: 'ready',
          my_form_object_path: OBJECT_PATH,
        })
      )
      update.mockResolvedValueOnce(profileRow({ revision: 4 }))

      const { response } = await service.deleteMyForm(
        USER_ID,
        formatSilhouetteETag(USER_ID, 3)
      )

      expect(remove).toHaveBeenCalledWith([OBJECT_PATH])
      expect(response.data.mode).toBe('default_mannequin')
      expect(response.data.myForm).toBeNull()
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            my_form_object_path: null,
            my_form_status: null,
            mode: 'default_mannequin',
            revision: { increment: 1 },
          }),
        })
      )
    })
  })
})
