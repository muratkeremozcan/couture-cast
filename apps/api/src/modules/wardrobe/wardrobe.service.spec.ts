import { describe, expect, beforeEach, it, vi, type Mock } from 'vitest'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { WardrobeService } from './wardrobe.service'
import { createHash, createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service'

interface MockGarmentItemRepository {
  findFirst: Mock
  findUnique: Mock
  create: Mock
  update: Mock
}

interface MockPrismaClient {
  garmentItem: MockGarmentItemRepository
}

interface MockTelemetryService {
  captureEvent: Mock
}

describe('WardrobeService', () => {
  let service: WardrobeService
  let mockPrisma: MockPrismaClient
  let mockTelemetryService: MockTelemetryService

  beforeEach(() => {
    mockPrisma = {
      garmentItem: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    }

    mockTelemetryService = {
      captureEvent: vi.fn().mockResolvedValue(undefined),
    }

    service = new WardrobeService(
      mockPrisma as unknown as PrismaClient,
      mockTelemetryService as unknown as TelemetryService
    )
  })

  describe('createUploadUrl', () => {
    it('creates a new upload session when no idempotency key exists', async () => {
      const createdRecord = {
        id: 'garment_123',
        upload_session_id: 'session_123',
        file_size_bytes: 1024,
        mime_type: 'image/png',
      }
      mockPrisma.garmentItem.create.mockResolvedValue(createdRecord)

      const result = await service.createUploadUrl('user_123', {
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
        widthPx: 500,
        heightPx: 500,
      })

      expect(result.data.uploadSessionId).toBeDefined()
      expect(result.data.uploadUrl).toContain('/api/v1/wardrobe/uploads/')
      expect(result.data.uploadToken).toBeDefined()
      expect(mockPrisma.garmentItem.create).toHaveBeenCalledOnce()
    })

    it('returns existing session on matching idempotent replay', async () => {
      const existing = {
        id: 'garment_123',
        upload_session_id: 'session_123',
        file_size_bytes: 1024,
        mime_type: 'image/png',
        content_sha256: 'a'.repeat(64),
        upload_expires_at: new Date(Date.now() + 600000),
      }
      mockPrisma.garmentItem.findFirst.mockResolvedValue(existing)

      const result = await service.createUploadUrl(
        'user_123',
        {
          fileSizeBytes: 1024,
          mimeType: 'image/png',
          sha256: 'a'.repeat(64),
          widthPx: 500,
          heightPx: 500,
        },
        'key-123'
      )

      expect(result.data.garmentId).toBe('garment_123')
      expect(mockPrisma.garmentItem.create).not.toHaveBeenCalled()
    })

    it('throws ConflictException when idempotency key is reused with different payload', async () => {
      const existing = {
        id: 'garment_123',
        file_size_bytes: 1024,
        mime_type: 'image/png',
        content_sha256: 'a'.repeat(64),
      }
      mockPrisma.garmentItem.findFirst.mockResolvedValue(existing)

      await expect(
        service.createUploadUrl(
          'user_123',
          {
            fileSizeBytes: 2048,
            mimeType: 'image/png',
            sha256: 'a'.repeat(64),
            widthPx: 500,
            heightPx: 500,
          },
          'key-123'
        )
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('uploadBytes', () => {
    it('throws NotFoundException when upload session does not exist', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue(null)

      await expect(
        service.uploadBytes(
          'session_999',
          'token',
          'user_123',
          'image/png',
          Buffer.from('data')
        )
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException when session belongs to another user', async () => {
      mockPrisma.garmentItem.findUnique.mockResolvedValue({
        id: 'garment_123',
        user_id: 'other_user',
        upload_status: 'pending_upload',
      })

      await expect(
        service.uploadBytes(
          'session_123',
          'token',
          'user_123',
          'image/png',
          Buffer.from('data')
        )
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws UnprocessableEntityException when SHA-256 checksum mismatches', async () => {
      const body = Buffer.from('image-content')
      const wrongSha256 = 'b'.repeat(64)
      const expiresAt = new Date(Date.now() + 600000)

      const secret =
        process.env.WARDROBE_UPLOAD_TOKEN_SECRET ||
        'dev-wardrobe-upload-token-secret-32-chars'
      const uploadToken = createHmac('sha256', secret)
        .update(`session_123.user_123.${expiresAt.toISOString()}`)
        .digest('base64url')

      mockPrisma.garmentItem.findUnique.mockResolvedValue({
        id: 'garment_123',
        user_id: 'user_123',
        upload_status: 'pending_upload',
        upload_expires_at: expiresAt,
        mime_type: 'image/png',
        file_size_bytes: body.length,
        content_sha256: wrongSha256,
      })

      await expect(
        service.uploadBytes('session_123', uploadToken, 'user_123', 'image/png', body)
      ).rejects.toThrow(UnprocessableEntityException)
    })

    it('successfully updates upload_status to bytes_uploaded on valid upload', async () => {
      const body = Buffer.from('image-content')
      const sha256 = createHash('sha256').update(body).digest('hex')
      const expiresAt = new Date(Date.now() + 600000)

      const secret =
        process.env.WARDROBE_UPLOAD_TOKEN_SECRET ||
        'dev-wardrobe-upload-token-secret-32-chars'
      const uploadToken = createHmac('sha256', secret)
        .update(`session_123.user_123.${expiresAt.toISOString()}`)
        .digest('base64url')

      mockPrisma.garmentItem.findUnique.mockResolvedValue({
        id: 'garment_123',
        user_id: 'user_123',
        upload_status: 'pending_upload',
        upload_expires_at: expiresAt,
        mime_type: 'image/png',
        file_size_bytes: body.length,
        content_sha256: sha256,
      })

      mockPrisma.garmentItem.update.mockResolvedValue({
        id: 'garment_123',
        upload_status: 'bytes_uploaded',
      })

      await service.uploadBytes('session_123', uploadToken, 'user_123', 'image/png', body)

      expect(mockPrisma.garmentItem.update).toHaveBeenCalledWith({
        where: { id: 'garment_123' },
        data: { upload_status: 'bytes_uploaded' },
      })
    })
  })

  describe('commitGarment', () => {
    it('commits garment and emits telemetry event', async () => {
      const garment = {
        id: 'garment_123',
        user_id: 'user_123',
        object_path: 'wardrobe/user_123/garment_123.png',
        upload_status: 'bytes_uploaded',
        file_size_bytes: 1024,
        mime_type: 'image/png',
        category: null,
        retention_status: 'active',
        created_at: new Date(),
      }

      mockPrisma.garmentItem.findUnique.mockResolvedValue(garment)
      mockPrisma.garmentItem.update.mockResolvedValue({
        ...garment,
        upload_status: 'processing',
        committed_at: new Date(),
        has_cropping: true,
        has_bg_cleanup: true,
      })

      const response = await service.commitGarment('user_123', {
        garmentId: 'garment_123',
        uploadSessionId: 'session_123',
        hasCropping: true,
        hasBgCleanup: true,
      })

      expect(response.data.status).toBe('processing')
      expect(mockTelemetryService.captureEvent).toHaveBeenCalledWith(
        'user_123',
        'garment_upload_completed',
        expect.objectContaining({
          garment_id: 'garment_123',
          has_cropping: true,
          has_bg_cleanup: true,
        })
      )
    })
  })
})
