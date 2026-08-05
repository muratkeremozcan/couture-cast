import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeController } from './wardrobe.controller'
import type { WardrobeRetentionService } from './wardrobe-retention.service'
import type { WardrobeService } from './wardrobe.service'

const mockAuth: RequestAuthContext = {
  token: 'mock-token',
  userId: 'user_123',
  role: 'teen',
}

const mockListGarments = vi.fn()
const mockCreateUploadUrl = vi.fn()
const mockUploadBytes = vi.fn()
const mockCommitGarment = vi.fn()
const mockRequestDeletion = vi.fn()
const mockSuggestGarmentTags = vi.fn()
const mockUpdateGarmentTags = vi.fn()

const mockWardrobeService = {
  listGarments: mockListGarments,
  createUploadUrl: mockCreateUploadUrl,
  uploadBytes: mockUploadBytes,
  commitGarment: mockCommitGarment,
  suggestGarmentTags: mockSuggestGarmentTags,
  updateGarmentTags: mockUpdateGarmentTags,
} as unknown as WardrobeService

const mockRetentionService = {
  requestDeletion: mockRequestDeletion,
} as unknown as WardrobeRetentionService

describe('WardrobeController', () => {
  const controller = new WardrobeController(mockWardrobeService, mockRetentionService)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('delegates listGarments to WardrobeService', async () => {
    mockListGarments.mockResolvedValue({ data: [] })
    const result = await controller.listGarments(mockAuth)
    expect(result).toEqual({ data: [] })
    expect(mockListGarments).toHaveBeenCalledWith('user_123')
  })

  it('validates upload url allocation payload and idempotency key', async () => {
    const responseMock = { status: vi.fn() } as unknown as Parameters<
      typeof controller.createUploadUrl
    >[3]

    await expect(
      controller.createUploadUrl(
        mockAuth,
        { invalid: true },
        'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
        responseMock
      )
    ).rejects.toThrow(BadRequestException)

    await expect(
      controller.createUploadUrl(
        mockAuth,
        {
          fileSizeBytes: 2048,
          mimeType: 'image/png',
          sha256: 'b6d81b360a5672d80c27430f39153e2c3f359dd3a214b61213cfa1447d2d73e5',
          widthPx: 1024,
          heightPx: 1024,
        },
        'not-a-uuid',
        responseMock
      )
    ).rejects.toThrow('INVALID_IDEMPOTENCY_KEY')
  })

  it('rejects uploadBytes with unsupported mime type or missing token', async () => {
    const reqMock = { body: Buffer.from('test') } as unknown as Parameters<
      typeof controller.uploadBytes
    >[5]

    await expect(
      controller.uploadBytes(mockAuth, 'session_1', '', 'image/png', '4', reqMock)
    ).rejects.toThrow('Missing upload token header')

    await expect(
      controller.uploadBytes(mockAuth, 'session_1', 'token_1', 'image/gif', '4', reqMock)
    ).rejects.toThrow(UnsupportedMediaTypeException)
  })

  it('delegates deletion to retention service', async () => {
    await controller.deleteGarment(mockAuth, 'garment_99')
    expect(mockRequestDeletion).toHaveBeenCalledWith('user_123', 'garment_99')
  })

  it('rejects a service response that violates the public smart-tagging contract', async () => {
    mockSuggestGarmentTags.mockResolvedValueOnce({
      data: {
        garmentId: 'garment_99',
        analysisVersion: 'untrusted-version',
        suggestions: {},
      },
    })

    await expect(controller.suggestGarmentTags(mockAuth, 'garment_99')).rejects.toThrow()
  })
})
