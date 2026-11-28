// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
// Learning path Step 63: Garment detail and tag edit (7.5-UNIT-014, header-gated colorFamily).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
// Learning path Step 84: Suggested tags that are right.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-84-suggested-tags-that-are-right
/* eslint-disable @typescript-eslint/unbound-method -- assertions read the vi.fn() `status` member off the mocked Express response, which is the established pattern for these suites. */
import { BadRequestException, RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { createGarmentTagSuggestionSnapshotFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZodError } from 'zod'
import type { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeController } from './wardrobe.controller'
import { WardrobeGarmentRemovalController } from './wardrobe-garment-removal.controller'
import type { WardrobeRetentionService } from './wardrobe-retention.service'
import type { WardrobeSavedLookService } from './wardrobe-saved-look.service.js'
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
const canTeenViewPrivateGarmentPhotos = vi.fn()
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
  const controller = new WardrobeController(mockWardrobeService, {
    canTeenViewPrivateGarmentPhotos,
  } as unknown as GuardianConsentStateService)
  // Story CC-7.6 D8: the garment DELETE moved to its own controller without the upload guard.
  const removalController = new WardrobeGarmentRemovalController(
    mockWardrobeService,
    mockRetentionService,
    {} as WardrobeSavedLookService
  )

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('delegates listGarments to WardrobeService', async () => {
    mockListGarments.mockResolvedValue({ data: [] })
    const result = await controller.listGarments(mockAuth)
    expect(result).toEqual({ data: [] })
    expect(mockListGarments).toHaveBeenCalledWith('user_123', undefined)
    expect(canTeenViewPrivateGarmentPhotos).not.toHaveBeenCalled()
  })

  it('[7.14-PIC-002] a pending teen negotiates an empty Today wardrobe without reading photo records', async () => {
    canTeenViewPrivateGarmentPhotos.mockResolvedValue(false)

    await expect(controller.listGarments(mockAuth, '1', '1')).resolves.toEqual({
      data: [],
    })
    expect(canTeenViewPrivateGarmentPhotos).toHaveBeenCalledExactlyOnceWith('user_123')
    expect(mockListGarments).not.toHaveBeenCalled()
  })

  it('[7.14-PIC-001] an active teen can read the Today wardrobe with category colors', async () => {
    canTeenViewPrivateGarmentPhotos.mockResolvedValue(true)
    mockListGarments.mockResolvedValue({ data: [] })

    await expect(controller.listGarments(mockAuth, '1', '1')).resolves.toEqual({
      data: [],
    })
    expect(mockListGarments).toHaveBeenCalledExactlyOnceWith('user_123', {
      includeColor: true,
      today: true,
    })
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
    await removalController.deleteGarment(mockAuth, 'garment_99')
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

    const error = (await controller
      .suggestGarmentTags(mockAuth, 'garment_99')
      .catch((caught: unknown) => caught)) as ZodError
    expect(error.name).toBe('ZodError')
    const issue = error.issues[0]
    if (issue?.code !== 'invalid_union') {
      throw new Error('Expected the smart-tagging response union to reject the result.')
    }
    expect(issue.errors.flat()).toContainEqual(
      expect.objectContaining({ code: 'invalid_value', path: ['analysisVersion'] })
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
      ).rejects.toThrow(
        'Invalid garment id: garmentId: String must contain at most 128 character(s)'
      )
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

      expect(result.data).toMatchObject({
        garmentId: 'garment_99',
        suggestions: { category: { value: snapshot.category.value } },
      })
      // The original wire shape, so a client from before manual mode keeps parsing it.
      expect(result.data).not.toHaveProperty('mode')
      expect(mockSuggestGarmentTags).toHaveBeenCalledWith(
        'user_123',
        'teen',
        'garment_99',
        false
      )
    })

    it.each([
      { header: '1', includeSubtype: true },
      { header: '0', includeSubtype: false },
      { header: ['1'], includeSubtype: false },
    ])(
      'forwards only exact subtype header opt-in ($header)',
      async ({ header, includeSubtype }) => {
        const snapshot = createGarmentTagSuggestionSnapshotFixture()
        const subtype = { value: 'tank', confidence: 0.4, isConfident: false }
        mockSuggestGarmentTags.mockResolvedValueOnce({
          data: {
            garmentId: 'garment_99',
            analysisVersion: snapshot.analysisVersion,
            suggestions: {
              category: snapshot.category,
              material: snapshot.material,
              comfortRange: snapshot.comfortRange,
              ...(includeSubtype && { subtype }),
            },
          },
        })
        const result = await controller.suggestGarmentTags(mockAuth, 'garment_99', header)
        expect(mockSuggestGarmentTags).toHaveBeenCalledExactlyOnceWith(
          'user_123',
          'teen',
          'garment_99',
          includeSubtype
        )
        expect(result.data).toHaveProperty('suggestions', {
          category: snapshot.category,
          material: snapshot.material,
          comfortRange: snapshot.comfortRange,
          ...(includeSubtype && { subtype }),
        })
      }
    )

    it('returns the manual-mode answer with no suggestions', async () => {
      mockSuggestGarmentTags.mockResolvedValueOnce({
        data: { mode: 'manual', garmentId: 'garment_99' },
      })

      const result = await controller.suggestGarmentTags(mockAuth, 'garment_99')

      expect(result).toEqual({ data: { mode: 'manual', garmentId: 'garment_99' } })
    })

    it('rejects a manual-mode answer that carries suggestions', async () => {
      mockSuggestGarmentTags.mockResolvedValueOnce({
        data: {
          mode: 'manual',
          garmentId: 'garment_99',
          suggestions: createGarmentTagSuggestionSnapshotFixture(),
        },
      })

      // The response contract is a union: manual carries no suggestions, so the answer fails
      // validation instead of reaching a client that would show both.
      await expect(
        controller.suggestGarmentTags(mockAuth, 'garment_99')
      ).rejects.toMatchObject({ name: 'ZodError' })
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

  describe('7.5 opt-in colorFamily header', () => {
    const tags = {
      category: 'top' as const,
      material: 'cotton' as const,
      comfortRange: 'mild' as const,
    }

    it.each([undefined, '', '0', 'true', 'yes', '1, 1', ['1', '1']])(
      '[P0] [7.5-UNIT-014] keeps the legacy list and tag shape when the header is %j',
      async (header) => {
        mockListGarments.mockResolvedValueOnce({ data: [garmentItemResponse().data] })
        mockUpdateGarmentTags.mockResolvedValueOnce(garmentItemResponse())

        const list = await controller.listGarments(mockAuth, header)
        const updated = await controller.updateGarmentTags(
          mockAuth,
          'garment_99',
          tags,
          header
        )

        expect(mockListGarments).toHaveBeenCalledWith('user_123', undefined)
        expect(mockUpdateGarmentTags).toHaveBeenCalledWith(
          'user_123',
          'teen',
          'garment_99',
          tags
        )
        expect(list.data[0]).not.toHaveProperty('colorFamily')
        expect(updated.data).not.toHaveProperty('colorFamily')
      }
    )

    it('[P0] [7.5-UNIT-014] asks the service for colorFamily on exactly 1 and returns it', async () => {
      mockListGarments.mockResolvedValueOnce({
        data: [
          garmentItemResponse({ colorFamily: 'blue' }).data,
          garmentItemResponse({ id: 'garment_100', colorFamily: null }).data,
        ],
      })
      mockUpdateGarmentTags.mockResolvedValueOnce(
        garmentItemResponse({ colorFamily: 'blue' })
      )

      const list = await controller.listGarments(mockAuth, '1')
      const updated = await controller.updateGarmentTags(
        mockAuth,
        'garment_99',
        tags,
        '1'
      )

      expect(mockListGarments).toHaveBeenCalledWith('user_123', { includeColor: true })
      expect(mockUpdateGarmentTags).toHaveBeenCalledWith(
        'user_123',
        'teen',
        'garment_99',
        tags,
        { includeColor: true }
      )
      expect(list).toMatchObject({
        data: [{ colorFamily: 'blue' }, { colorFamily: null }],
      })
      expect(updated.data).toMatchObject({ category: 'top', colorFamily: 'blue' })
    })

    it('[P0] [7.5-UNIT-014] refuses an opted-in service answer without a valid colorFamily', async () => {
      mockListGarments.mockResolvedValueOnce({ data: [garmentItemResponse().data] })
      await expect(controller.listGarments(mockAuth, '1')).rejects.toThrow(/colorFamily/)

      mockUpdateGarmentTags.mockResolvedValueOnce(
        garmentItemResponse({ colorFamily: 'navy' })
      )
      await expect(
        controller.updateGarmentTags(mockAuth, 'garment_99', tags, '1')
      ).rejects.toThrow(/colorFamily/)
    })

    it('[P1] [7.5-UNIT-014] refuses a legacy tag answer that leaks colorFamily', async () => {
      mockUpdateGarmentTags.mockResolvedValueOnce(
        garmentItemResponse({ colorFamily: 'blue' })
      )
      await expect(
        controller.updateGarmentTags(mockAuth, 'garment_99', tags)
      ).rejects.toThrow(/colorFamily/)
    })
  })
})
