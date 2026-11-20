// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/unbound-method -- assertions read the vi.fn() `status` member off the mocked Express response, which is the established pattern for these suites. */
import { BadRequestException, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
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

const VALID_KEY = 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272'

const validUploadDeclaration = {
  fileSizeBytes: 2048,
  mimeType: 'image/png' as const,
  sha256: 'b6d81b360a5672d80c27430f39153e2c3f359dd3a214b61213cfa1447d2d73e5',
  widthPx: 1024,
  heightPx: 1024,
}

const validCommitPayload = {
  garmentId: 'garment_99',
  uploadSessionId: 'session_1',
  hasCropping: false,
  hasBgCleanup: false,
}

/** The minimum shape `garmentItemSchema` accepts, used for contract-parse assertions. */
function garmentItemResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'garment_99',
      status: 'ready',
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
      tagsConfirmedAt: '2026-08-05T12:00:00.000Z',
      fileSizeBytes: 2048,
      mimeType: 'image/png',
      retentionStatus: 'active',
      createdAt: '2026-08-05T11:00:00.000Z',
      committedAt: '2026-08-05T11:30:00.000Z',
      imageAccess: {
        url: 'https://storage.test/signed.png',
        expiresAt: '2026-08-05T12:15:00.000Z',
      },
      ...overrides,
    },
  }
}

const mockListGarments = vi.fn()
const mockCreateUploadUrl = vi.fn()
const mockCommitGarment = vi.fn()
const mockRequestDeletion = vi.fn()
const mockSuggestGarmentTags = vi.fn()
const mockUpdateGarmentTags = vi.fn()

const mockWardrobeService = {
  listGarments: mockListGarments,
  createUploadUrl: mockCreateUploadUrl,
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

  /**
   * Image bytes go straight to storage on a signed upload URL. A Vercel Function refuses a
   * body over about 4.5 MB, so no route here may accept them (tester report 2026-11-19).
   */
  it('exposes no route that accepts upload bytes', () => {
    const prototype = WardrobeController.prototype as unknown as Record<string, unknown>
    const routes = Object.getOwnPropertyNames(prototype)
      .map((name) => prototype[name])
      .filter((handler): handler is object => typeof handler === 'function')
      .filter((handler) => Reflect.getMetadata(PATH_METADATA, handler) !== undefined)
      .map((handler) => ({
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        path: Reflect.getMetadata(PATH_METADATA, handler) as string,
      }))

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: RequestMethod.POST, path: 'upload-url' },
        { method: RequestMethod.POST, path: 'garments' },
      ])
    )
    expect(routes.filter((route) => route.method === RequestMethod.PUT)).toEqual([])
    expect(routes.filter((route) => route.path.includes('uploads'))).toEqual([])
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

    await expect(controller.suggestGarmentTags(mockAuth, 'garment_99')).rejects.toThrow(
      'Invalid literal value'
    )
  })

  describe('createUploadUrl', () => {
    /**
     * The service reports a replay through `replayed`, and the only place that
     * becomes visible to a client is the status code. A 201 on a replay would
     * tell the caller a second upload session was allocated when it was not.
     */
    it('answers 201 for a fresh allocation and 200 for a replay', async () => {
      const allocation = { data: { garmentId: 'garment_99' } }
      const freshRes = { status: vi.fn() } as unknown as Parameters<
        typeof controller.createUploadUrl
      >[3]
      mockCreateUploadUrl.mockResolvedValueOnce({
        replayed: false,
        response: allocation,
      })

      const fresh = await controller.createUploadUrl(
        mockAuth,
        validUploadDeclaration,
        VALID_KEY,
        freshRes
      )

      expect(fresh).toBe(allocation)
      expect(freshRes.status).toHaveBeenCalledWith(201)
      expect(mockCreateUploadUrl).toHaveBeenCalledWith(
        'user_123',
        'teen',
        validUploadDeclaration,
        VALID_KEY
      )

      const replayRes = { status: vi.fn() } as unknown as Parameters<
        typeof controller.createUploadUrl
      >[3]
      mockCreateUploadUrl.mockResolvedValueOnce({
        replayed: true,
        response: allocation,
      })

      await controller.createUploadUrl(
        mockAuth,
        validUploadDeclaration,
        VALID_KEY,
        replayRes
      )

      expect(replayRes.status).toHaveBeenCalledWith(200)
    })

    /** A rejected declaration must name the offending field, not just fail. */
    it('reports which declaration field failed validation', async () => {
      const responseMock = { status: vi.fn() } as unknown as Parameters<
        typeof controller.createUploadUrl
      >[3]

      await expect(
        controller.createUploadUrl(
          mockAuth,
          { ...validUploadDeclaration, widthPx: 12 },
          VALID_KEY,
          responseMock
        )
      ).rejects.toThrow(/Invalid upload declaration: widthPx/)
      expect(mockCreateUploadUrl).not.toHaveBeenCalled()
    })
  })

  describe('commitGarment', () => {
    it('answers 201 for a fresh commit and 200 for a replay', async () => {
      const committed = garmentItemResponse()
      const freshRes = { status: vi.fn() } as unknown as Parameters<
        typeof controller.commitGarment
      >[3]
      mockCommitGarment.mockResolvedValueOnce({ replayed: false, response: committed })

      const fresh = await controller.commitGarment(
        mockAuth,
        validCommitPayload,
        VALID_KEY,
        freshRes
      )

      expect(fresh).toBe(committed)
      expect(freshRes.status).toHaveBeenCalledWith(201)

      const replayRes = { status: vi.fn() } as unknown as Parameters<
        typeof controller.commitGarment
      >[3]
      mockCommitGarment.mockResolvedValueOnce({ replayed: true, response: committed })

      await controller.commitGarment(mockAuth, validCommitPayload, VALID_KEY, replayRes)

      expect(replayRes.status).toHaveBeenCalledWith(200)
    })

    it('rejects a commit payload that is not the canonical contract shape', async () => {
      const responseMock = { status: vi.fn() } as unknown as Parameters<
        typeof controller.commitGarment
      >[3]

      await expect(
        controller.commitGarment(
          mockAuth,
          { ...validCommitPayload, hasCropping: 'yes' },
          VALID_KEY,
          responseMock
        )
      ).rejects.toThrow(/Invalid garment commit payload: hasCropping/)
      expect(mockCommitGarment).not.toHaveBeenCalled()
    })

    /** The key is persisted under a unique constraint, so it is validated first. */
    it('rejects a non-UUID idempotency key before reaching the service', async () => {
      const responseMock = { status: vi.fn() } as unknown as Parameters<
        typeof controller.commitGarment
      >[3]

      await expect(
        controller.commitGarment(mockAuth, validCommitPayload, 'not-a-uuid', responseMock)
      ).rejects.toThrow('INVALID_IDEMPOTENCY_KEY')
      expect(mockCommitGarment).not.toHaveBeenCalled()
    })
  })

  describe('suggestGarmentTags', () => {
    it('rejects a garment id that exceeds the contract length bound', async () => {
      await expect(
        controller.suggestGarmentTags(mockAuth, 'g'.repeat(129))
      ).rejects.toThrow(/Invalid garment id: garmentId/)
      expect(mockSuggestGarmentTags).not.toHaveBeenCalled()
    })

    it('returns the contract-validated suggestion snapshot', async () => {
      const snapshot = createGarmentTagSuggestionSnapshotFixture()
      mockSuggestGarmentTags.mockResolvedValueOnce({
        data: {
          garmentId: 'garment_99',
          analysisVersion: snapshot.analysisVersion,
          suggestions: {
            category: snapshot.category,
            material: snapshot.material,
            comfortRange: snapshot.comfortRange,
          },
        },
      })

      const result = await controller.suggestGarmentTags(mockAuth, 'garment_99')

      expect(result.data.garmentId).toBe('garment_99')
      expect(result.data.suggestions.category.value).toBe(snapshot.category.value)
      expect(mockSuggestGarmentTags).toHaveBeenCalledWith(
        'user_123',
        'teen',
        'garment_99'
      )
    })
  })

  describe('updateGarmentTags', () => {
    const validTags = {
      category: 'top' as const,
      material: 'cotton' as const,
      comfortRange: 'mild' as const,
    }

    it('rejects an empty garment id before the body is even parsed', async () => {
      await expect(controller.updateGarmentTags(mockAuth, '', validTags)).rejects.toThrow(
        /Invalid garment id: garmentId/
      )
      expect(mockUpdateGarmentTags).not.toHaveBeenCalled()
    })

    it('rejects tags that are not in the canonical enum', async () => {
      await expect(
        controller.updateGarmentTags(mockAuth, 'garment_99', {
          ...validTags,
          category: 'spacesuit',
        })
      ).rejects.toThrow(/Invalid garment tags: category/)
      expect(mockUpdateGarmentTags).not.toHaveBeenCalled()
    })

    it('returns the contract-validated garment after a confirmed update', async () => {
      mockUpdateGarmentTags.mockResolvedValueOnce(garmentItemResponse())

      const result = await controller.updateGarmentTags(mockAuth, 'garment_99', validTags)

      expect(result.data.status).toBe('ready')
      expect(mockUpdateGarmentTags).toHaveBeenCalledWith(
        'user_123',
        'teen',
        'garment_99',
        validTags
      )
    })

    /**
     * The service builds this response from a Prisma row, so a column that drifts
     * out of contract must fail here rather than reach a client that will refuse
     * to parse it.
     */
    it('rejects a service response whose retention status is outside the contract', async () => {
      mockUpdateGarmentTags.mockResolvedValueOnce(
        garmentItemResponse({ retentionStatus: 'archived' })
      )

      await expect(
        controller.updateGarmentTags(mockAuth, 'garment_99', validTags)
      ).rejects.toThrow(/retentionStatus/)
    })
  })
})
