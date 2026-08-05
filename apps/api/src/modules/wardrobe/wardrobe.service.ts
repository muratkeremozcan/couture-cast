// Story 4.2 Task 5 step 1 owner: implement suggestGarmentTags and updateGarmentTags service methods in apps/api/src/modules/wardrobe/wardrobe.service.ts
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Prisma, PrismaClient, type GarmentItem } from '@prisma/client'
import {
  garmentTagSuggestionSnapshotSchema,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
  type GarmentTagSuggestionSnapshot,
  type CreateGarmentItemInput,
  type CreateGarmentUploadUrlInput,
  type GarmentItemResponse,
  type SuggestGarmentTagsResponse,
  type UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import { buildGarmentObjectPath } from '@couture/utils'

import { allowsTestOnlySecrets } from '../../config/runtime-environment'
import { createBaseLogger } from '../../logger/pino.config'
import type { ApiRole } from '../auth/security.types'
import { GuardianService } from '../guardian/guardian.service'
import { RitualService } from '../personalization/ritual.service'
import {
  TelemetryService,
  type TelemetryPropertiesMap,
} from '../telemetry/telemetry.service'
import {
  GarmentImageValidationError,
  type GarmentImageDeclaration,
  type GarmentMimeType,
  verifyGarmentImage,
} from './wardrobe-image-validation'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'

const UPLOAD_EXPIRY_SECONDS = 900
const READ_URL_EXPIRY_SECONDS = 900

type UploadUrlResult = {
  replayed: boolean
  response: {
    data: {
      garmentId: string
      uploadSessionId: string
      uploadUrl: string
      uploadToken: string
      requiredHeaders: { 'content-type': GarmentMimeType }
      expiresAt: string
    }
  }
}

type CommitResult = {
  replayed: boolean
  response: GarmentItemResponse
}

function requireUploadTokenSecret(): string {
  const configuredSecret = process.env.WARDROBE_UPLOAD_TOKEN_SECRET?.trim()
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret
  }
  if (allowsTestOnlySecrets()) {
    return 'test-only-wardrobe-upload-token-secret'
  }
  throw new Error('WARDROBE_UPLOAD_TOKEN_SECRET must contain at least 32 characters')
}

function deriveObjectExtension(mimeType: GarmentMimeType): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  return 'webp'
}

function generateUploadToken(
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string,
  secret: string
): string {
  const data = `${uploadSessionId}.${userId}.${expiresAtIso}`
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function verifyUploadToken(
  token: string,
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string,
  secret: string
): boolean {
  const expected = generateUploadToken(uploadSessionId, userId, expiresAtIso, secret)
  if (token.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

function allocationMatches(
  garment: GarmentItem,
  input: CreateGarmentUploadUrlInput
): boolean {
  return (
    garment.file_size_bytes === input.fileSizeBytes &&
    garment.mime_type === input.mimeType &&
    garment.content_sha256 === input.sha256 &&
    garment.width_px === input.widthPx &&
    garment.height_px === input.heightPx
  )
}

function commitPayloadHash(input: CreateGarmentItemInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        garmentId: input.garmentId,
        uploadSessionId: input.uploadSessionId,
        hasCropping: input.hasCropping,
        hasBgCleanup: input.hasBgCleanup,
      })
    )
    .digest('hex')
}

function declarationFromGarment(garment: GarmentItem): GarmentImageDeclaration {
  if (
    !garment.file_size_bytes ||
    !garment.mime_type ||
    !garment.content_sha256 ||
    !garment.width_px ||
    !garment.height_px
  ) {
    throw new BadRequestException('INVALID_UPLOAD_DECLARATION')
  }
  return {
    fileSizeBytes: garment.file_size_bytes,
    mimeType: garment.mime_type as GarmentMimeType,
    sha256: garment.content_sha256,
    widthPx: garment.width_px,
    heightPx: garment.height_px,
  }
}

function mapImageValidationError(error: GarmentImageValidationError): never {
  if (error.code === 'IMAGE_CHECKSUM_MISMATCH') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'IMAGE_DIMENSIONS_INVALID') {
    throw new UnprocessableEntityException(error.code)
  }
  if (error.code === 'UNSUPPORTED_IMAGE_TYPE') {
    throw new UnsupportedMediaTypeException(error.code)
  }
  throw new UnprocessableEntityException('IMAGE_DECODE_FAILED')
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

class ConcurrentTagUpdateError extends Error {}

type TagConfirmationResult = {
  updated: GarmentItem
  telemetryProperties: TelemetryPropertiesMap['garment_tagging_completed'] | null
  cacheInvalidationRequired: boolean
}

type ParsedTagSuggestion = {
  suggestion: GarmentTagSuggestionSnapshot | null
  hasMalformedSuggestion: boolean
}

const COMMITTED_UPLOAD_STATUSES: ReadonlySet<GarmentItem['upload_status']> = new Set([
  'processing',
  'awaiting_tags',
  'ready',
])

const PENDING_TAGGING_STATUSES: ReadonlySet<GarmentItem['upload_status']> = new Set([
  'pending_upload',
  'bytes_uploaded',
  'processing',
])

function assertTaggableGarment(
  garment: GarmentItem | null
): asserts garment is GarmentItem {
  if (!garment) {
    throw new NotFoundException('GARMENT_NOT_FOUND')
  }
  if (garment.retention_status !== 'active') {
    throw new ConflictException('GARMENT_NOT_TAGGABLE')
  }
  if (PENDING_TAGGING_STATUSES.has(garment.upload_status)) {
    throw new ConflictException('GARMENT_ANALYSIS_PENDING')
  }
  if (garment.upload_status === 'failed') {
    throw new ConflictException('GARMENT_NOT_TAGGABLE')
  }
}

function resolveTargetMaterial(
  garment: GarmentItem,
  input: UpdateGarmentTagsInput
): GarmentMaterial | null {
  return input.material === undefined
    ? (garment.material as GarmentMaterial | null)
    : input.material
}

function isUnchangedTagConfirmation(
  garment: GarmentItem,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null
): boolean {
  return (
    garment.upload_status === 'ready' &&
    garment.category === input.category &&
    garment.material === targetMaterial &&
    garment.comfort_range === input.comfortRange
  )
}

function parseTagSuggestion(garment: GarmentItem): ParsedTagSuggestion {
  if (!garment.tag_suggestions) {
    return { suggestion: null, hasMalformedSuggestion: false }
  }
  const parsed = garmentTagSuggestionSnapshotSchema.safeParse(garment.tag_suggestions)
  return parsed.success
    ? { suggestion: parsed.data, hasMalformedSuggestion: false }
    : { suggestion: null, hasMalformedSuggestion: true }
}

function buildOverrideFields(
  suggestion: GarmentTagSuggestionSnapshot | null,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null
): ('category' | 'material' | 'comfort_range')[] {
  if (!suggestion) {
    return []
  }
  const overrideFields: ('category' | 'material' | 'comfort_range')[] = []
  if (suggestion.category.value !== input.category) {
    overrideFields.push('category')
  }
  if (suggestion.material.value !== targetMaterial) {
    overrideFields.push('material')
  }
  if (suggestion.comfortRange.value !== input.comfortRange) {
    overrideFields.push('comfort_range')
  }
  return overrideFields
}

function buildTaggingTelemetryProperties(
  userId: string,
  garmentId: string,
  suggestion: GarmentTagSuggestionSnapshot | null,
  input: UpdateGarmentTagsInput,
  targetMaterial: GarmentMaterial | null
): TelemetryPropertiesMap['garment_tagging_completed'] {
  const overrideFields = buildOverrideFields(suggestion, input, targetMaterial)
  return {
    analyticsSubjectId: userId,
    garmentId,
    suggestedCategory: suggestion?.category.value ?? null,
    confirmedCategory: input.category,
    suggestedMaterial: suggestion?.material.value ?? null,
    confirmedMaterial: targetMaterial,
    suggestedComfortRange: suggestion?.comfortRange.value ?? null,
    confirmedComfortRange: input.comfortRange,
    suggestionAvailable: suggestion !== null,
    analysisVersion: suggestion?.analysisVersion ?? null,
    wasOverridden: overrideFields.length > 0,
    overrideFields,
  }
}

function isRetriableTagUpdateError(error: unknown): boolean {
  return (
    error instanceof ConcurrentTagUpdateError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
  )
}

function assertCommitCandidate(
  garment: GarmentItem | null,
  userId: string,
  input: CreateGarmentItemInput
): asserts garment is GarmentItem {
  if (!garment || garment.user_id !== userId) {
    throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
  }
  if (garment.upload_session_id !== input.uploadSessionId) {
    throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
  }
  if (garment.retention_status !== 'active') {
    throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
  }
}

function assertCommitReplayMatches(
  garment: GarmentItem,
  idempotencyKey: string,
  payloadHash: string
): void {
  if (
    garment.commit_idempotency_key !== idempotencyKey ||
    garment.commit_payload_hash !== payloadHash
  ) {
    throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
  }
}

@Injectable()
export class WardrobeService {
  private readonly uploadTokenSecret: string
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(WardrobeProcessingQueue)
    private readonly processingQueue: WardrobeProcessingQueue,
    @Inject(RitualService)
    private readonly ritualService: RitualService
  ) {
    this.uploadTokenSecret = requireUploadTokenSecret()
  }

  private uploadResponse(garment: GarmentItem): UploadUrlResult['response'] {
    if (!garment.upload_session_id || !garment.upload_expires_at || !garment.mime_type) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    const baseUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(
      /\/+$/,
      ''
    )
    return {
      data: {
        garmentId: garment.id,
        uploadSessionId: garment.upload_session_id,
        uploadUrl: `${baseUrl}/api/v1/wardrobe/uploads/${garment.upload_session_id}`,
        uploadToken: generateUploadToken(
          garment.upload_session_id,
          garment.user_id,
          garment.upload_expires_at.toISOString(),
          this.uploadTokenSecret
        ),
        requiredHeaders: {
          'content-type': garment.mime_type as GarmentMimeType,
        },
        expiresAt: garment.upload_expires_at.toISOString(),
      },
    }
  }

  async createUploadUrl(
    userId: string,
    role: ApiRole,
    input: CreateGarmentUploadUrlInput,
    idempotencyKey: string
  ): Promise<UploadUrlResult> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const existing = await this.prisma.garmentItem.findUnique({
      where: {
        user_id_upload_idempotency_key: {
          user_id: userId,
          upload_idempotency_key: idempotencyKey,
        },
      },
    })
    if (existing) {
      if (!allocationMatches(existing, input)) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
      if (
        existing.retention_status !== 'active' ||
        existing.upload_status !== 'pending_upload' ||
        !existing.upload_expires_at ||
        existing.upload_expires_at <= new Date()
      ) {
        throw new ConflictException('UPLOAD_SESSION_EXPIRED')
      }
      return { replayed: true, response: this.uploadResponse(existing) }
    }

    const garmentId = randomUUID()
    const uploadSessionId = randomUUID()
    const objectPath = buildGarmentObjectPath(
      userId,
      garmentId,
      deriveObjectExtension(input.mimeType)
    )
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)

    try {
      const created = await this.prisma.garmentItem.create({
        data: {
          id: garmentId,
          user_id: userId,
          object_path: objectPath,
          upload_session_id: uploadSessionId,
          upload_idempotency_key: idempotencyKey,
          file_size_bytes: input.fileSizeBytes,
          mime_type: input.mimeType,
          content_sha256: input.sha256,
          width_px: input.widthPx,
          height_px: input.heightPx,
          upload_status: 'pending_upload',
          retention_status: 'active',
          upload_expires_at: expiresAt,
          consent_checked_at: new Date(),
        },
      })
      return { replayed: false, response: this.uploadResponse(created) }
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
      const raced = await this.prisma.garmentItem.findUnique({
        where: {
          user_id_upload_idempotency_key: {
            user_id: userId,
            upload_idempotency_key: idempotencyKey,
          },
        },
      })
      if (!raced || !allocationMatches(raced, input)) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
      if (
        raced.retention_status !== 'active' ||
        raced.upload_status !== 'pending_upload' ||
        !raced.upload_expires_at ||
        raced.upload_expires_at <= new Date()
      ) {
        throw new ConflictException('UPLOAD_SESSION_EXPIRED')
      }
      return { replayed: true, response: this.uploadResponse(raced) }
    }
  }

  async uploadBytes(
    uploadSessionId: string,
    uploadToken: string,
    userId: string,
    role: ApiRole,
    mimeType: GarmentMimeType,
    contentLength: number | undefined,
    body: Buffer
  ): Promise<void> {
    const garment = await this.prisma.garmentItem.findUnique({
      where: { upload_session_id: uploadSessionId },
    })
    if (!garment) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }
    if (garment.user_id !== userId) {
      throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
    }
    if (garment.retention_status !== 'active') {
      throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
    }
    if (garment.upload_status !== 'pending_upload') {
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
    if (!garment.upload_expires_at || garment.upload_expires_at <= new Date()) {
      throw new ConflictException('UPLOAD_SESSION_EXPIRED')
    }
    if (
      !verifyUploadToken(
        uploadToken,
        uploadSessionId,
        userId,
        garment.upload_expires_at.toISOString(),
        this.uploadTokenSecret
      )
    ) {
      throw new ForbiddenException('INVALID_UPLOAD_TOKEN')
    }
    if (contentLength === undefined || contentLength !== body.length) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }

    const declaration = declarationFromGarment(garment)
    if (mimeType !== declaration.mimeType) {
      throw new BadRequestException('INVALID_UPLOAD_BODY')
    }
    try {
      await verifyGarmentImage(body, declaration)
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        mapImageValidationError(error)
      }
      throw error
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    await this.storage.upload(garment.object_path!, body, declaration.mimeType)

    const updated = await this.prisma.garmentItem.updateMany({
      where: {
        id: garment.id,
        upload_status: 'pending_upload',
        retention_status: 'active',
      },
      data: {
        upload_status: 'bytes_uploaded',
        consent_checked_at: new Date(),
      },
    })
    if (updated.count !== 1) {
      await this.storage.remove([garment.object_path!])
      throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
    }
  }

  private async toResponse(garment: GarmentItem): Promise<GarmentItemResponse> {
    if (!garment.object_path) {
      throw new ServiceUnavailableException('STORAGE_UNAVAILABLE')
    }
    const readUrl = await this.storage.signReadUrl(
      garment.object_path,
      READ_URL_EXPIRY_SECONDS
    )
    return {
      data: {
        id: garment.id,
        status: garment.upload_status,
        category: garment.category as GarmentCategory | null,
        material: garment.material as GarmentMaterial | null,
        comfortRange: garment.comfort_range as GarmentComfortRange | null,
        tagsConfirmedAt: garment.tags_confirmed_at?.toISOString() ?? null,
        fileSizeBytes: garment.file_size_bytes,
        mimeType: garment.mime_type as GarmentMimeType | null,
        retentionStatus: garment.retention_status,
        createdAt: garment.created_at.toISOString(),
        committedAt: garment.committed_at?.toISOString() ?? null,
        imageAccess: {
          url: readUrl,
          expiresAt: new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString(),
        },
      },
    }
  }

  async listGarments(userId: string): Promise<{ data: GarmentItemResponse['data'][] }> {
    const garments = await this.prisma.garmentItem.findMany({
      where: {
        user_id: userId,
        object_path: { not: null },
        retention_status: 'active',
        upload_status: { in: ['processing', 'awaiting_tags', 'ready', 'failed'] },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    })
    const responses = await Promise.all(
      garments.map((garment) => this.toResponse(garment))
    )
    return { data: responses.map((response) => response.data) }
  }

  async suggestGarmentTags(
    userId: string,
    role: ApiRole,
    garmentId: string
  ): Promise<SuggestGarmentTagsResponse> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const garment = await this.prisma.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })

    assertTaggableGarment(garment)

    if (!garment.tag_suggestions) {
      throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
    }

    const parsed = garmentTagSuggestionSnapshotSchema.safeParse(garment.tag_suggestions)
    if (!parsed.success) {
      this.logger.error(
        {
          garmentId: garment.id,
          issueCount: parsed.error.issues.length,
          userId,
        },
        'Stored garment tag suggestion snapshot is invalid'
      )
      throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
    }

    return {
      data: {
        garmentId: garment.id,
        analysisVersion: parsed.data.analysisVersion,
        suggestions: {
          category: parsed.data.category,
          material: parsed.data.material,
          comfortRange: parsed.data.comfortRange,
        },
      },
    }
  }

  async updateGarmentTags(
    userId: string,
    role: ApiRole,
    garmentId: string,
    input: UpdateGarmentTagsInput
  ): Promise<GarmentItemResponse> {
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    const result = await this.confirmTagsTransaction(userId, garmentId, input)

    if (result.telemetryProperties) {
      try {
        await this.telemetryService.captureEvent(
          userId,
          'garment_tagging_completed',
          result.telemetryProperties
        )
      } catch (error) {
        this.logger.error(
          { error, garmentId, userId },
          'Failed to emit garment tagging telemetry'
        )
      }
    }

    if (result.cacheInvalidationRequired) {
      try {
        const invalidated = await this.ritualService.invalidateUserCache(userId)
        if (invalidated) {
          this.logger.info(
            { garmentId, userId },
            'Invalidated Ritual cache after tag update'
          )
        } else {
          this.logger.error(
            { garmentId, userId },
            'Ritual cache invalidation failed after tag update'
          )
        }
      } catch (error) {
        this.logger.error(
          { error, garmentId, userId },
          'Ritual cache invalidation failed after tag update'
        )
      }
    }

    return this.toResponse(result.updated)
  }

  private async confirmTagsTransaction(
    userId: string,
    garmentId: string,
    input: UpdateGarmentTagsInput
  ): Promise<TagConfirmationResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.confirmTagsInTransaction(tx, userId, garmentId, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      } catch (error) {
        if (isRetriableTagUpdateError(error)) {
          if (attempt < 3) {
            continue
          }
          throw new ConflictException('CONCURRENT_TAG_UPDATE')
        }
        throw error
      }
    }
    throw new ConflictException('CONCURRENT_TAG_UPDATE')
  }

  private async confirmTagsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    garmentId: string,
    input: UpdateGarmentTagsInput
  ): Promise<TagConfirmationResult> {
    const garment = await tx.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })
    assertTaggableGarment(garment)

    const targetMaterial = resolveTargetMaterial(garment, input)
    if (isUnchangedTagConfirmation(garment, input, targetMaterial)) {
      return {
        updated: garment,
        telemetryProperties: null,
        cacheInvalidationRequired: false,
      }
    }

    const { suggestion, hasMalformedSuggestion } = parseTagSuggestion(garment)
    const isFirstConfirmation = garment.upload_status === 'awaiting_tags'
    const shouldEmitTelemetry =
      isFirstConfirmation && garment.tagging_telemetry_emitted_at === null
    const now = new Date()
    const changed = await tx.garmentItem.updateMany({
      where: {
        id: garment.id,
        user_id: userId,
        retention_status: 'active',
        upload_status: garment.upload_status,
      },
      data: {
        category: input.category,
        material: targetMaterial,
        comfort_range: input.comfortRange,
        upload_status: 'ready',
        tags_confirmed_at: isFirstConfirmation ? now : (garment.tags_confirmed_at ?? now),
        tagging_telemetry_emitted_at: shouldEmitTelemetry ? now : undefined,
        tag_suggestions: hasMalformedSuggestion ? Prisma.DbNull : undefined,
        tagging_model_version: hasMalformedSuggestion ? null : undefined,
        tag_suggested_at: hasMalformedSuggestion ? null : undefined,
        tagging_failure_code: hasMalformedSuggestion
          ? 'TAGGING_OUTPUT_INVALID'
          : undefined,
      },
    })
    if (changed.count !== 1) {
      throw new ConcurrentTagUpdateError('Concurrent tag update')
    }

    const updated = await tx.garmentItem.findUniqueOrThrow({
      where: { id: garment.id },
    })
    return {
      updated,
      cacheInvalidationRequired: true,
      telemetryProperties: shouldEmitTelemetry
        ? buildTaggingTelemetryProperties(
            userId,
            garment.id,
            suggestion,
            input,
            targetMaterial
          )
        : null,
    }
  }

  async commitGarment(
    userId: string,
    role: ApiRole,
    input: CreateGarmentItemInput,
    idempotencyKey: string
  ): Promise<CommitResult> {
    const payloadHash = commitPayloadHash(input)
    const initial = await this.prisma.garmentItem.findUnique({
      where: { id: input.garmentId },
    })
    assertCommitCandidate(initial, userId, input)

    if (COMMITTED_UPLOAD_STATUSES.has(initial.upload_status)) {
      return this.replayCommittedGarment(initial, idempotencyKey, payloadHash)
    }
    if (initial.upload_status !== 'bytes_uploaded') {
      throw new BadRequestException('INVALID_GARMENT_COMMIT')
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    await this.verifyStoredGarment(initial)

    let committed: GarmentItem
    try {
      committed = await this.transitionGarmentToProcessing(
        initial,
        userId,
        input,
        idempotencyKey,
        payloadHash
      )
    } catch (error) {
      const replay = await this.reconcileConcurrentCommit(
        initial.id,
        idempotencyKey,
        payloadHash
      )
      if (replay) return replay
      throw error
    }

    await this.ensureProcessingHandoff(committed)
    await this.emitUploadCompletionTelemetry(userId, committed)

    const refreshed = await this.prisma.garmentItem.findUniqueOrThrow({
      where: { id: committed.id },
    })
    return { replayed: false, response: await this.toResponse(refreshed) }
  }

  private async replayCommittedGarment(
    garment: GarmentItem,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<CommitResult> {
    assertCommitReplayMatches(garment, idempotencyKey, payloadHash)
    if (garment.upload_status === 'processing') {
      await this.ensureProcessingHandoff(garment)
    }
    return { replayed: true, response: await this.toResponse(garment) }
  }

  private async verifyStoredGarment(garment: GarmentItem): Promise<void> {
    const storedBytes = await this.storage.download(garment.object_path!)
    try {
      await verifyGarmentImage(storedBytes, declarationFromGarment(garment))
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        await this.storage.remove([garment.object_path!]).catch(() => undefined)
        mapImageValidationError(error)
      }
      throw error
    }
  }

  private async transitionGarmentToProcessing(
    initial: GarmentItem,
    userId: string,
    input: CreateGarmentItemInput,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<GarmentItem> {
    return this.prisma.$transaction(
      async (tx) => {
        const keyOwner = await tx.garmentItem.findUnique({
          where: {
            user_id_commit_idempotency_key: {
              user_id: userId,
              commit_idempotency_key: idempotencyKey,
            },
          },
        })
        if (keyOwner && keyOwner.id !== initial.id) {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
        }

        const changed = await tx.garmentItem.updateMany({
          where: {
            id: initial.id,
            user_id: userId,
            upload_session_id: input.uploadSessionId,
            upload_status: 'bytes_uploaded',
            retention_status: 'active',
          },
          data: {
            upload_status: 'processing',
            committed_at: new Date(),
            commit_idempotency_key: idempotencyKey,
            commit_payload_hash: payloadHash,
            consent_checked_at: new Date(),
            has_cropping: input.hasCropping,
            has_bg_cleanup: input.hasBgCleanup,
          },
        })
        if (changed.count !== 1) {
          throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
        }
        return tx.garmentItem.findUniqueOrThrow({ where: { id: initial.id } })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  }

  private async emitUploadCompletionTelemetry(
    userId: string,
    garment: GarmentItem
  ): Promise<void> {
    const telemetryClaim = await this.prisma.garmentItem.updateMany({
      where: { id: garment.id, completion_telemetry_emitted_at: null },
      data: { completion_telemetry_emitted_at: new Date() },
    })
    if (telemetryClaim.count !== 1) {
      return
    }
    try {
      await this.telemetryService.captureEvent(userId, 'garment_upload_completed', {
        garmentId: garment.id,
        fileSizeBytes: garment.file_size_bytes!,
        mimeType: garment.mime_type as GarmentMimeType,
        hasCropping: garment.has_cropping,
        hasBgCleanup: garment.has_bg_cleanup,
        durationMs: Math.max(0, Date.now() - garment.created_at.getTime()),
      })
    } catch (error) {
      this.logger.error(
        { error, garmentId: garment.id, userId },
        'Failed to emit garment upload completion telemetry'
      )
    }
  }

  private async reconcileConcurrentCommit(
    garmentId: string,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<CommitResult | null> {
    const raced = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (
      raced?.upload_status !== 'processing' &&
      raced?.upload_status !== 'awaiting_tags' &&
      raced?.upload_status !== 'ready'
    ) {
      return null
    }
    if (
      raced.commit_idempotency_key !== idempotencyKey ||
      raced.commit_payload_hash !== payloadHash
    ) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    if (raced.upload_status === 'processing') {
      await this.ensureProcessingHandoff(raced)
    }
    return { replayed: true, response: await this.toResponse(raced) }
  }

  private async ensureProcessingHandoff(garment: GarmentItem): Promise<void> {
    if (garment.processing_job_enqueued_at) {
      return
    }
    await this.processingQueue.enqueue(garment.id)
    await this.prisma.garmentItem.updateMany({
      where: { id: garment.id, processing_job_enqueued_at: null },
      data: { processing_job_enqueued_at: new Date() },
    })
  }
}
