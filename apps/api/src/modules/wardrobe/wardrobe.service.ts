// Story 4.1 Task 5 step 2 owner: implement HMAC upload tokens, checksum validation, and garment commit logic
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import {
  CreateGarmentItemInput,
  CreateGarmentUploadUrlInput,
  GarmentItemResponse,
} from '@couture/api-client/contracts/http'
import { TelemetryService } from '../telemetry/telemetry.service'

const UPLOAD_EXPIRY_SECONDS = 900
const READ_URL_EXPIRY_SECONDS = 900

function getUploadTokenSecret(): string {
  return (
    process.env.WARDROBE_UPLOAD_TOKEN_SECRET ||
    'dev-wardrobe-upload-token-secret-32-chars'
  )
}

function deriveObjectExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function generateUploadToken(
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string
): string {
  const secret = getUploadTokenSecret()
  const data = `${uploadSessionId}.${userId}.${expiresAtIso}`
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function verifyUploadToken(
  token: string,
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string
): boolean {
  const expected = generateUploadToken(uploadSessionId, userId, expiresAtIso)
  if (token.length !== expected.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

function validateUploadState(
  garment: {
    user_id: string
    upload_status: string
    upload_expires_at: Date | null
    mime_type: string | null
    content_sha256: string | null
  },
  userId: string,
  uploadToken: string,
  uploadSessionId: string,
  mimeType: string,
  body: Buffer
): void {
  if (garment.user_id !== userId) {
    throw new ForbiddenException('WARDROBE_UPLOAD_FORBIDDEN')
  }

  if (
    garment.upload_status === 'bytes_uploaded' ||
    garment.upload_status === 'processing' ||
    garment.upload_status === 'ready'
  ) {
    throw new ConflictException('UPLOAD_TOKEN_CONSUMED')
  }

  if (garment.upload_expires_at && garment.upload_expires_at < new Date()) {
    throw new ConflictException('UPLOAD_SESSION_EXPIRED')
  }

  const isValidToken = verifyUploadToken(
    uploadToken,
    uploadSessionId,
    userId,
    garment.upload_expires_at!.toISOString()
  )

  if (!isValidToken) {
    throw new BadRequestException('INVALID_UPLOAD_TOKEN')
  }

  if (
    !body ||
    body.length === 0 ||
    body.length > 10_485_760 ||
    (garment.mime_type && mimeType !== garment.mime_type)
  ) {
    throw new BadRequestException('INVALID_UPLOAD_BODY')
  }

  if (garment.content_sha256) {
    const computedSha256 = createHash('sha256').update(body).digest('hex')
    if (computedSha256 !== garment.content_sha256) {
      throw new UnprocessableEntityException('IMAGE_CHECKSUM_MISMATCH')
    }
  }
}

@Injectable()
export class WardrobeService {
  constructor(
    @Inject('PRISMA_CLIENT') private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService
  ) {}

  async createUploadUrl(
    userId: string,
    input: CreateGarmentUploadUrlInput,
    idempotencyKey?: string
  ) {
    if (idempotencyKey) {
      const existingKeyMatch = await this.prisma.garmentItem.findFirst({
        where: {
          user_id: userId,
          upload_idempotency_key: idempotencyKey,
        },
      })

      if (existingKeyMatch) {
        if (
          existingKeyMatch.file_size_bytes === input.fileSizeBytes &&
          existingKeyMatch.mime_type === input.mimeType &&
          existingKeyMatch.content_sha256 === input.sha256
        ) {
          const expiresAt =
            existingKeyMatch.upload_expires_at ??
            new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)
          const uploadToken = generateUploadToken(
            existingKeyMatch.upload_session_id!,
            userId,
            expiresAt.toISOString()
          )
          const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:3001'

          return {
            data: {
              garmentId: existingKeyMatch.id,
              uploadSessionId: existingKeyMatch.upload_session_id!,
              uploadUrl: `${baseUrl}/api/v1/wardrobe/uploads/${existingKeyMatch.upload_session_id}`,
              uploadToken,
              requiredHeaders: {
                'content-type': input.mimeType,
              },
              expiresAt: expiresAt.toISOString(),
            },
          }
        } else {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
        }
      }
    }

    const garmentId = `garment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const uploadSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const ext = deriveObjectExtension(input.mimeType)
    const objectPath = `wardrobe/${userId}/${garmentId}.${ext}`
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)

    const createdGarment = await this.prisma.garmentItem.create({
      data: {
        id: garmentId,
        user_id: userId,
        object_path: objectPath,
        upload_session_id: uploadSessionId,
        upload_idempotency_key: idempotencyKey ?? null,
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

    const uploadToken = generateUploadToken(
      uploadSessionId,
      userId,
      expiresAt.toISOString()
    )
    const baseUrl = process.env.PUBLIC_API_URL || 'http://localhost:3001'

    return {
      data: {
        garmentId: createdGarment.id,
        uploadSessionId,
        uploadUrl: `${baseUrl}/api/v1/wardrobe/uploads/${uploadSessionId}`,
        uploadToken,
        requiredHeaders: {
          'content-type': input.mimeType,
        },
        expiresAt: expiresAt.toISOString(),
      },
    }
  }

  async uploadBytes(
    uploadSessionId: string,
    uploadToken: string,
    userId: string,
    mimeType: string,
    body: Buffer
  ): Promise<void> {
    const garment = await this.prisma.garmentItem.findUnique({
      where: { upload_session_id: uploadSessionId },
    })

    if (!garment) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }

    validateUploadState(garment, userId, uploadToken, uploadSessionId, mimeType, body)

    await this.prisma.garmentItem.update({
      where: { id: garment.id },
      data: {
        upload_status: 'bytes_uploaded',
      },
    })
  }

  async commitGarment(
    userId: string,
    input: CreateGarmentItemInput
  ): Promise<GarmentItemResponse> {
    const garment = await this.prisma.garmentItem.findUnique({
      where: { id: input.garmentId },
    })

    if (!garment || garment.user_id !== userId) {
      throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND')
    }

    if (garment.upload_status === 'processing' || garment.upload_status === 'ready') {
      const readUrl = `https://supabase.example.com/storage/v1/object/sign/wardrobe-images/${garment.object_path}?token=sample`
      return {
        data: {
          id: garment.id,
          status: garment.upload_status,
          category: garment.category,
          fileSizeBytes: garment.file_size_bytes,
          mimeType: garment.mime_type,
          retentionStatus: garment.retention_status as
            | 'active'
            | 'deletion_pending'
            | 'legal_hold',
          createdAt: garment.created_at.toISOString(),
          committedAt: garment.committed_at ? garment.committed_at.toISOString() : null,
          imageAccess: {
            url: readUrl,
            expiresAt: new Date(
              Date.now() + READ_URL_EXPIRY_SECONDS * 1000
            ).toISOString(),
          },
        },
      }
    }

    if (
      garment.upload_status !== 'bytes_uploaded' &&
      garment.upload_status !== 'pending_upload'
    ) {
      throw new BadRequestException('INVALID_GARMENT_COMMIT')
    }

    const updatedGarment = await this.prisma.garmentItem.update({
      where: { id: garment.id },
      data: {
        upload_status: 'processing',
        committed_at: new Date(),
        has_cropping: input.hasCropping,
        has_bg_cleanup: input.hasBgCleanup,
      },
    })

    await this.telemetryService.captureEvent(userId, 'garment_upload_completed', {
      garment_id: updatedGarment.id,
      file_size_bytes: updatedGarment.file_size_bytes ?? 0,
      mime_type: updatedGarment.mime_type as 'image/jpeg' | 'image/png' | 'image/webp',
      has_cropping: updatedGarment.has_cropping,
      has_bg_cleanup: updatedGarment.has_bg_cleanup,
      duration_ms: 1200,
    })

    const readUrl = `https://supabase.example.com/storage/v1/object/sign/wardrobe-images/${updatedGarment.object_path}?token=sample`

    return {
      data: {
        id: updatedGarment.id,
        status: 'processing',
        category: updatedGarment.category,
        fileSizeBytes: updatedGarment.file_size_bytes,
        mimeType: updatedGarment.mime_type,
        retentionStatus: updatedGarment.retention_status as
          | 'active'
          | 'deletion_pending'
          | 'legal_hold',
        createdAt: updatedGarment.created_at.toISOString(),
        committedAt: updatedGarment.committed_at!.toISOString(),
        imageAccess: {
          url: readUrl,
          expiresAt: new Date(Date.now() + READ_URL_EXPIRY_SECONDS * 1000).toISOString(),
        },
      },
    }
  }
}
