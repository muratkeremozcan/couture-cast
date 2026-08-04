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
import type {
  CreateGarmentItemInput,
  CreateGarmentUploadUrlInput,
  GarmentItemResponse,
} from '@couture/api-client/contracts/http'
import { buildGarmentObjectPath } from '@couture/utils'

import type { ApiRole } from '../auth/security.types'
import { GuardianService } from '../guardian/guardian.service'
import { TelemetryService } from '../telemetry/telemetry.service'
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
  if (process.env.NODE_ENV === 'test') {
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

@Injectable()
export class WardrobeService {
  private readonly uploadTokenSecret: string

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    @Inject(WardrobeProcessingQueue)
    private readonly processingQueue: WardrobeProcessingQueue
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
        category: garment.category,
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
        upload_status: { in: ['processing', 'ready'] },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    })
    const responses = await Promise.all(
      garments.map((garment) => this.toResponse(garment))
    )
    return { data: responses.map((response) => response.data) }
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
    if (!initial || initial.user_id !== userId) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }
    if (initial.upload_session_id !== input.uploadSessionId) {
      throw new ConflictException('UPLOAD_ALREADY_CLAIMED')
    }
    if (initial.retention_status !== 'active') {
      throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
    }

    if (initial.upload_status === 'processing' || initial.upload_status === 'ready') {
      if (
        initial.commit_idempotency_key !== idempotencyKey ||
        initial.commit_payload_hash !== payloadHash
      ) {
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
      }
      await this.ensureProcessingHandoff(initial)
      return { replayed: true, response: await this.toResponse(initial) }
    }
    if (initial.upload_status !== 'bytes_uploaded') {
      throw new BadRequestException('INVALID_GARMENT_COMMIT')
    }

    await this.guardianService.assertWardrobeUploadAllowed(userId, role)
    const storedBytes = await this.storage.download(initial.object_path!)
    try {
      await verifyGarmentImage(storedBytes, declarationFromGarment(initial))
    } catch (error) {
      if (error instanceof GarmentImageValidationError) {
        await this.storage.remove([initial.object_path!]).catch(() => undefined)
        mapImageValidationError(error)
      }
      throw error
    }

    let committed: GarmentItem
    try {
      committed = await this.prisma.$transaction(
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
          return await tx.garmentItem.findUniqueOrThrow({ where: { id: initial.id } })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
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

    const telemetryClaim = await this.prisma.garmentItem.updateMany({
      where: { id: committed.id, completion_telemetry_emitted_at: null },
      data: { completion_telemetry_emitted_at: new Date() },
    })
    if (telemetryClaim.count === 1) {
      await this.telemetryService.captureEvent(userId, 'garment_upload_completed', {
        garmentId: committed.id,
        fileSizeBytes: committed.file_size_bytes!,
        mimeType: committed.mime_type as GarmentMimeType,
        hasCropping: committed.has_cropping,
        hasBgCleanup: committed.has_bg_cleanup,
        durationMs: Math.max(0, Date.now() - committed.created_at.getTime()),
      })
    }

    const refreshed = await this.prisma.garmentItem.findUniqueOrThrow({
      where: { id: committed.id },
    })
    return { replayed: false, response: await this.toResponse(refreshed) }
  }

  private async reconcileConcurrentCommit(
    garmentId: string,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<CommitResult | null> {
    const raced = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (raced?.upload_status !== 'processing' && raced?.upload_status !== 'ready') {
      return null
    }
    if (
      raced.commit_idempotency_key !== idempotencyKey ||
      raced.commit_payload_hash !== payloadHash
    ) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
    }
    await this.ensureProcessingHandoff(raced)
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
