// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions read vi.fn() members off their mock object and nest expect.objectContaining(), which is the established pattern for these suites. */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PreconditionFailedException,
  ServiceUnavailableException,
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
import { PUBLISH_CLAIM_LEASE_MS } from './wardrobe-publication.js'

const USER_ID = 'user-1'
/** Upload session ids are server-minted UUIDs; nothing else may enter a storage key. */
const SESSION_ID = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
const OLD_SESSION_ID = '0a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9'
const OBJECT_PATH = `wardrobe/${USER_ID}/silhouette/${SESSION_ID}.png`
/**
 * Where the session's signed URL writes; never a final path (review round 1, 2026-11-19). Round 3
 * puts the owner and kind in the key; the read policy admits only wardrobe/, so staging stays
 * service-only.
 */
const STAGING_PATH = `staging/${USER_ID}/silhouette/${SESSION_ID}.png`
const FOREIGN_PATH = `wardrobe/user-2/silhouette/${SESSION_ID}.png`
/** The verification ceiling commit reads staged bytes through (MAX_GARMENT_IMAGE_BYTES). */
const MAX_BYTES = 10_485_760

/** The committed statuses always carry a commit timestamp in a real row. */
const COMMITTED_MY_FORM_STATUSES = new Set(['processing', 'ready', 'failed'])
const DEFAULT_MY_FORM_COMMITTED_AT = new Date('2026-08-09T11:00:00Z')

/** Fixed upload-window boundary fixtures. Deliberately not derived from
 * `Date.now()`: the service only ever compares `my_form_upload_expires_at`
 * against the live clock, so a fixture built from a wall-clock read couples
 * test-fixture construction to execution time for no behavioral benefit.
 * These two constants make every "not yet expired" / "already expired" case
 * in this file reproducible regardless of when the suite runs. */
const NOT_YET_EXPIRED = new Date('2099-01-01T00:00:00.000Z')
const ALREADY_EXPIRED = new Date('2020-01-01T00:00:00.000Z')

/**
 * Round 4: the fixed wall clock publication claims are judged against. A claim started
 * `LIVE_CLAIM_STARTED_AT` is still inside its lease; one started `STALE_CLAIM_STARTED_AT` is past
 * it and may be taken over.
 */
const FIXED_NOW = new Date('2026-11-19T18:00:00.000Z')
/** Round 6: the cleanup horizon a claim at FIXED_NOW records. */
const CLEANUP_HORIZON = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000)
const LIVE_CLAIM_STARTED_AT = new Date(FIXED_NOW.getTime() - 10_000)
/** Round 5 (C4-5): a removal that met this claim repeats until 24 hours after it started. */
const LIVE_CLAIM_REMOVAL_HORIZON = new Date(
  LIVE_CLAIM_STARTED_AT.getTime() + 24 * 60 * 60 * 1000
)
const STALE_CLAIM_CUTOFF = new Date(FIXED_NOW.getTime() - PUBLISH_CLAIM_LEASE_MS)
const OTHER_ATTEMPT_ID = '9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b5a4'

/** The storage signed upload session the adapter double hands out. */
const SIGNED_UPLOAD = {
  uploadUrl: `https://storage.test/storage/v1/object/upload/sign/wardrobe-images/${OBJECT_PATH}?token=signed-upload-token`,
  uploadToken: 'signed-upload-token',
  tokenExpiresAt: new Date('2099-06-01T00:00:00.000Z'),
}

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
    my_form_publish_attempt_id: null,
    my_form_publish_started_at: null,
    my_form_processing_job_enqueued_at: null,
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

  /**
   * `Number()` returns 1e21 for a 21-digit revision. Accepting it would compare
   * the stored revision against a value no row can hold, so the precondition has
   * to fail loudly instead of silently never matching.
   */
  it('4.4-UNIT-07 rejects a revision beyond the safe integer range', () => {
    expect(() =>
      parseSilhouetteIfMatchHeader('"silhouette:user-1:999999999999999999999"', USER_ID)
    ).toThrow(PreconditionFailedException)
  })
})

describe('WardrobeSilhouetteService', () => {
  const findUnique = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const updateMany = vi.fn()
  const findUniqueOrThrow = vi.fn()
  const executeRaw = vi.fn()

  /** Row locks (`SELECT ... FOR UPDATE`) the service's own transactions take. */
  const txQueryRaw = vi.fn()

  /**
   * The deletion outbox (round 3). Rows written inside an interactive transaction land on
   * `txDeletionCreateMany`; rows written on their own (commit compensation, released staging)
   * land on `deletionCreateMany`. Keeping them apart is how a test proves a deletion was
   * recorded in the same transaction as the state change that orphaned the object.
   */
  const txDeletionCreateMany = vi.fn()
  const txDeletionUpdateMany = vi.fn()
  const deletionCreateMany = vi.fn()
  const deletionUpdateMany = vi.fn()

  /**
   * Round 4: the outbox settles each key in its own transaction (the only one this service's
   * code opens with options), on this separate client: it locks and reads the key's
   * authoritative profile row and its outbox row, then removes the object. No profile matches
   * by default, so every recorded key is removable and its row due.
   */
  const settleQueryRaw = vi.fn()
  const judgedProfile = vi.fn()
  const deletionFindUnique = vi.fn()
  const deletionUpdate = vi.fn()
  const deletionDelete = vi.fn()
  const settleTx = {
    $queryRaw: settleQueryRaw,
    silhouetteProfile: { findUnique: judgedProfile },
    wardrobeObjectDeletion: {
      findUnique: deletionFindUnique,
      update: deletionUpdate,
      delete: deletionDelete,
    },
  }

  const silhouetteProfile = {
    findUnique,
    create,
    update,
    updateMany,
    findUniqueOrThrow,
  }

  const tx = {
    silhouetteProfile,
    wardrobeObjectDeletion: {
      createMany: txDeletionCreateMany,
      updateMany: txDeletionUpdateMany,
    },
    $executeRaw: executeRaw,
    $queryRaw: txQueryRaw,
  }

  const transaction = vi.fn(
    (callback: (client: unknown) => Promise<unknown>, options?: unknown) =>
      callback(options === undefined ? tx : settleTx)
  )

  const prisma = {
    silhouetteProfile,
    wardrobeObjectDeletion: {
      createMany: deletionCreateMany,
      updateMany: deletionUpdateMany,
      findMany: vi.fn().mockResolvedValue([]),
    },
    $executeRaw: executeRaw,
    $transaction: transaction,
  } as unknown as PrismaClient

  const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
  const guardian = { assertWardrobeUploadAllowed } as unknown as GuardianService

  const signReadUrl = vi.fn().mockResolvedValue('https://storage.test/signed')
  const createUploadSession = vi.fn().mockResolvedValue(SIGNED_UPLOAD)
  const downloadBounded = vi.fn().mockResolvedValue({ status: 'missing' })
  const publish = vi.fn().mockResolvedValue(undefined)
  const remove = vi.fn().mockResolvedValue(undefined)
  const storage = {
    signReadUrl,
    createUploadSession,
    downloadBounded,
    publish,
    remove,
  } as unknown as SupabaseWardrobeStorageAdapter

  const enqueue = vi.fn().mockResolvedValue(undefined)
  const queue = { enqueue } as unknown as SilhouettePhotoProcessingQueue

  let service: WardrobeSilhouetteService

  beforeEach(() => {
    vi.clearAllMocks()
    assertWardrobeUploadAllowed.mockResolvedValue(undefined)
    signReadUrl.mockResolvedValue('https://storage.test/signed')
    createUploadSession.mockResolvedValue(SIGNED_UPLOAD)
    downloadBounded.mockResolvedValue({ status: 'missing' })
    publish.mockResolvedValue(undefined)
    remove.mockResolvedValue(undefined)
    txQueryRaw.mockResolvedValue([])
    txDeletionCreateMany.mockResolvedValue({ count: 1 })
    txDeletionUpdateMany.mockResolvedValue({ count: 0 })
    deletionCreateMany.mockResolvedValue({ count: 1 })
    deletionUpdateMany.mockResolvedValue({ count: 1 })
    settleQueryRaw.mockResolvedValue([])
    judgedProfile.mockResolvedValue(null)
    deletionFindUnique.mockImplementation(
      ({ where }: { where: { object_path: string } }) =>
        Promise.resolve({
          id: `deletion:${where.object_path}`,
          object_path: where.object_path,
          reason: 'recorded',
          not_before: new Date(0),
        })
    )
    deletionUpdate.mockResolvedValue({})
    deletionDelete.mockResolvedValue({})
    // Claims, transitions, releases and handoff markers each match their row unless a test
    // says otherwise.
    updateMany.mockResolvedValue({ count: 1 })
    enqueue.mockResolvedValue(undefined)
    service = new WardrobeSilhouetteService(prisma, guardian, storage, queue)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Freezes `Date` (only) at `FIXED_NOW`, so claim leases are judged deterministically. */
  function freezeClock() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FIXED_NOW)
  }

  /**
   * The outbox rows a `createMany` call wrote for a removal due now that repeats until
   * `repeatUntil`.
   */
  function recordedRepeating(paths: string[], reason: string, repeatUntil: Date) {
    return {
      data: paths.map((object_path) => ({
        object_path,
        reason,
        not_before: FIXED_NOW,
        repeat_until: repeatUntil,
      })),
      skipDuplicates: true,
    }
  }

  /** The settle reads the repeating rows `recordedRepeating` wrote. */
  function outboxRowsRepeatUntil(repeatUntil: Date) {
    deletionFindUnique.mockImplementation(
      ({ where }: { where: { object_path: string } }) =>
        Promise.resolve({
          id: `deletion:${where.object_path}`,
          object_path: where.object_path,
          reason: 'recorded',
          not_before: FIXED_NOW,
          repeat_until: repeatUntil,
        })
    )
  }

  /** The publication attempt id the commit's claim wrote (minted per commit). */
  function claimedAttemptId(): string {
    const claim = updateMany.mock.calls[0]?.[0] as {
      data: { my_form_publish_attempt_id: string }
    }
    return claim.data.my_form_publish_attempt_id
  }

  /** A processing row for this session, as the claim leaves it. */
  function processingRow(overrides: Record<string, unknown> = {}) {
    return profileRow({
      my_form_status: 'processing',
      my_form_object_path: OBJECT_PATH,
      my_form_upload_session_id: SESSION_ID,
      my_form_commit_idempotency_key: 'key-1',
      revision: 2,
      ...overrides,
    })
  }

  /** The outbox rows a `createMany` call wrote. */
  function recorded(paths: string[], reason: string) {
    return {
      data: paths.map((object_path) => ({ object_path, reason })),
      skipDuplicates: true,
    }
  }

  /** Storage holds these bytes at the key commit reads. */
  function stored(bytes: Buffer) {
    return { status: 'present' as const, bytes }
  }

  /** A row whose upload session is pending bytes for the given content. */
  function pending(bytes: Buffer, overrides: Record<string, unknown> = {}) {
    return profileRow({
      my_form_status: 'pending_upload',
      my_form_object_path: OBJECT_PATH,
      my_form_upload_session_id: SESSION_ID,
      my_form_upload_expires_at: NOT_YET_EXPIRED,
      my_form_file_size_bytes: bytes.length,
      my_form_mime_type: 'image/png',
      my_form_content_sha256: createHash('sha256').update(bytes).digest('hex'),
      my_form_width_px: 300,
      my_form_height_px: 800,
      ...overrides,
    })
  }

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
          my_form_upload_session_id: SESSION_ID,
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

    /** Review round 1, 2026-11-19 (Codex 1): never sign another member's object. */
    it('4.4-UNIT-08 refuses to sign a ready photo whose path is not the member own', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ my_form_status: 'ready', my_form_object_path: FOREIGN_PATH })
      )

      await expect(service.getProfile(USER_ID)).rejects.toThrow('UPLOAD_PATH_INVALID')
      expect(signReadUrl).not.toHaveBeenCalled()
    })

    /**
     * Review round 2 (Codex C2-2): parse-and-compare checks the exact object id, so a sibling
     * session's photo of the same member is not this row's to sign.
     */
    it("4.4-UNIT-08 refuses to sign the member's photo of another session", async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'ready',
          my_form_object_path: `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`,
          my_form_upload_session_id: SESSION_ID,
        })
      )

      await expect(service.getProfile(USER_ID)).rejects.toThrow('UPLOAD_PATH_INVALID')
      expect(signReadUrl).not.toHaveBeenCalled()
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

    it('4.4-UNIT-10 allocates a fresh session with a storage signed upload URL for its one object', async () => {
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

      const [{ data }] = create.mock.calls[0] as [
        {
          data: {
            my_form_object_path: string
            my_form_upload_session_id: string
            my_form_upload_expires_at: Date
          }
        },
      ]
      // Bytes go straight to storage, and the signed URL names only the session's staging key:
      // a final path a later delete or replacement could see written again is never signed.
      expect(data.my_form_object_path).toBe(
        `wardrobe/${USER_ID}/silhouette/${data.my_form_upload_session_id}.png`
      )
      expect(createUploadSession).toHaveBeenCalledTimes(1)
      expect(createUploadSession).toHaveBeenCalledWith(
        `staging/${USER_ID}/silhouette/${data.my_form_upload_session_id}.png`
      )
      expect(result.replayed).toBe(false)
      expect(result.response.data).toEqual({
        uploadSessionId: data.my_form_upload_session_id,
        uploadUrl: SIGNED_UPLOAD.uploadUrl,
        uploadToken: SIGNED_UPLOAD.uploadToken,
        requiredHeaders: { 'content-type': 'image/png' },
        // The session window is shorter than the token's here.
        expiresAt: data.my_form_upload_expires_at.toISOString(),
      })
    })

    it('4.4-UNIT-10 tells the client the token expiry when the token ends before the session', async () => {
      const tokenExpiresAt = new Date(Date.now() + 60_000)
      createUploadSession.mockResolvedValueOnce({ ...SIGNED_UPLOAD, tokenExpiresAt })
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

      expect(result.response.data.expiresAt).toBe(tokenExpiresAt.toISOString())
    })

    /**
     * Review round 2 (Codex C2-6): the replay re-signs the same staging key, so a client whose
     * allocation answer was lost gets a live URL for the key nothing has written yet.
     */
    it('4.4-UNIT-10 replays a live session for the same idempotency key, re-signing its staging key', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_object_path: OBJECT_PATH,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: NOT_YET_EXPIRED,
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
      // Signed afresh for the session's existing staging key, so a retry gets a live URL. The
      // first call signed the unused fresh key before the row was read.
      expect(createUploadSession).toHaveBeenCalledTimes(2)
      expect(createUploadSession).toHaveBeenLastCalledWith(STAGING_PATH)
      expect(result.response.data).toEqual({
        uploadSessionId: SESSION_ID,
        uploadUrl: SIGNED_UPLOAD.uploadUrl,
        uploadToken: SIGNED_UPLOAD.uploadToken,
        requiredHeaders: { 'content-type': 'image/png' },
        expiresAt: NOT_YET_EXPIRED.toISOString(),
      })
    })

    it('4.4-UNIT-10 rejects a replay whose upload window already closed', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_upload_expires_at: ALREADY_EXPIRED,
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

    /**
     * Round 3 (Codex C2-4): the superseded photo is recorded for deletion in the replacing
     * transaction, so a failed removal is retried by the hourly job instead of forgotten.
     */
    it('4.4-UNIT-10 records the superseded object in the replacing transaction and removes it', async () => {
      const oldPath = `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'failed',
          my_form_object_path: oldPath,
          my_form_upload_idempotency_key: 'key-0',
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([oldPath], 'my_form_replaced')
      )
      expect(deletionCreateMany).not.toHaveBeenCalled()
      // Round 4: the profile row is locked before it is read, so a commit's publication claim
      // either landed first (and is seen) or waits for this replacement.
      expect(txQueryRaw).toHaveBeenCalledOnce()
      expect((txQueryRaw.mock.calls[0]?.[0] as string[]).join('?')).toBe(
        'SELECT 1 FROM "SilhouetteProfile" WHERE user_id = ? FOR UPDATE'
      )
      expect(txQueryRaw.mock.calls[0]?.slice(1)).toEqual([USER_ID])
      expect(remove).toHaveBeenCalledExactlyOnceWith([oldPath])
      expect(deletionDelete).toHaveBeenCalledExactlyOnceWith({
        where: { id: `deletion:${oldPath}` },
      })
    })

    /**
     * Round 5 (Codex C4-5): a commit of the replaced session claimed its publication and may still
     * write the final key, even after its answer is lost, and storage may finish that write after
     * the lease. The keys are removed now and the removal repeats every 15 minutes until 24 hours
     * after the claim started, so a write that lands late is removed whenever it lands. Round 4
     * removed nothing until the lease ended and settled after one removal.
     */
    it('4.4-UNIT-10 removes the replaced session keys now and repeats the removal while a publication is unfinished', async () => {
      freezeClock()
      outboxRowsRepeatUntil(LIVE_CLAIM_REMOVAL_HORIZON)
      const oldPath = `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      const oldStaging = `staging/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_object_path: oldPath,
          my_form_upload_session_id: OLD_SESSION_ID,
          my_form_mime_type: 'image/png',
          my_form_upload_idempotency_key: 'key-0',
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: LIVE_CLAIM_STARTED_AT,
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recordedRepeating(
          [oldPath, oldStaging],
          'my_form_replaced',
          LIVE_CLAIM_REMOVAL_HORIZON
        )
      )
      // A row recorded earlier for the same key takes the later horizon and is due now.
      expect(txDeletionUpdateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          object_path: { in: [oldPath, oldStaging] },
          OR: [
            { repeat_until: null },
            { repeat_until: { lt: LIVE_CLAIM_REMOVAL_HORIZON } },
          ],
        },
        data: { repeat_until: LIVE_CLAIM_REMOVAL_HORIZON, not_before: FIXED_NOW },
      })
      expect(remove.mock.calls).toEqual([[[oldPath]], [[oldStaging]]])
      // The rows stay, due again in 15 minutes.
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(deletionUpdate).toHaveBeenCalledTimes(2)
      expect(deletionUpdate).toHaveBeenCalledWith({
        where: { id: `deletion:${oldPath}` },
        data: {
          not_before: new Date(FIXED_NOW.getTime() + 15 * 60 * 1000),
          attempts: 0,
          last_error: null,
        },
      })
    })

    it('4.4-UNIT-10 removes the replaced session keys at once when its claim lease already ran out', async () => {
      freezeClock()
      const oldPath = `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      const oldStaging = `staging/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_object_path: oldPath,
          my_form_upload_session_id: OLD_SESSION_ID,
          my_form_mime_type: 'image/png',
          my_form_upload_idempotency_key: 'key-0',
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: new Date(STALE_CLAIM_CUTOFF.getTime() - 1),
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([oldPath, oldStaging], 'my_form_replaced')
      )
      expect(remove.mock.calls).toEqual([[[oldPath]], [[oldStaging]]])
    })

    /**
     * Round 4 (Codex C3-3): staging keys take one write, so a replay cannot re-sign a key that
     * already holds bytes; the adapter answers 409 UPLOAD_BYTES_PRESENT and the service passes it
     * on unchanged.
     */
    it('4.4-UNIT-10 answers a replay whose staging key already holds bytes with 409 UPLOAD_BYTES_PRESENT', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_object_path: OBJECT_PATH,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: NOT_YET_EXPIRED,
        })
      )
      createUploadSession
        .mockResolvedValueOnce(SIGNED_UPLOAD)
        .mockRejectedValueOnce(new ConflictException('UPLOAD_BYTES_PRESENT'))

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_BYTES_PRESENT'))
      expect(createUploadSession).toHaveBeenLastCalledWith(STAGING_PATH)
      expect(update).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    /**
     * Review round 1, 2026-11-19 (lens 2): a replaced session that never committed left its
     * unverified bytes at its staging key; reallocation removes them along with the old photo.
     */
    it('4.4-UNIT-10 removes a replaced pending session staging key too', async () => {
      const oldPath = `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.jpg`
      const oldStaging = `staging/${USER_ID}/silhouette/${OLD_SESSION_ID}.jpg`
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_object_path: oldPath,
          my_form_upload_session_id: OLD_SESSION_ID,
          my_form_mime_type: 'image/jpeg',
          my_form_upload_idempotency_key: 'key-0',
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([oldPath, oldStaging], 'my_form_replaced')
      )
      // Round 4: each key is judged and removed in its own locked transaction.
      expect(remove.mock.calls).toEqual([[[oldPath]], [[oldStaging]]])
    })

    /**
     * Review round 1, 2026-11-19 (Codex 1): a member could write their own path columns. A
     * reallocation must never delete what a column names unless it is the member's own photo.
     */
    it('4.4-UNIT-10 never removes a superseded path naming another member', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'failed',
          my_form_object_path: FOREIGN_PATH,
          my_form_upload_idempotency_key: 'key-0',
        })
      )
      update.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow(data))
      )

      await service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')

      expect(remove).not.toHaveBeenCalled()
      expect(txDeletionCreateMany).not.toHaveBeenCalled()
    })

    /**
     * Round 3 (Codex C2-2): a row whose stored path or ids cannot be trusted is treated as an
     * expired session, answered before its staging key is ever signed.
     */
    it('4.4-UNIT-10 answers a replay whose stored path is not the session own as an expired session before signing it', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_object_path: FOREIGN_PATH,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: NOT_YET_EXPIRED,
        })
      )

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      // Only the fresh session's own staging key was signed, before the row was read.
      expect(createUploadSession).toHaveBeenCalledTimes(1)
      expect(createUploadSession).not.toHaveBeenCalledWith(STAGING_PATH)
    })

    it('4.4-UNIT-10 answers a replay whose historical session id is not a UUID as an expired session', async () => {
      // A malformed id and the path built from it agree with each other; both still fail.
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'key-1',
          my_form_upload_session_id: '../palette/x',
          my_form_object_path: `wardrobe/${USER_ID}/silhouette/../palette/x.png`,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: NOT_YET_EXPIRED,
        })
      )

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(createUploadSession).toHaveBeenCalledTimes(1)
      expect(createUploadSession.mock.calls[0]?.[0]).toMatch(
        new RegExp(`^staging/${USER_ID}/silhouette/[0-9a-f-]{36}\\.png$`)
      )
    })

    it('4.4-UNIT-10 keeps the current photo when storage cannot sign the upload', async () => {
      createUploadSession.mockRejectedValueOnce(new Error('storage down'))

      await expect(
        service.createMyFormUploadUrl(USER_ID, 'guardian', declaration, 'key-1')
      ).rejects.toThrow('storage down')
      // Signing runs before the transaction, so the current photo is neither replaced nor removed.
      expect(findUnique).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-10 survives a failure to remove the superseded object and keeps it recorded for retry', async () => {
      const oldPath = `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'failed',
          my_form_object_path: oldPath,
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
      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([oldPath], 'my_form_replaced')
      )
      // The row stays for the hourly retry, pushed back and counted.
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(deletionUpdateMany).toHaveBeenCalledWith({
        where: { object_path: oldPath },
        data: expect.objectContaining({ attempts: { increment: 1 } }),
      })
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
        processingRow({
          my_form_processing_job_enqueued_at: DEFAULT_MY_FORM_COMMITTED_AT,
        })
      )

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(result.response.data.myForm?.status).toBe('processing')
      // Its job handoff is recorded, so nothing is enqueued again and nothing is claimed.
      expect(enqueue).not.toHaveBeenCalled()
      expect(updateMany).not.toHaveBeenCalled()
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    /**
     * Round 4 (Codex C3-5): the function stopped after the claim and before the job reached the
     * queue. The row is processing with no handoff marker; the same-key replay enqueues the job
     * under its deterministic id and records the handoff.
     */
    it('4.4-UNIT-12 re-enqueues on a same-key replay of a processing photo whose job handoff never happened', async () => {
      findUnique.mockResolvedValueOnce(processingRow())

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      expect(updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: 'profile-1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_ID,
          my_form_processing_job_enqueued_at: null,
        },
        data: { my_form_processing_job_enqueued_at: expect.any(Date) },
      })
      expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
        updateMany.mock.invocationCallOrder[0]!
      )
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
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

    it('4.4-UNIT-12 answers 409 UPLOAD_BYTES_MISSING when storage has no object yet', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce({ status: 'missing' })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_BYTES_MISSING'))
      // The session stays pending, so the client can finish the PUT and commit again: the
      // claim taken before the read is given back, since no write of the final key started.
      expect(downloadBounded).toHaveBeenCalledWith(STAGING_PATH, MAX_BYTES)
      expect(publish).not.toHaveBeenCalled()
      expect(updateMany).toHaveBeenCalledTimes(2)
      expect(updateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', my_form_publish_attempt_id: claimedAttemptId() },
        data: { my_form_publish_attempt_id: null, my_form_publish_started_at: null },
      })
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 releases the claim when storage fails before anything was published', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockRejectedValueOnce(
        new ServiceUnavailableException('STORAGE_UNAVAILABLE')
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ServiceUnavailableException('STORAGE_UNAVAILABLE'))
      expect(publish).not.toHaveBeenCalled()
      expect(updateMany).toHaveBeenCalledTimes(2)
      expect(updateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', my_form_publish_attempt_id: claimedAttemptId() },
        data: { my_form_publish_attempt_id: null, my_form_publish_started_at: null },
      })
    })

    /**
     * Round 4 (Codex C3-1): a publish that failed may still land, so its claim stays until the
     * lease runs out. A deletion meeting it meanwhile waits, and a retry answers
     * UPLOAD_IN_PROGRESS until then.
     */
    it('4.4-UNIT-12 keeps the claim when a started publish fails, since its write may still land', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      publish.mockRejectedValueOnce(
        new ServiceUnavailableException('STORAGE_PERMISSION_DENIED')
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ServiceUnavailableException('STORAGE_PERMISSION_DENIED'))
      // The claim only: no release, no transition.
      expect(updateMany).toHaveBeenCalledOnce()
      expect(enqueue).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 answers 409 UPLOAD_SESSION_EXPIRED for a pending session past its window', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_upload_expires_at: ALREADY_EXPIRED })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(updateMany).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 rejects a commit for a session with no upload in flight', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({ my_form_upload_session_id: SESSION_ID, my_form_status: null })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(downloadBounded).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 refuses a commit when guardian consent is missing, before reading storage', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.commitMyForm(USER_ID, 'teen', input, 'key-1')
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(updateMany).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 claims the publication, verifies the stored bytes and moves the session on guarded on that claim', async () => {
      freezeClock()
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      findUniqueOrThrow.mockResolvedValue(processingRow())

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(USER_ID, 'guardian')
      // Round 4 (Codex C3-1): the publication is claimed before any storage I/O, guarded on an
      // unexpired pending session (or a legacy relay upload) with no live claim.
      const attemptId = claimedAttemptId()
      expect(updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'profile-1',
          my_form_upload_session_id: SESSION_ID,
          OR: [
            {
              my_form_status: 'pending_upload',
              my_form_upload_expires_at: { gt: FIXED_NOW },
            },
            { my_form_status: 'bytes_uploaded' },
          ],
          AND: [
            {
              OR: [
                { my_form_publish_attempt_id: null },
                { my_form_publish_started_at: null },
                { my_form_publish_started_at: { lt: STALE_CLAIM_CUTOFF } },
              ],
            },
          ],
        },
        // Round 6 (Codex C5-2): the claim records its cleanup horizon, 24 hours out.
        data: {
          my_form_publish_attempt_id: attemptId,
          my_form_publish_started_at: FIXED_NOW,
          my_form_publish_cleanup_until: CLEANUP_HORIZON,
        },
      })
      expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        downloadBounded.mock.invocationCallOrder[0]!
      )
      expect(downloadBounded).toHaveBeenCalledExactlyOnceWith(STAGING_PATH, MAX_BYTES)
      // Round 3 (Codex C2-1, C2-9): the server writes the verified buffer to the final key with
      // the verified type before the session moves on; nothing moves the client's object.
      expect(publish).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, bytes, 'image/png')
      expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
        updateMany.mock.invocationCallOrder[1]!
      )
      // The session id and the attempt's own claim belong in the guard: a reallocation swaps
      // the session on this one-row-per-user profile, and only the attempt that published may
      // move the row on.
      expect(updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'profile-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_publish_attempt_id: attemptId,
          my_form_status: { in: ['pending_upload', 'bytes_uploaded'] },
        },
        data: expect.objectContaining({
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-1',
          my_form_publish_attempt_id: null,
          my_form_publish_started_at: null,
          my_form_processing_job_enqueued_at: null,
        }),
      })
      // Round 4 (Codex C3-5): the job handoff comes first, then its marker, then the cleanup.
      expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      expect(updateMany).toHaveBeenNthCalledWith(3, {
        where: {
          id: 'profile-1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_ID,
          my_form_processing_job_enqueued_at: null,
        },
        data: { my_form_processing_job_enqueued_at: FIXED_NOW },
      })
      expect(updateMany.mock.invocationCallOrder[1]).toBeLessThan(
        enqueue.mock.invocationCallOrder[0]!
      )
      // Round 3 (Codex C2-5): staging is released only once the claim holds, through the outbox.
      expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([STAGING_PATH], 'commit_staging_released')
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(updateMany.mock.invocationCallOrder[2]).toBeLessThan(
        remove.mock.invocationCallOrder[0]!
      )
      expect(result.replayed).toBe(false)
      expect(result.response.data.myForm?.status).toBe('processing')
    })

    /**
     * Round 4 (Codex C3-1): two commits of one session. The second finds the first one's live
     * publication claim and answers 409 UPLOAD_IN_PROGRESS without reading or writing storage,
     * so it can never publish after the first one's purge or erasure.
     */
    it('4.4-UNIT-12 answers 409 UPLOAD_IN_PROGRESS without touching storage while another attempt owns the publication', async () => {
      freezeClock()
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
        pending(bytes, {
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: LIVE_CLAIM_STARTED_AT,
        })
      )
      updateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_IN_PROGRESS'))
      expect(updateMany).toHaveBeenCalledOnce()
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 4 (Codex C3-1): a same-key commit that arrives after the owner finished (moved the
     * session on, analysed it, even purged it) replays the owner's outcome and never publishes.
     */
    it('4.4-UNIT-12 replays the owner outcome for a same-key commit that lost the claim, without publishing', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
        processingRow({
          my_form_status: 'ready',
          my_form_processing_job_enqueued_at: DEFAULT_MY_FORM_COMMITTED_AT,
        })
      )
      updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(result.response.data.myForm?.status).toBe('ready')
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 answers UPLOAD_SESSION_EXPIRED when the claim finds the session ended without a live claim', async () => {
      const bytes = await portraitPng()
      findUnique
        .mockResolvedValueOnce(pending(bytes))
        .mockResolvedValueOnce(profileRow({ my_form_upload_session_id: null }))
      updateMany.mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    /**
     * Round 4: a claim older than the API function's maximum duration plus the margin belongs to
     * an attempt that has ended, so the claim's guard lets a retry take it over.
     */
    it('4.4-UNIT-12 takes over a claim whose lease ran out and publishes', async () => {
      freezeClock()
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, {
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: new Date(STALE_CLAIM_CUTOFF.getTime() - 1),
        })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      findUniqueOrThrow.mockResolvedValue(processingRow())

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      const claim = updateMany.mock.calls[0]?.[0] as {
        where: { AND: [{ OR: Record<string, unknown>[] }] }
        data: { my_form_publish_attempt_id: string }
      }
      expect(claim.where.AND[0].OR).toContainEqual({
        my_form_publish_started_at: { lt: STALE_CLAIM_CUTOFF },
      })
      expect(claim.data.my_form_publish_attempt_id).not.toBe(OTHER_ATTEMPT_ID)
      expect(publish).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, bytes, 'image/png')
      expect(result.replayed).toBe(false)
    })

    it('4.4-UNIT-12 reads staged bytes once and publishes exactly the buffer it verified', async () => {
      const verified = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(verified))
      // Any later read of the staging key would see a newer generation a signed PUT wrote after
      // verification; commit must never read staging again or publish anything but `verified`.
      const newerGeneration = await portraitPng(310, 800)
      downloadBounded
        .mockResolvedValueOnce(stored(verified))
        .mockResolvedValue(stored(newerGeneration))
      findUniqueOrThrow.mockResolvedValue(processingRow())

      await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(downloadBounded).toHaveBeenCalledOnce()
      expect(publish).toHaveBeenCalledOnce()
      expect(publish.mock.calls[0]?.[1]).toBe(verified)
    })

    it('4.4-UNIT-12 refuses an oversized stored object as IMAGE_SIZE_MISMATCH without buffering it', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce({ status: 'too_large' })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_SIZE_MISMATCH'))
      expect(publish).not.toHaveBeenCalled()
      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([STAGING_PATH], 'upload_rejected')
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
    })

    /**
     * Round 6 (Codex C5-2): an attempt that took over a stale claim and then rejects the bytes
     * clears the session and its recorded horizon, while the earlier attempt may still write the
     * final key. The rejection records both keys as a removal repeating until that horizon.
     */
    it('4.4-UNIT-12 repeats the removal of a rejected session keys until the horizon an earlier claim recorded', async () => {
      freezeClock()
      const bytes = await portraitPng()
      const earlierHorizon = new Date(FIXED_NOW.getTime() + 23 * 60 * 60 * 1000)
      findUnique.mockResolvedValueOnce(
        pending(bytes, {
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: new Date(STALE_CLAIM_CUTOFF.getTime() - 1),
          my_form_publish_cleanup_until: earlierHorizon,
        })
      )
      downloadBounded.mockResolvedValueOnce({ status: 'too_large' })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_SIZE_MISMATCH'))

      expect(publish).not.toHaveBeenCalled()
      expect(txDeletionCreateMany.mock.calls).toEqual([
        [recorded([STAGING_PATH], 'upload_rejected')],
        [
          {
            data: [OBJECT_PATH, STAGING_PATH].map((object_path) => ({
              object_path,
              reason: 'upload_rejected',
              not_before: FIXED_NOW,
              repeat_until: earlierHorizon,
            })),
            skipDuplicates: true,
          },
        ],
      ])
      expect(remove.mock.calls).toEqual(
        expect.arrayContaining([[[STAGING_PATH]], [[OBJECT_PATH]]])
      )
    })

    it('4.4-UNIT-12 still commits a legacy bytes_uploaded session past its upload window', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, {
          my_form_status: 'bytes_uploaded',
          my_form_upload_expires_at: ALREADY_EXPIRED,
        })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      findUniqueOrThrow.mockResolvedValue(processingRow())

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      // Its bytes already sit at the final path: verified there, never republished.
      expect(downloadBounded).toHaveBeenCalledWith(OBJECT_PATH, MAX_BYTES)
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).toHaveBeenCalledWith('profile-1', SESSION_ID)
      expect(result.response.data.myForm?.status).toBe('processing')
    })

    it('4.4-UNIT-12 enqueues processing keyed on the upload session, not the profile alone', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_status: 'bytes_uploaded' })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      findUniqueOrThrow.mockResolvedValue(processingRow())

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      // The session id is what makes the BullMQ job id unique per commit; a
      // profile id alone is stable for the account's whole lifetime.
      expect(enqueue).toHaveBeenCalledWith('profile-1', SESSION_ID)
      expect(result.response.data.myForm?.status).toBe('processing')
    })

    /**
     * Round 4 (Codex C3-5) replaces the enqueue-failure rollback: the row stays processing with
     * no handoff marker, the commit answers the enqueue error, and the same-key replay (or the
     * hourly maintenance job) enqueues again under the same deterministic job id. The claim is
     * not released and the session is not cleared, and staging stays until a handoff is
     * recorded.
     */
    it('4.4-UNIT-12 leaves the photo processing with no handoff marker when the enqueue fails', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      findUniqueOrThrow.mockResolvedValue(processingRow())
      enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('redis unavailable')

      // The claim and the transition only: no rollback write, no marker.
      expect(updateMany).toHaveBeenCalledTimes(2)
      expect(updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            my_form_status: 'processing',
            my_form_processing_job_enqueued_at: null,
          }),
        })
      )
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 reports a lost commit race as a conflict', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_status: 'bytes_uploaded' })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(ConflictException)
      expect(enqueue).not.toHaveBeenCalled()
      // The publish returned, so the claim is given back.
      expect(updateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', my_form_publish_attempt_id: claimedAttemptId() },
        data: { my_form_publish_attempt_id: null, my_form_publish_started_at: null },
      })
    })

    /**
     * Round 3: a claim lost because the session was replaced leaves a published final object
     * nothing will ever claim, so it is recorded and removed. Staging stays for the sweep.
     */
    it('4.4-UNIT-12 records and removes the published photo when a replacement took the session', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
        pending(bytes, {
          my_form_upload_session_id: OLD_SESSION_ID,
          my_form_object_path: `wardrobe/${USER_ID}/silhouette/${OLD_SESSION_ID}.png`,
        })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      expect(deletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([OBJECT_PATH], 'commit_compensation')
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([OBJECT_PATH])
      expect(enqueue).not.toHaveBeenCalled()
    })

    /**
     * Round 3 (Codex C2-5), round 4: this attempt published, then its claim's lease ran out and a
     * retry under the same key took the publication over and moved the session on first. Both
     * wrote the same verified bytes; this caller replays and removes nothing.
     */
    it('4.4-UNIT-12 replays a same-key takeover that moved the session on first and removes nothing', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
        pending(bytes, {
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-1',
          my_form_processing_job_enqueued_at: DEFAULT_MY_FORM_COMMITTED_AT,
        })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      const result = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

      expect(result.replayed).toBe(true)
      expect(result.response.data.myForm?.status).toBe('processing')
      expect(publish).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, bytes, 'image/png')
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 answers a same-session claim under another key as a conflict and removes nothing', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
        pending(bytes, {
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-2',
        })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    /**
     * Round 3 (Codex C2-5): a claim that fails while the row still holds this pending session
     * leaves staging and the published object for the retry, which verifies and publishes again.
     */
    it('4.4-UNIT-12 keeps staging and the published photo when the session is still pending', async () => {
      const bytes = await portraitPng()
      findUnique
        .mockResolvedValueOnce(pending(bytes))
        .mockResolvedValueOnce(pending(bytes))
      downloadBounded.mockResolvedValueOnce(stored(bytes))
      updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow('UPLOAD_ALREADY_CLAIMED')
      expect(deletionCreateMany).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    /** Round 3 (Codex C2-2): an untrusted row is an expired session, refused before storage. */
    it('4.4-UNIT-12 answers a row whose path names another member as an expired session before any storage call', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_object_path: FOREIGN_PATH })
      )

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new ConflictException('UPLOAD_SESSION_EXPIRED'))
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(assertWardrobeUploadAllowed).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-12 answers a malformed historical session id as an expired session before any storage call', async () => {
      const bytes = await portraitPng()
      const malformed = 'session-1'
      findUnique.mockResolvedValueOnce(
        pending(bytes, {
          my_form_upload_session_id: malformed,
          my_form_object_path: `wardrobe/${USER_ID}/silhouette/${malformed}.png`,
        })
      )

      await expect(
        service.commitMyForm(
          USER_ID,
          'guardian',
          { uploadSessionId: malformed, confirmsBasewearGuidance: true },
          'key-1'
        )
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
      beforeEach(() => {
        freezeClock()
      })

      afterEach(() => {
        // The row these orders hold lives in the shared doubles' implementations.
        findUnique.mockReset()
        findUniqueOrThrow.mockReset()
      })

      /**
       * One profile row that every read returns and every conditional write updates (a
       * `{ increment }` included), so the winner's commit leaves the row exactly as the next
       * commit reads it. The orders here run one attempt after the other, so each write matches.
       */
      function holdOneRow(initial: SilhouetteProfile): () => SilhouetteProfile {
        let row = initial
        findUnique.mockImplementation(() => Promise.resolve(row))
        findUniqueOrThrow.mockImplementation(() => Promise.resolve(row))
        updateMany.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          const next: Record<string, unknown> = { ...row }
          for (const [column, value] of Object.entries(data)) {
            next[column] =
              value !== null && typeof value === 'object' && 'increment' in value
                ? (next[column] as number) + (value as { increment: number }).increment
                : value
          }
          row = next as unknown as SilhouetteProfile
          return Promise.resolve({ count: 1 })
        })
        return () => row
      }

      it('4.4-UNIT-12A answers a commit that meets another attempt live claim 409 UPLOAD_IN_PROGRESS with no storage call at all', async () => {
        const bytes = await portraitPng()
        findUnique.mockResolvedValueOnce(pending(bytes)).mockResolvedValueOnce(
          pending(bytes, {
            my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
            my_form_publish_started_at: LIVE_CLAIM_STARTED_AT,
          })
        )
        updateMany.mockResolvedValueOnce({ count: 0 })

        const failure = service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

        await expect(failure).rejects.toBeInstanceOf(ConflictException)
        await expect(failure).rejects.toThrow('UPLOAD_IN_PROGRESS')
        // The claim attempt is the only write, and it matched nothing.
        expect(updateMany).toHaveBeenCalledExactlyOnceWith({
          where: {
            id: 'profile-1',
            my_form_upload_session_id: SESSION_ID,
            OR: [
              {
                my_form_status: 'pending_upload',
                my_form_upload_expires_at: { gt: FIXED_NOW },
              },
              { my_form_status: 'bytes_uploaded' },
            ],
            AND: [
              {
                OR: [
                  { my_form_publish_attempt_id: null },
                  { my_form_publish_started_at: null },
                  { my_form_publish_started_at: { lt: STALE_CLAIM_CUTOFF } },
                ],
              },
            ],
          },
          data: {
            my_form_publish_attempt_id: expect.any(String),
            my_form_publish_started_at: FIXED_NOW,
            my_form_publish_cleanup_until: CLEANUP_HORIZON,
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

      it('4.4-UNIT-12B refuses a different key after the winner finished 409 IDEMPOTENCY_KEY_REUSED and writes nothing to storage', async () => {
        const bytes = await portraitPng()
        const currentRow = holdOneRow(pending(bytes))
        downloadBounded.mockResolvedValueOnce(stored(bytes))
        const winner = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
        expect(winner.replayed).toBe(false)
        expect(currentRow()).toMatchObject({
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-1',
          my_form_publish_attempt_id: null,
          my_form_processing_job_enqueued_at: FIXED_NOW,
          revision: 2,
        })
        const rowWritesByWinner = updateMany.mock.calls.length

        const loser = service.commitMyForm(USER_ID, 'guardian', input, 'key-2')

        await expect(loser).rejects.toBeInstanceOf(ConflictException)
        await expect(loser).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
        // Storage saw the winner's calls only: one read of staging, one publish of the
        // verified bytes, one release of staging.
        expect(downloadBounded).toHaveBeenCalledExactlyOnceWith(STAGING_PATH, MAX_BYTES)
        expect(publish).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, bytes, 'image/png')
        expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        expect(enqueue).toHaveBeenCalledOnce()
        // The loser wrote nothing to the row either; it still holds the winner's commit.
        expect(updateMany).toHaveBeenCalledTimes(rowWritesByWinner)
        expect(currentRow()).toMatchObject({
          my_form_status: 'processing',
          my_form_commit_idempotency_key: 'key-1',
          revision: 2,
        })
      })

      it('4.4-UNIT-12C replays the winner key after it finished with the same body and no second download or publish', async () => {
        const bytes = await portraitPng()
        holdOneRow(pending(bytes))
        downloadBounded.mockResolvedValueOnce(stored(bytes))
        const winner = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

        const replay = await service.commitMyForm(USER_ID, 'guardian', input, 'key-1')

        expect(winner.replayed).toBe(false)
        expect(replay.replayed).toBe(true)
        expect(replay.response).toEqual(winner.response)
        // A processing photo carries no image access yet, so nothing was signed for either.
        expect(winner.response.data).toMatchObject({
          revision: 2,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: FIXED_NOW.toISOString(),
            imageAccess: null,
          },
        })
        expect(signReadUrl).not.toHaveBeenCalled()
        expect(downloadBounded).toHaveBeenCalledExactlyOnceWith(STAGING_PATH, MAX_BYTES)
        expect(publish).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, bytes, 'image/png')
        expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
        // The winner recorded its job handoff, so the replay enqueues nothing again.
        expect(enqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_ID)
      })
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

      // Recorded in the clearing transaction, then removed (round 3, Codex C2-4).
      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([OBJECT_PATH], 'my_form_deleted')
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([OBJECT_PATH])
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

    /** Review round 1, 2026-11-19: a pending session's unverified bytes go with the delete. */
    it('4.4-UNIT-13 removes a pending session staging key along with the photo', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          revision: 3,
          my_form_status: 'pending_upload',
          my_form_object_path: OBJECT_PATH,
          my_form_upload_session_id: SESSION_ID,
          my_form_mime_type: 'image/png',
        })
      )
      update.mockResolvedValueOnce(profileRow({ revision: 4 }))

      await service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 3))

      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([OBJECT_PATH, STAGING_PATH], 'my_form_deleted')
      )
      expect(remove.mock.calls).toEqual([[[OBJECT_PATH]], [[STAGING_PATH]]])
    })

    /**
     * Round 5 (Codex C4-5): the member deletes My Form while a commit of the pending session owns
     * its publication. The delete waits on the profile row lock that commit's claim also takes,
     * sees the live claim, removes both keys at once and records a removal that repeats until
     * 24 hours after the claim started: a publish landing after the delete (its answer lost, so
     * no compensation runs) is removed whenever it lands.
     */
    it('4.4-UNIT-13 removes the session keys now and repeats the removal while a publication is unfinished', async () => {
      freezeClock()
      outboxRowsRepeatUntil(LIVE_CLAIM_REMOVAL_HORIZON)
      findUnique.mockResolvedValueOnce(
        profileRow({
          revision: 3,
          my_form_status: 'pending_upload',
          my_form_object_path: OBJECT_PATH,
          my_form_upload_session_id: SESSION_ID,
          my_form_mime_type: 'image/png',
          my_form_publish_attempt_id: OTHER_ATTEMPT_ID,
          my_form_publish_started_at: LIVE_CLAIM_STARTED_AT,
        })
      )
      update.mockResolvedValueOnce(profileRow({ revision: 4 }))

      await service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 3))

      expect((txQueryRaw.mock.calls[0]?.[0] as string[]).join('?')).toBe(
        'SELECT 1 FROM "SilhouetteProfile" WHERE user_id = ? FOR UPDATE'
      )
      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recordedRepeating(
          [OBJECT_PATH, STAGING_PATH],
          'my_form_deleted',
          LIVE_CLAIM_REMOVAL_HORIZON
        )
      )
      expect(remove.mock.calls).toEqual([[[OBJECT_PATH]], [[STAGING_PATH]]])
      expect(deletionDelete).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            my_form_upload_session_id: null,
            my_form_publish_attempt_id: null,
            my_form_publish_started_at: null,
          }),
        })
      )
    })

    /** Review round 1, 2026-11-19 (Codex 1): delete never removes another member's object. */
    it('4.4-UNIT-13 never removes a path naming another member', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          revision: 3,
          my_form_status: 'ready',
          my_form_object_path: FOREIGN_PATH,
        })
      )
      update.mockResolvedValueOnce(profileRow({ revision: 4 }))

      await service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 3))

      expect(remove).not.toHaveBeenCalled()
      expect(txDeletionCreateMany).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledOnce()
    })

    /** Nothing was ever stored, so there is no object to hard-delete. */
    it('4.4-UNIT-13 skips storage removal when the profile has no stored object', async () => {
      findUnique.mockResolvedValueOnce(profileRow({ revision: 3 }))
      update.mockResolvedValueOnce(profileRow({ revision: 4 }))

      await service.deleteMyForm(USER_ID, formatSilhouetteETag(USER_ID, 3))

      expect(remove).not.toHaveBeenCalled()
    })
  })

  describe('object path derivation', () => {
    /**
     * The extension is derived from the declared MIME type and the resulting path
     * is what every later signed read resolves against. A wrong suffix makes the
     * object unreadable by anything that trusts it.
     */
    it.each([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ] as const)('4.4-UNIT-10 allocates %s under a .%s path', async (mimeType, ext) => {
      findUnique.mockResolvedValueOnce(null)
      create.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(profileRow({ ...data, my_form_status: 'pending_upload' }))
      )

      await service.createMyFormUploadUrl(
        USER_ID,
        'guardian',
        {
          fileSizeBytes: 1024,
          mimeType,
          sha256: '0'.repeat(64),
          widthPx: 300,
          heightPx: 800,
        },
        'a3f7c2d1-5b9e-4a86-9c31-2e7d4b8f6a05'
      )

      const [{ data }] = create.mock.calls[0] as [
        { data: { my_form_object_path: string } },
      ]
      expect(data.my_form_object_path.endsWith(`.${ext}`)).toBe(true)
    })

    /**
     * A pending row with no session id cannot produce a signable upload URL.
     * Reporting it as expired stops the service emitting an `undefined` path.
     */
    it('4.4-UNIT-10 reports a replay with no session id as an expired session', async () => {
      findUnique.mockResolvedValueOnce(
        profileRow({
          my_form_status: 'pending_upload',
          my_form_upload_idempotency_key: 'a3f7c2d1-5b9e-4a86-9c31-2e7d4b8f6a05',
          my_form_upload_session_id: null,
          my_form_mime_type: 'image/png',
          my_form_upload_expires_at: NOT_YET_EXPIRED,
        })
      )

      await expect(
        service.createMyFormUploadUrl(
          USER_ID,
          'guardian',
          {
            fileSizeBytes: 1024,
            mimeType: 'image/png',
            sha256: '0'.repeat(64),
            widthPx: 300,
            heightPx: 800,
          },
          'a3f7c2d1-5b9e-4a86-9c31-2e7d4b8f6a05'
        )
      ).rejects.toThrow('UPLOAD_SESSION_EXPIRED')
    })
  })

  /**
   * Review round 1, 2026-11-19 (Codex 3): a mismatch removes the staged photo and ends the
   * session, so a correction needs a fresh allocation and key; a validator still running for
   * the ended session can only ever touch its own dead staging key.
   */
  describe('commit verification of the stored photo', () => {
    const input = { uploadSessionId: SESSION_ID, confirmsBasewearGuidance: true as const }

    function expectSessionEnded() {
      // The claim, then the rejection guarded on that claim (round 4: only the attempt that
      // owns the publication verifies, so only it can end the session), then the claim's
      // release, which matches nothing once the session is cleared.
      expect(updateMany).toHaveBeenCalledTimes(3)
      expect(updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'profile-1',
          my_form_upload_session_id: SESSION_ID,
          my_form_publish_attempt_id: claimedAttemptId(),
          my_form_status: { in: ['pending_upload', 'bytes_uploaded'] },
        },
        data: expect.objectContaining({
          mode: 'default_mannequin',
          my_form_status: null,
          my_form_upload_session_id: null,
          my_form_upload_idempotency_key: null,
          my_form_object_path: null,
          my_form_publish_attempt_id: null,
          my_form_publish_started_at: null,
          revision: { increment: 1 },
        }),
      })
      // Recorded with the session's end, in one transaction, then removed.
      expect(txDeletionCreateMany).toHaveBeenCalledExactlyOnceWith(
        recorded([STAGING_PATH], 'upload_rejected')
      )
      expect(remove).toHaveBeenCalledExactlyOnceWith([STAGING_PATH])
      expect(publish).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    }

    it('4.4-UNIT-11 refuses the ended session again before touching storage', async () => {
      // What the row holds after a mismatch ended its session: no session id to commit against.
      findUnique.mockResolvedValueOnce(profileRow({ my_form_upload_session_id: null }))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(downloadBounded).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('4.4-UNIT-11 rejects bytes whose checksum differs from the declaration with 422, and removes them', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_content_sha256: 'f'.repeat(64) })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_CHECKSUM_MISMATCH'))
      expectSessionEnded()
    })

    /**
     * Review round 1, 2026-11-19 (TEA): commit is the only byte check, so a size mismatch names
     * itself (422 IMAGE_SIZE_MISMATCH) instead of degrading to IMAGE_DECODE_FAILED.
     */
    it('4.4-UNIT-11 maps a size disagreement with the allocation to 422 IMAGE_SIZE_MISMATCH', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_file_size_bytes: bytes.length + 1 })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_SIZE_MISMATCH'))
      expectSessionEnded()
    })

    it('4.4-UNIT-11 maps stored bytes of another type than declared to 415, and removes them', async () => {
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
      // Declared PNG; storage holds a JPEG of the same size and digest.
      findUnique.mockResolvedValueOnce(pending(jpegBytes))
      downloadBounded.mockResolvedValueOnce(stored(jpegBytes))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
      expectSessionEnded()
    })

    it('4.4-UNIT-11 maps a landscape photo to 422 IMAGE_NOT_PORTRAIT_FRAMED, and removes it', async () => {
      const bytes = await portraitPng(800, 300)
      findUnique.mockResolvedValueOnce(
        pending(bytes, { my_form_width_px: 800, my_form_height_px: 300 })
      )
      downloadBounded.mockResolvedValueOnce(stored(bytes))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new UnprocessableEntityException('IMAGE_NOT_PORTRAIT_FRAMED'))
      expectSessionEnded()
    })

    it('4.4-UNIT-11 refuses a profile row with an incomplete upload declaration', async () => {
      const bytes = await portraitPng()
      findUnique.mockResolvedValueOnce(pending(bytes, { my_form_content_sha256: null }))

      await expect(
        service.commitMyForm(USER_ID, 'guardian', input, 'key-1')
      ).rejects.toThrow(new BadRequestException('INVALID_UPLOAD_DECLARATION'))
      expect(downloadBounded).not.toHaveBeenCalled()
      // The claim, then its release: nothing was read or published.
      expect(updateMany).toHaveBeenCalledTimes(2)
      expect(updateMany).toHaveBeenLastCalledWith({
        where: { id: 'profile-1', my_form_publish_attempt_id: claimedAttemptId() },
        data: { my_form_publish_attempt_id: null, my_form_publish_started_at: null },
      })
    })
  })

  /**
   * A photo that reached the bytes-uploaded state has no commit timestamp yet.
   * The response must report that as null rather than fail its own contract.
   */
  it('4.4-UNIT-08 reports an uncommitted My Form photo with a null committedAt', async () => {
    findUnique.mockResolvedValueOnce(
      profileRow({ my_form_status: 'bytes_uploaded', my_form_object_path: OBJECT_PATH })
    )

    const { response } = await service.getProfile(USER_ID)

    expect(response.data.myForm).toMatchObject({
      status: 'bytes_uploaded',
      committedAt: null,
    })
  })
})
