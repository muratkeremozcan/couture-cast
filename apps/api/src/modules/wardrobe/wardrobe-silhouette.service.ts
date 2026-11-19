// Story 4.4 Task 3 step 3 owner: implement silhouette slider persistence and My Form lifecycle in apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts
// Story 4.4 Task 3 + 4: silhouette sliders and "My Form" photo lifecycle.
import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { PrismaClient, type SilhouetteProfile } from '@prisma/client'
import {
  type CommitSilhouettePhotoInput,
  type CreateSilhouetteUploadUrlInput,
  type CreateSilhouetteUploadUrlResponse,
  type SilhouetteProfileResponse,
  type UpdateSilhouetteSlidersInput,
  silhouetteMyFormSchema,
} from '@couture/api-client/contracts/http'
import {
  buildSilhouetteObjectPath,
  buildWardrobeStagingObjectPath,
  isWardrobePathSegment,
} from '@couture/utils'
import type { ApiRole } from '../auth/security.types.js'
import { GuardianService } from '../guardian/guardian.service.js'
import {
  GarmentImageValidationError,
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentMimeType,
} from './wardrobe-image-validation.js'
import { WardrobeObjectDeletionOutbox } from './wardrobe-object-deletion.outbox.js'
import { verifySilhouettePhoto } from './wardrobe-silhouette-image-validation.js'
import { SilhouettePhotoProcessingQueue } from './silhouette-photo-processing.queue.js'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeUploadSession,
} from './wardrobe-storage.adapter.js'
import {
  isOwnSessionObject,
  logUntrustedUploadSession,
  ownSessionObjectsToRemove,
  objectExtensionFor,
  uploadPathInvalid,
  uploadSessionKeys,
  type UploadSessionKeys,
} from './wardrobe-upload-paths.js'
import {
  staleClaimCutoff,
  ambiguousPublicationHorizon,
  nextCleanupHorizon,
  unfinishedPublicationDeadline,
  type PublicationClaim,
  uploadInProgress,
} from './wardrobe-publication.js'
import { handOffMyFormProcessing } from './wardrobe-processing-handoff.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

const UPLOAD_EXPIRY_SECONDS = 900
const READ_URL_EXPIRY_SECONDS = 900
const VIRTUAL_UPDATED_AT = new Date(0).toISOString()

/** The strong entity tag this API issues and accepts: `"silhouette:<userId>:<revision>"`. */
export function formatSilhouetteETag(userId: string, revision: number): string {
  return `"silhouette:${userId}:${revision}"`
}

export function parseSilhouetteIfMatchHeader(
  ifMatchHeader: string | undefined,
  userId: string
): number | null {
  if (!ifMatchHeader || ifMatchHeader.trim().length === 0) {
    throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
  }

  const raw = ifMatchHeader.trim()
  if (raw === '*') {
    return null
  }

  const candidates = raw.split(',').map((entry) => entry.trim())
  for (const candidate of candidates) {
    if (/^W\//i.test(candidate)) {
      continue
    }
    const match = /^"silhouette:(.+):(\d+)"$/.exec(candidate)
    if (!match) {
      continue
    }
    const [, taggedUserId, revisionText] = match
    if (taggedUserId !== userId) {
      continue
    }
    const revision = Number(revisionText)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      continue
    }
    return revision
  }

  throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
}

/**
 * The session's staging and final keys, derived from the row's own ids and checked against the
 * stored path; a row that fails is answered as an expired session before any storage call.
 */
function myFormKeys(profile: SilhouetteProfile, operation: string): UploadSessionKeys {
  const keys = uploadSessionKeys({
    kind: 'silhouette',
    userId: profile.user_id,
    objectId: profile.my_form_upload_session_id,
    uploadSessionId: profile.my_form_upload_session_id,
    mimeType: profile.my_form_mime_type,
    storedObjectPath: profile.my_form_object_path,
  })
  if (!keys) {
    logUntrustedUploadSession({ operation, kind: 'silhouette', rowId: profile.id })
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
  return keys
}

/**
 * Every object a replaced or deleted My Form can leave: the member's own final photo and the
 * session's staging key, each only when the row's ids can be trusted (see
 * `ownSessionObjectsToRemove`).
 */
function myFormObjectsToRemove(profile: SilhouetteProfile | null): string[] {
  if (!profile) return []
  return ownSessionObjectsToRemove({
    kind: 'silhouette',
    rowId: profile.id,
    userId: profile.user_id,
    uploadSessionId: profile.my_form_upload_session_id,
    mimeType: profile.my_form_mime_type,
    storedObjectPath: profile.my_form_object_path,
  })
}

/** The My Form columns a cleared session holds; shared by delete and a failed verification. */
const CLEARED_MY_FORM = {
  mode: 'default_mannequin' as const,
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
  my_form_status: null,
  my_form_failure_reason: null,
  my_form_moderation_flagged_at: null,
  my_form_publish_attempt_id: null,
  my_form_publish_started_at: null,
  // Reset with the session: whoever clears it recorded the old keys' repeating removal first.
  my_form_publish_cleanup_until: null,
  my_form_processing_job_enqueued_at: null,
}

/**
 * When a commit of the profile's current session still owns its publication: the moment its
 * lease runs out, or null. Replacement and deletion that meet one record the session's keys for
 * then, so a publish that lands late is removed after it lands.
 */
function myFormPublishDeadline(profile: SilhouetteProfile | null): Date | null {
  if (!profile) return null
  return unfinishedPublicationDeadline(myFormPublicationClaim(profile))
}

function myFormPublicationClaim(profile: SilhouetteProfile): PublicationClaim {
  return {
    attemptId: profile.my_form_publish_attempt_id,
    startedAt: profile.my_form_publish_started_at,
    cleanupUntil: profile.my_form_publish_cleanup_until,
    committable:
      profile.my_form_status === 'pending_upload' ||
      profile.my_form_status === 'bytes_uploaded',
  }
}

/**
 * Until when the keys of a My Form session that a commit may still be publishing must be
 * removed again and again (see `ambiguousPublicationHorizon`), or null when none is in flight.
 */
function myFormRemovalHorizon(profile: SilhouetteProfile | null): Date | null {
  if (!profile) return null
  return ambiguousPublicationHorizon(myFormPublicationClaim(profile))
}

/**
 * `pending_upload` until commit finds the bytes the client PUT to storage; `bytes_uploaded` is a
 * session whose bytes went through the retired API relay before this deploy.
 */
function assertCommittableMyForm(profile: SilhouetteProfile): void {
  if (
    profile.my_form_status !== 'pending_upload' &&
    profile.my_form_status !== 'bytes_uploaded'
  ) {
    throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
  }
  if (
    profile.my_form_status === 'pending_upload' &&
    (!profile.my_form_upload_expires_at ||
      profile.my_form_upload_expires_at <= new Date())
  ) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (
    error.code === 'IMAGE_SIZE_MISMATCH' ||
    error.code === 'IMAGE_CHECKSUM_MISMATCH' ||
    error.code === 'IMAGE_DIMENSIONS_INVALID'
  ) {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'IMAGE_NOT_PORTRAIT_FRAMED') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'UNSUPPORTED_IMAGE_TYPE') {
    throw new UnsupportedMediaTypeException(error.code)
  }
  throw new UnprocessableEntityException('IMAGE_DECODE_FAILED')
}

type SliderResult = { response: SilhouetteProfileResponse; isNoOp: boolean }
type UploadUrlResult = { replayed: boolean; response: CreateSilhouetteUploadUrlResponse }
type CommitResult = { replayed: boolean; response: SilhouetteProfileResponse }

@Injectable()
export class WardrobeSilhouetteService {
  private readonly deletions: WardrobeObjectDeletionOutbox

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(SilhouettePhotoProcessingQueue)
    private readonly processingQueue: SilhouettePhotoProcessingQueue
  ) {
    this.deletions = new WardrobeObjectDeletionOutbox(prisma, storage)
  }

  private async toResponse(
    profile: SilhouetteProfile | null
  ): Promise<SilhouetteProfileResponse> {
    if (!profile) {
      return {
        data: {
          mode: 'default_mannequin',
          heightSlider: null,
          buildSlider: null,
          myForm: null,
          revision: 0,
          updatedAt: VIRTUAL_UPDATED_AT,
        },
      }
    }

    let myForm: SilhouetteProfileResponse['data']['myForm'] = null
    if (profile.my_form_status) {
      let imageAccess: { url: string; expiresAt: string } | null = null
      if (profile.my_form_status === 'ready' && profile.my_form_object_path) {
        if (
          !isOwnSessionObject(
            profile.my_form_object_path,
            profile.user_id,
            'silhouette',
            profile.my_form_upload_session_id
          )
        ) {
          throw uploadPathInvalid({
            operation: 'sign_read',
            kind: 'silhouette',
            rowId: profile.id,
          })
        }
        const url = await this.storage.signReadUrl(
          profile.my_form_object_path,
          READ_URL_EXPIRY_SECONDS
        )
        imageAccess = {
          url,
          expiresAt: new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString(),
        }
      }
      // Discriminated union: parsing selects the variant and makes a profile
      // that violates the photo-lifecycle invariant (a ready photo with no
      // signed URL, say) fail here instead of reaching the client as a payload
      // it would reject.
      myForm = silhouetteMyFormSchema.parse({
        status: profile.my_form_status,
        failureReason: profile.my_form_failure_reason,
        committedAt: profile.my_form_committed_at?.toISOString() ?? null,
        imageAccess,
      })
    }

    return {
      data: {
        mode: profile.mode,
        heightSlider: profile.height_slider,
        buildSlider: profile.build_slider,
        myForm,
        revision: profile.revision,
        updatedAt: profile.updated_at.toISOString(),
      },
    }
  }

  async getProfile(userId: string): Promise<{
    response: SilhouetteProfileResponse
    etag: string
  }> {
    const profile = await this.prisma.silhouetteProfile.findUnique({
      where: { user_id: userId },
    })
    return {
      response: await this.toResponse(profile),
      etag: formatSilhouetteETag(userId, profile?.revision ?? 0),
    }
  }

  /**
   * Upserts slider values, always setting `mode: 'default_mannequin'` --
   * saving sliders is this API's "switch back" action from an active My
   * Form photo to the mannequin (AC2's "previous mannequin sliders remain
   * saved for later switching back"). Locked the same way onboarding is: a
   * Postgres advisory lock keyed on the user id, because a plain
   * `SELECT ... FOR UPDATE` cannot lock a row that does not exist yet, and
   * the first-ever PUT always starts from that no-row state.
   */
  async updateSliders(
    userId: string,
    ifMatchHeader: string | undefined,
    input: UpdateSilhouetteSlidersInput
  ): Promise<SliderResult> {
    const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)

    const result = await interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('silhouette_profile:' || ${userId}))`

      const existing = await tx.silhouetteProfile.findUnique({
        where: { user_id: userId },
      })

      if (!existing) {
        if (expectedRevision !== null && expectedRevision !== 0) {
          throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
        }
        const created = await tx.silhouetteProfile.create({
          data: {
            user_id: userId,
            mode: 'default_mannequin',
            height_slider: input.heightSlider,
            build_slider: input.buildSlider,
            revision: 1,
          },
        })
        return { profile: created, isNoOp: false }
      }

      if (expectedRevision !== null && existing.revision !== expectedRevision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }

      const isIdenticalReplay =
        existing.mode === 'default_mannequin' &&
        existing.height_slider === input.heightSlider &&
        existing.build_slider === input.buildSlider
      if (isIdenticalReplay) {
        return { profile: existing, isNoOp: true }
      }

      const updated = await tx.silhouetteProfile.update({
        where: { user_id: userId },
        data: {
          mode: 'default_mannequin',
          height_slider: input.heightSlider,
          build_slider: input.buildSlider,
          revision: { increment: 1 },
        },
      })
      return { profile: updated, isNoOp: false }
    })

    return { response: await this.toResponse(result.profile), isNoOp: result.isNoOp }
  }

  async createMyFormUploadUrl(
    userId: string,
    role: ApiRole,
    input: CreateSilhouetteUploadUrlInput,
    idempotencyKey: string
  ): Promise<UploadUrlResult> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    // Signed before the transaction: a storage failure must fail before the current photo is
    // replaced and removed. A replay leaves this one unused and signs its own key below.
    if (!isWardrobePathSegment(userId)) {
      throw uploadPathInvalid({
        operation: 'allocate',
        kind: 'silhouette',
        rowId: userId,
      })
    }
    const uploadSessionId = randomUUID()
    const extension = objectExtensionFor(input.mimeType)
    const objectPath = buildSilhouetteObjectPath(userId, uploadSessionId, extension)
    const freshSession = await this.storage.createUploadSession(
      buildWardrobeStagingObjectPath(userId, 'silhouette', uploadSessionId, extension)
    )

    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('silhouette_profile:' || ${userId}))`
      // The row itself too: a commit claims its publication with a row update, so it either
      // landed before this read (and is seen here) or waits until this transaction ends.
      await tx.$queryRaw`SELECT 1 FROM "SilhouetteProfile" WHERE user_id = ${userId} FOR UPDATE`

      const existing = await tx.silhouetteProfile.findUnique({
        where: { user_id: userId },
      })

      if (
        existing?.my_form_upload_idempotency_key === idempotencyKey &&
        existing.my_form_status === 'pending_upload'
      ) {
        if (
          !existing.my_form_upload_expires_at ||
          existing.my_form_upload_expires_at <= new Date()
        ) {
          throw new ConflictException('UPLOAD_SESSION_EXPIRED')
        }
        return { replayed: true, profile: existing, staleObjectPaths: [] as string[] }
      }
      if (existing?.my_form_upload_idempotency_key === idempotencyKey) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }

      const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)
      const staleObjectPaths = myFormObjectsToRemove(existing)
      const removalHorizon = myFormRemovalHorizon(existing)

      const data = {
        my_form_object_path: objectPath,
        my_form_upload_session_id: uploadSessionId,
        my_form_upload_idempotency_key: idempotencyKey,
        my_form_commit_idempotency_key: null,
        my_form_commit_payload_hash: null,
        my_form_file_size_bytes: input.fileSizeBytes,
        my_form_mime_type: input.mimeType,
        my_form_content_sha256: input.sha256,
        my_form_width_px: input.widthPx,
        my_form_height_px: input.heightPx,
        my_form_upload_expires_at: expiresAt,
        my_form_committed_at: null,
        my_form_consent_checked_at: new Date(),
        my_form_status: 'pending_upload' as const,
        my_form_failure_reason: null,
        my_form_moderation_flagged_at: null,
        my_form_publish_attempt_id: null,
        my_form_publish_started_at: null,
        // A new session starts with no horizon; the replaced session's keys repeat below.
        my_form_publish_cleanup_until: null,
        my_form_processing_job_enqueued_at: null,
      }

      const profile = existing
        ? await tx.silhouetteProfile.update({ where: { user_id: userId }, data })
        : await tx.silhouetteProfile.create({ data: { user_id: userId, ...data } })
      // Recorded with the replacement, so a failed removal is retried instead of forgotten. A
      // publication still in flight for the replaced session may land later: its keys are
      // removed now and again until the horizon.
      await this.recordMyFormRemoval(
        tx,
        staleObjectPaths,
        'my_form_replaced',
        removalHorizon
      )

      return { replayed: false, profile, staleObjectPaths }
    })

    await this.deletions.removeNow(outcome.staleObjectPaths)

    return {
      replayed: outcome.replayed,
      response: await this.uploadUrlResponse(
        outcome.profile,
        outcome.replayed ? null : freshSession
      ),
    }
  }

  /**
   * A storage signed upload URL for the session's staging key. A replayed allocation is signed
   * afresh, so it gets a live URL for the same key. The client is told the shorter of the
   * session and the token.
   */
  private async uploadUrlResponse(
    profile: SilhouetteProfile,
    signed: WardrobeUploadSession | null
  ): Promise<CreateSilhouetteUploadUrlResponse> {
    if (
      !profile.my_form_upload_session_id ||
      !profile.my_form_upload_expires_at ||
      !profile.my_form_mime_type
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    const keys = myFormKeys(profile, 'allocate')
    const session = signed ?? (await this.storage.createUploadSession(keys.stagingPath))
    const expiresAt = Math.min(
      profile.my_form_upload_expires_at.getTime(),
      session.tokenExpiresAt.getTime()
    )
    return {
      data: {
        uploadSessionId: profile.my_form_upload_session_id,
        uploadUrl: session.uploadUrl,
        uploadToken: session.uploadToken,
        requiredHeaders: { 'content-type': profile.my_form_mime_type as GarmentMimeType },
        expiresAt: new Date(expiresAt).toISOString(),
      },
    }
  }

  private resolveMyFormDeclaration(profile: SilhouetteProfile): {
    fileSizeBytes: number
    mimeType: GarmentMimeType
    sha256: string
    widthPx: number
    heightPx: number
  } {
    if (
      !profile.my_form_object_path ||
      !profile.my_form_file_size_bytes ||
      !profile.my_form_mime_type ||
      !profile.my_form_content_sha256 ||
      !profile.my_form_width_px ||
      !profile.my_form_height_px
    ) {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }
    return {
      fileSizeBytes: profile.my_form_file_size_bytes,
      mimeType: profile.my_form_mime_type as GarmentMimeType,
      sha256: profile.my_form_content_sha256,
      widthPx: profile.my_form_width_px,
      heightPx: profile.my_form_height_px,
    }
  }

  /**
   * Clients PUT the bytes straight to storage, so commit is where they are checked: the uploaded
   * object must match the declared size, sniffed type, sha256, dimensions and portrait framing.
   * It is read through a hard ceiling, so an oversized object never sits in memory whole. A
   * mismatch is removed and the session ends, so a correction needs a fresh allocation and a
   * fresh key; a validator still running for this session can only touch a dead session's key.
   * Returns the verified bytes.
   */
  private async verifyStoredMyForm(
    profile: SilhouetteProfile,
    objectPath: string,
    publishAttemptId: string
  ): Promise<Buffer> {
    const declaration = this.resolveMyFormDeclaration(profile)
    const stored = await this.storage.downloadBounded(objectPath, MAX_GARMENT_IMAGE_BYTES)
    if (stored.status === 'missing') {
      throw new ConflictException('UPLOAD_BYTES_MISSING')
    }
    try {
      if (stored.status === 'too_large') {
        throw new GarmentImageValidationError('IMAGE_SIZE_MISMATCH')
      }
      await verifySilhouettePhoto(stored.bytes, declaration)
      return stored.bytes
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        // A claim this attempt took over may have started a write of the final key that can
        // still land; the cleared session takes its horizon with it, so its keys repeat here.
        const earlierHorizon = myFormRemovalHorizon(profile)
        const repeatingPaths = earlierHorizon ? myFormObjectsToRemove(profile) : []
        await interactiveTransaction(this.prisma, async (tx) => {
          const rejected = await tx.silhouetteProfile.updateMany({
            where: {
              id: profile.id,
              my_form_upload_session_id: profile.my_form_upload_session_id,
              my_form_publish_attempt_id: publishAttemptId,
              my_form_status: { in: ['pending_upload', 'bytes_uploaded'] },
            },
            data: { ...CLEARED_MY_FORM, revision: { increment: 1 } },
          })
          await this.deletions.record(tx, [objectPath], 'upload_rejected')
          if (rejected.count === 1 && earlierHorizon) {
            await this.deletions.recordRepeating(
              tx,
              repeatingPaths,
              'upload_rejected',
              earlierHorizon
            )
          }
        })
        await this.deletions.removeNow([objectPath, ...repeatingPaths])
        mapImageValidationError(error)
      }
      throw error
    }
  }

  /**
   * Verifies the staged bytes and writes exactly that buffer to the final key with server-owned
   * type and cache policy; a legacy row's bytes already sit at the final path.
   */
  private async placeVerifiedMyForm(
    profile: SilhouetteProfile,
    keys: UploadSessionKeys,
    fromStaging: boolean,
    publishAttemptId: string
  ): Promise<void> {
    let publishStarted = false
    try {
      if (!fromStaging) {
        await this.verifyStoredMyForm(profile, keys.finalPath, publishAttemptId)
        return
      }
      const bytes = await this.verifyStoredMyForm(
        profile,
        keys.stagingPath,
        publishAttemptId
      )
      publishStarted = true
      await this.storage.publish(
        keys.finalPath,
        bytes,
        profile.my_form_mime_type as GarmentMimeType
      )
    } catch (error) {
      // Released only when no write of the final key was started: a publish that failed may
      // still land, so its claim stays until the lease runs out and a deletion meeting it waits.
      if (!publishStarted)
        await this.releaseMyFormPublication(profile.id, publishAttemptId)
      throw error
    }
  }

  /**
   * Takes the session's publication for `attemptId` before any storage I/O: the profile must
   * still hold this unexpired pending session (or a legacy relay upload) with no claim, or one
   * whose lease has run out.
   */
  private async claimMyFormPublication(
    profile: SilhouetteProfile,
    attemptId: string
  ): Promise<boolean> {
    const now = new Date()
    const claimed = await this.prisma.silhouetteProfile.updateMany({
      where: {
        id: profile.id,
        my_form_upload_session_id: profile.my_form_upload_session_id,
        OR: [
          { my_form_status: 'pending_upload', my_form_upload_expires_at: { gt: now } },
          { my_form_status: 'bytes_uploaded' },
        ],
        AND: [
          {
            OR: [
              { my_form_publish_attempt_id: null },
              { my_form_publish_started_at: null },
              { my_form_publish_started_at: { lt: staleClaimCutoff(now) } },
            ],
          },
        ],
      },
      // The cleanup horizon is recorded with the claim, before any storage I/O, and outlives
      // the lease, a takeover and success; see `ambiguousPublicationHorizon`.
      data: {
        my_form_publish_attempt_id: attemptId,
        my_form_publish_started_at: now,
        my_form_publish_cleanup_until: nextCleanupHorizon(
          profile.my_form_publish_cleanup_until,
          now
        ),
      },
    })
    return claimed.count === 1
  }

  private async releaseMyFormPublication(
    profileId: string,
    attemptId: string
  ): Promise<void> {
    await this.prisma.silhouetteProfile
      .updateMany({
        where: { id: profileId, my_form_publish_attempt_id: attemptId },
        data: { my_form_publish_attempt_id: null, my_form_publish_started_at: null },
      })
      .catch(() => undefined)
  }

  /**
   * The publication claim matched nothing: replay a commit that already moved this session on
   * under the same key, answer UPLOAD_IN_PROGRESS while another attempt owns the publication,
   * and UPLOAD_SESSION_EXPIRED once the session ended, expired or was replaced.
   */
  private async resolveUnclaimedMyForm(
    profileId: string,
    input: CommitSilhouettePhotoInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    const current = await this.prisma.silhouetteProfile.findUnique({
      where: { id: profileId },
    })
    if (current?.my_form_upload_session_id === input.uploadSessionId) {
      if (
        current.my_form_status === 'processing' ||
        current.my_form_status === 'ready' ||
        current.my_form_status === 'failed'
      ) {
        return this.replayCommittedMyForm(current, idempotencyKey)
      }
      if (myFormPublishDeadline(current)) throw uploadInProgress()
    }
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }

  /** A commit of a session already past commit: same key replays, any other is refused. */
  private async replayCommittedMyForm(
    profile: SilhouetteProfile,
    idempotencyKey: string
  ): Promise<CommitResult> {
    if (profile.my_form_commit_idempotency_key !== idempotencyKey) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    if (profile.my_form_status === 'processing') {
      await handOffMyFormProcessing(this.prisma, this.processingQueue, profile)
    }
    return { replayed: true, response: await this.toResponse(profile) }
  }

  /**
   * The claim matched nothing. A concurrent commit of this session that claimed it under the
   * same key replays; a replaced or deleted session leaves a published object nothing will
   * claim, which is removed. Anything else is a conflict.
   */
  private async resolveLostMyFormClaim(
    profile: SilhouetteProfile,
    input: CommitSilhouettePhotoInput,
    idempotencyKey: string,
    keys: UploadSessionKeys,
    fromStaging: boolean
  ): Promise<CommitResult> {
    const raced = await this.prisma.silhouetteProfile.findUnique({
      where: { id: profile.id },
    })
    if (raced?.my_form_upload_session_id === input.uploadSessionId) {
      if (
        raced.my_form_commit_idempotency_key === idempotencyKey &&
        raced.my_form_status !== 'pending_upload' &&
        raced.my_form_status !== 'bytes_uploaded'
      ) {
        return { replayed: true, response: await this.toResponse(raced) }
      }
    } else if (fromStaging) {
      // Replaced or deleted meanwhile, and the publish returned, so it has landed: nothing will
      // claim the object.
      await this.deletions.recordAndRemove([keys.finalPath], 'commit_compensation')
    }
    throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
  }

  async commitMyForm(
    userId: string,
    role: ApiRole,
    input: CommitSilhouettePhotoInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    const profile = await this.prisma.silhouetteProfile.findUnique({
      where: { user_id: userId },
    })
    if (!profile || profile.my_form_upload_session_id !== input.uploadSessionId) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }

    if (
      profile.my_form_status === 'processing' ||
      profile.my_form_status === 'ready' ||
      profile.my_form_status === 'failed'
    ) {
      return this.replayCommittedMyForm(profile, idempotencyKey)
    }
    assertCommittableMyForm(profile)

    const keys = myFormKeys(profile, 'commit')
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    // Publication ownership before any storage I/O; see WardrobeService.commitGarment. Only the
    // owning attempt verifies the staged bytes and writes exactly that buffer to the final key
    // with server-owned type and cache policy. Staging stays until the claim. A legacy row's
    // bytes went through the retired relay and already sit at the final path.
    const publishAttemptId = randomUUID()
    if (!(await this.claimMyFormPublication(profile, publishAttemptId))) {
      return this.resolveUnclaimedMyForm(profile.id, input, idempotencyKey)
    }
    const fromStaging = profile.my_form_status === 'pending_upload'
    await this.placeVerifiedMyForm(profile, keys, fromStaging, publishAttemptId)

    const updated = await this.prisma.silhouetteProfile.updateMany({
      // Guarded on this attempt's publication claim as well as the session and status: a
      // reallocation replaces the session in place on this one-row-per-user profile, and only
      // the attempt that published may move the row on.
      where: {
        id: profile.id,
        my_form_upload_session_id: input.uploadSessionId,
        my_form_publish_attempt_id: publishAttemptId,
        my_form_status: { in: ['pending_upload', 'bytes_uploaded'] },
      },
      data: {
        my_form_status: 'processing',
        my_form_committed_at: new Date(),
        my_form_commit_idempotency_key: idempotencyKey,
        my_form_consent_checked_at: new Date(),
        my_form_publish_attempt_id: null,
        my_form_publish_started_at: null,
        my_form_processing_job_enqueued_at: null,
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1) {
      await this.releaseMyFormPublication(profile.id, publishAttemptId)
      return this.resolveLostMyFormClaim(
        profile,
        input,
        idempotencyKey,
        keys,
        fromStaging
      )
    }

    // The job handoff comes first, before any cleanup: the row is processing now, and the
    // marker records that its job is on the queue. If the function stops before the marker, a
    // same-key replay or the hourly maintenance job enqueues again under the same job id. An
    // enqueue failure answers the commit with that error and leaves the row for those two.
    const committed = await this.prisma.silhouetteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    await handOffMyFormProcessing(this.prisma, this.processingQueue, committed)
    if (fromStaging) {
      await this.deletions.recordAndRemove([keys.stagingPath], 'commit_staging_released')
    }

    const refreshed = await this.prisma.silhouetteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    return { replayed: false, response: await this.toResponse(refreshed) }
  }

  /**
   * Records a replaced or deleted My Form session's keys for removal in the caller's
   * transaction: once, or repeating until `removalHorizon` when a publication may still write.
   */
  private async recordMyFormRemoval(
    tx: Parameters<Parameters<typeof interactiveTransaction>[1]>[0],
    objectPaths: readonly string[],
    reason: 'my_form_replaced' | 'my_form_deleted',
    removalHorizon: Date | null
  ): Promise<void> {
    if (removalHorizon) {
      await this.deletions.recordRepeating(tx, objectPaths, reason, removalHorizon)
    } else {
      await this.deletions.record(tx, objectPaths, reason)
    }
  }

  /**
   * Immediate hard delete (decision 12): no deferred retention sweep like
   * `WardrobeRetentionService` runs for garments. Nothing else references a
   * silhouette photo the way capsules reference garments, so synchronous
   * removal is the safer, simpler, more privacy-respecting choice.
   */
  async deleteMyForm(
    userId: string,
    ifMatchHeader: string | undefined
  ): Promise<{ response: SilhouetteProfileResponse }> {
    const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)

    const outcome = await interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('silhouette_profile:' || ${userId}))`
      // The row itself too: a commit claims its publication with a row update, so it either
      // landed before this read (and is seen here) or waits until this transaction ends.
      await tx.$queryRaw`SELECT 1 FROM "SilhouetteProfile" WHERE user_id = ${userId} FOR UPDATE`

      const existing = await tx.silhouetteProfile.findUnique({
        where: { user_id: userId },
      })
      if (!existing) {
        throw new NotFoundException('NOT_FOUND')
      }
      if (expectedRevision !== null && existing.revision !== expectedRevision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }

      const objectPaths = myFormObjectsToRemove(existing)
      const removalHorizon = myFormRemovalHorizon(existing)
      const updated = await tx.silhouetteProfile.update({
        where: { user_id: userId },
        data: { ...CLEARED_MY_FORM, revision: { increment: 1 } },
      })
      // The current final and staging keys go now; a publication still in flight for this
      // session may land later, so they are removed again until the horizon. See allocation.
      await this.recordMyFormRemoval(tx, objectPaths, 'my_form_deleted', removalHorizon)
      return { profile: updated, objectPaths }
    })

    await this.deletions.removeNow(outcome.objectPaths)

    return { response: await this.toResponse(outcome.profile) }
  }
}
