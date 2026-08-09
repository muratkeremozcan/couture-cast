// Story 4.4 Task 3 + 4: silhouette sliders and "My Form" photo lifecycle.
import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
} from '@couture/api-client/contracts/http'
import { buildSilhouetteObjectPath } from '@couture/utils'
import type { ApiRole } from '../auth/security.types.js'
import { GuardianService } from '../guardian/guardian.service.js'
import {
  GarmentImageValidationError,
  type GarmentMimeType,
} from './wardrobe-image-validation.js'
import { verifySilhouettePhoto } from './wardrobe-silhouette-image-validation.js'
import { SilhouettePhotoProcessingQueue } from './silhouette-photo-processing.queue.js'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter.js'
import {
  generateUploadToken,
  requireUploadTokenSecret,
  verifyUploadToken,
} from './wardrobe-upload-token.js'

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

function deriveObjectExtension(mimeType: GarmentMimeType): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  return 'webp'
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (
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
type CommitResult = { response: SilhouetteProfileResponse }

@Injectable()
export class WardrobeSilhouetteService {
  private readonly uploadTokenSecret: string

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(SilhouettePhotoProcessingQueue)
    private readonly processingQueue: SilhouettePhotoProcessingQueue
  ) {
    this.uploadTokenSecret = requireUploadTokenSecret()
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
        const url = await this.storage.signReadUrl(
          profile.my_form_object_path,
          READ_URL_EXPIRY_SECONDS
        )
        imageAccess = {
          url,
          expiresAt: new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString(),
        }
      }
      myForm = {
        status: profile.my_form_status,
        failureReason: profile.my_form_failure_reason,
        committedAt: profile.my_form_committed_at?.toISOString() ?? null,
        imageAccess,
      }
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

    const result = await this.prisma.$transaction(async (tx) => {
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

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('silhouette_profile:' || ${userId}))`

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
        return { replayed: true, profile: existing, staleObjectPath: null }
      }
      if (existing?.my_form_upload_idempotency_key === idempotencyKey) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }

      const uploadSessionId = randomUUID()
      const objectPath = buildSilhouetteObjectPath(
        userId,
        uploadSessionId,
        deriveObjectExtension(input.mimeType)
      )
      const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)
      const staleObjectPath =
        existing?.my_form_object_path && existing.my_form_object_path !== objectPath
          ? existing.my_form_object_path
          : null

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
      }

      const profile = existing
        ? await tx.silhouetteProfile.update({ where: { user_id: userId }, data })
        : await tx.silhouetteProfile.create({ data: { user_id: userId, ...data } })

      return { replayed: false, profile, staleObjectPath }
    })

    if (outcome.staleObjectPath) {
      await this.storage.remove([outcome.staleObjectPath]).catch(() => undefined)
    }

    return {
      replayed: outcome.replayed,
      response: this.uploadUrlResponse(outcome.profile),
    }
  }

  private uploadUrlResponse(
    profile: SilhouetteProfile
  ): CreateSilhouetteUploadUrlResponse {
    if (
      !profile.my_form_upload_session_id ||
      !profile.my_form_upload_expires_at ||
      !profile.my_form_mime_type
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    return {
      data: {
        uploadSessionId: profile.my_form_upload_session_id,
        uploadUrl: `${this.publicApiUrl()}/api/v1/wardrobe/silhouette/my-form/uploads/${profile.my_form_upload_session_id}`,
        uploadToken: generateUploadToken(
          profile.my_form_upload_session_id,
          profile.user_id,
          profile.my_form_upload_expires_at.toISOString(),
          this.uploadTokenSecret
        ),
        requiredHeaders: { 'content-type': profile.my_form_mime_type as GarmentMimeType },
        expiresAt: profile.my_form_upload_expires_at.toISOString(),
      },
    }
  }

  private publicApiUrl(): string {
    return (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
  }

  /** Not-found/ownership/status/expiry/token checks, split out of
   * `uploadMyFormBytes` to keep both methods under the complexity budget. */
  private assertUploadableSession(
    profile: SilhouetteProfile | null,
    userId: string,
    uploadSessionId: string,
    uploadToken: string
  ): asserts profile is SilhouetteProfile {
    if (!profile) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }
    if (profile.user_id !== userId) {
      throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
    }
    if (profile.my_form_status !== 'pending_upload') {
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
    if (
      !profile.my_form_upload_expires_at ||
      profile.my_form_upload_expires_at <= new Date()
    ) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    if (
      !verifyUploadToken(
        uploadToken,
        uploadSessionId,
        userId,
        profile.my_form_upload_expires_at.toISOString(),
        this.uploadTokenSecret
      )
    ) {
      throw new ForbiddenException('INVALID_UPLOAD_TOKEN')
    }
  }

  private resolveMyFormDeclaration(
    profile: SilhouetteProfile,
    mimeType: GarmentMimeType
  ): {
    fileSizeBytes: number
    mimeType: GarmentMimeType
    sha256: string
    widthPx: number
    heightPx: number
  } {
    if (
      !profile.my_form_file_size_bytes ||
      !profile.my_form_mime_type ||
      !profile.my_form_content_sha256 ||
      !profile.my_form_width_px ||
      !profile.my_form_height_px
    ) {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }
    if (mimeType !== profile.my_form_mime_type) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }
    return {
      fileSizeBytes: profile.my_form_file_size_bytes,
      mimeType: profile.my_form_mime_type,
      sha256: profile.my_form_content_sha256,
      widthPx: profile.my_form_width_px,
      heightPx: profile.my_form_height_px,
    }
  }

  async uploadMyFormBytes(
    uploadSessionId: string,
    uploadToken: string,
    userId: string,
    role: ApiRole,
    mimeType: GarmentMimeType,
    contentLength: number | undefined,
    body: Buffer
  ): Promise<void> {
    const profile = await this.prisma.silhouetteProfile.findUnique({
      where: { my_form_upload_session_id: uploadSessionId },
    })
    this.assertUploadableSession(profile, userId, uploadSessionId, uploadToken)

    if (contentLength === undefined || contentLength !== body.length) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }
    const declaration = this.resolveMyFormDeclaration(profile, mimeType)

    try {
      await verifySilhouettePhoto(body, declaration)
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        mapImageValidationError(error)
      }
      throw error
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    await this.storage.upload(profile.my_form_object_path!, body, declaration.mimeType)

    const updated = await this.prisma.silhouetteProfile.updateMany({
      where: { id: profile.id, my_form_status: 'pending_upload' },
      data: { my_form_status: 'bytes_uploaded', my_form_consent_checked_at: new Date() },
    })
    if (updated.count !== 1) {
      await this.storage.remove([profile.my_form_object_path!])
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
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
      if (profile.my_form_commit_idempotency_key === idempotencyKey) {
        return { response: await this.toResponse(profile) }
      }
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    if (profile.my_form_status !== 'bytes_uploaded') {
      throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const updated = await this.prisma.silhouetteProfile.updateMany({
      where: { id: profile.id, my_form_status: 'bytes_uploaded' },
      data: {
        my_form_status: 'processing',
        my_form_committed_at: new Date(),
        my_form_commit_idempotency_key: idempotencyKey,
        my_form_consent_checked_at: new Date(),
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1) {
      throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
    }

    await this.processingQueue.enqueue(profile.id)

    const refreshed = await this.prisma.silhouetteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    return { response: await this.toResponse(refreshed) }
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

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('silhouette_profile:' || ${userId}))`

      const existing = await tx.silhouetteProfile.findUnique({
        where: { user_id: userId },
      })
      if (!existing) {
        throw new NotFoundException('NOT_FOUND')
      }
      if (expectedRevision !== null && existing.revision !== expectedRevision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }

      const objectPath = existing.my_form_object_path
      const updated = await tx.silhouetteProfile.update({
        where: { user_id: userId },
        data: {
          mode: 'default_mannequin',
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
          revision: { increment: 1 },
        },
      })
      return { profile: updated, objectPath }
    })

    if (outcome.objectPath) {
      await this.storage.remove([outcome.objectPath]).catch(() => undefined)
    }

    return { response: await this.toResponse(outcome.profile) }
  }
}
