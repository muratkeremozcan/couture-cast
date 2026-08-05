import { describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import {
  createGarmentItemInputSchema,
  createGarmentItemResponseSchema,
  createGarmentUploadUrlInputSchema,
  createGarmentUploadUrlResponseSchema,
  garmentItemSchema,
  GARMENT_TAGGING_ANALYSIS_VERSION,
  generateHttpOpenApiDocument,
  suggestGarmentTagsResponseSchema,
  uploadGarmentBytes,
} from '../src/contracts/http'

const VALID_SHA256 = 'b6d81b360a5672d80c27430f39153e2c3f359dd3a214b61213cfa1447d2d73e5'

function buildUploadInput(overrides: Record<string, unknown> = {}) {
  return {
    fileSizeBytes: 2048576,
    mimeType: 'image/png',
    sha256: VALID_SHA256,
    widthPx: 1024,
    heightPx: 1024,
    ...overrides,
  }
}

function buildGarmentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clx123456789',
    status: 'processing',
    category: null,
    material: null,
    comfortRange: null,
    tagsConfirmedAt: null,
    fileSizeBytes: 2048576,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-04T09:25:00.000Z',
    committedAt: '2026-08-04T09:26:22.000Z',
    imageAccess: {
      url: 'https://example.supabase.co/storage/v1/object/sign/wardrobe-images/wardrobe/user_123/clx123456789.png',
      expiresAt: '2026-08-04T09:41:22.000Z',
    },
    ...overrides,
  }
}

function expectIssuePath(schema: z.ZodType, input: unknown, expectedPath: string): void {
  const result = schema.safeParse(input)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      expectedPath
    )
  }
}

describe('Wardrobe HTTP Contracts', () => {
  describe('Schema Validation', () => {
    it('validates garment upload-url input schema', () => {
      const input = buildUploadInput()
      const parsed = createGarmentUploadUrlInputSchema.parse(input)
      expect(parsed).toEqual(input)
    })

    it('validates garment upload-url response schema', () => {
      const responsePayload = {
        data: {
          garmentId: 'clx123456789',
          uploadSessionId: 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
          uploadUrl:
            'https://api.example/wardrobe/uploads/b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
          uploadToken: 'token_123',
          requiredHeaders: {
            'content-type': 'image/png',
          },
          expiresAt: '2026-08-04T09:40:00.000Z',
        },
      }
      const parsed = createGarmentUploadUrlResponseSchema.parse(responsePayload)
      expect(parsed.data.garmentId).toBe('clx123456789')
    })

    it('validates garment item commit input schema', () => {
      const commitInput = {
        garmentId: 'clx123456789',
        uploadSessionId: 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
        hasCropping: true,
        hasBgCleanup: true,
      }
      const parsed = createGarmentItemInputSchema.parse(commitInput)
      expect(parsed.garmentId).toBe('clx123456789')
    })

    it('validates garment item and commit response schemas', () => {
      const sampleItem = buildGarmentItem()
      const garmentItem = garmentItemSchema.parse(sampleItem)
      expect(garmentItem.id).toBe('clx123456789')
      expect(garmentItem.status).toBe('processing')

      const commitResponse = createGarmentItemResponseSchema.parse({
        data: sampleItem,
      })
      expect(commitResponse.data.id).toBe('clx123456789')
    })

    it('requires nullable tag fields and the exact pinned analysis version', () => {
      expect(
        garmentItemSchema.safeParse(buildGarmentItem({ material: undefined })).success
      ).toBe(false)
      expect(
        suggestGarmentTagsResponseSchema.safeParse({
          data: {
            garmentId: 'garment-1',
            analysisVersion: 'fashion-clip:untrusted',
            suggestions: {
              category: { value: 'top', confidence: 0.9, isConfident: true },
              material: { value: 'cotton', confidence: 0.8, isConfident: true },
              comfortRange: { value: 'mild', confidence: 0.8, isConfident: true },
            },
          },
        }).success
      ).toBe(false)
      expect(GARMENT_TAGGING_ANALYSIS_VERSION).toContain('prompts-v1')
    })
  })

  describe('Security & Boundary Rejection', () => {
    it('rejects client-injected userId in allocation schema', () => {
      const unknownAllocationField = createGarmentUploadUrlInputSchema.safeParse(
        buildUploadInput({ userId: 'client-injected-user-id' })
      )
      expect(unknownAllocationField.success).toBe(false)
      if (!unknownAllocationField.success) {
        expect(unknownAllocationField.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_keys', keys: ['userId'] }),
          ])
        )
      }
    })

    it('rejects invalid sha256 checksum strings', () => {
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ sha256: 'invalid-sha-256' }),
        'sha256'
      )
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ sha256: VALID_SHA256.toUpperCase() }),
        'sha256'
      )
    })

    it('rejects file size outside allowed bounds', () => {
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ fileSizeBytes: 0 }),
        'fileSizeBytes'
      )
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ fileSizeBytes: 20_000_000 }),
        'fileSizeBytes'
      )
    })

    it('rejects image dimensions outside valid ranges', () => {
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ widthPx: 255 }),
        'widthPx'
      )
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ heightPx: 4097 }),
        'heightPx'
      )
    })

    it('rejects unsupported image MIME types', () => {
      expectIssuePath(
        createGarmentUploadUrlInputSchema,
        buildUploadInput({ mimeType: 'image/gif' }),
        'mimeType'
      )
    })

    it('rejects client-injected userId in garment commit schema', () => {
      const unknownCommitField = createGarmentItemInputSchema.safeParse({
        garmentId: 'clx123456789',
        uploadSessionId: 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
        hasCropping: true,
        hasBgCleanup: true,
        userId: 'hacker-user',
      })
      expect(unknownCommitField.success).toBe(false)
      if (!unknownCommitField.success) {
        expect(unknownCommitField.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_keys', keys: ['userId'] }),
          ])
        )
      }
    })
  })

  describe('OpenAPI Registration', () => {
    it('registers authenticated wardrobe routes in OpenAPI specification', () => {
      const spec = generateHttpOpenApiDocument()

      const authenticatedRoutes = [
        {
          method: 'post',
          path: '/api/v1/wardrobe/upload-url',
          statuses: ['200', '201', '400', '401', '403', '409'],
        },
        {
          method: 'put',
          path: '/api/v1/wardrobe/uploads/{uploadSessionId}',
          statuses: ['204', '400', '401', '403', '404', '409'],
        },
        {
          method: 'post',
          path: '/api/v1/wardrobe/garments',
          statuses: ['200', '201', '400', '401', '403', '404', '409'],
        },
        {
          method: 'post',
          path: '/api/v1/wardrobe/garments/{garmentId}/suggest-tags',
          statuses: ['200', '400', '401', '403', '404', '409', '503'],
        },
        {
          method: 'patch',
          path: '/api/v1/wardrobe/garments/{garmentId}/tags',
          statuses: ['200', '400', '401', '403', '404', '409'],
        },
      ] as const

      for (const route of authenticatedRoutes) {
        const operation = spec.paths?.[route.path]?.[route.method]
        expect(
          operation?.security,
          `${route.method.toUpperCase()} ${route.path}`
        ).toEqual([{ bearerAuth: [] }])
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(route.statuses)
      }

      const uploadRelay = spec.paths?.['/api/v1/wardrobe/uploads/{uploadSessionId}']?.put
      expect(uploadRelay?.requestBody).toMatchObject({
        required: true,
        content: {
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'image/webp': { schema: { type: 'string', format: 'binary' } },
        },
      })

      expect(spec.paths?.['/api/v1/wardrobe/garments']?.post?.requestBody).toBeDefined()
      const suggestions =
        spec.paths?.['/api/v1/wardrobe/garments/{garmentId}/suggest-tags']?.post
      expect(suggestions?.responses?.['409']).toHaveProperty(
        'content.application/json.schema'
      )
      expect(suggestions?.responses?.['503']).toHaveProperty(
        'content.application/json.schema'
      )
      const tagUpdate = spec.paths?.['/api/v1/wardrobe/garments/{garmentId}/tags']?.patch
      expect(tagUpdate?.requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateGarmentTagsInput' },
          },
        },
      })

      const garmentResponse = spec.components?.schemas?.CreateGarmentItemResponse as
        | {
            properties?: {
              data?: { properties?: Record<string, { enum?: unknown[] }> }
            }
          }
        | undefined
      for (const field of ['category', 'material', 'comfortRange']) {
        expect(garmentResponse?.properties?.data?.properties?.[field]?.enum).toContain(
          null
        )
      }
    })
  })

  describe('uploadGarmentBytes Transport Helper', () => {
    it('reports completion once for Blob upload bodies', async () => {
      const blobProgress = vi.fn()
      const successfulFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }))
      const blob = new Blob(['fixture-body'], { type: 'image/png' })

      await uploadGarmentBytes({
        uploadUrl: 'https://api.example.test/upload',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/png',
        body: blob,
        onProgress: blobProgress,
        timeoutMs: 1000,
        fetchFn: successfulFetch,
      })

      expect(blobProgress).toHaveBeenCalledOnce()
      expect(blobProgress).toHaveBeenCalledWith(blob.size, blob.size)
      expect(successfulFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    })

    it('reports completion once for ArrayBuffer upload bodies and handles HTTP failures', async () => {
      const bufferProgress = vi.fn()
      const failedFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 }))
      const buffer = new Uint8Array([1, 2, 3, 4]).buffer

      await expect(
        uploadGarmentBytes({
          uploadUrl: 'https://api.example.test/upload',
          uploadToken: 'upload-token',
          bearerToken: 'access-token',
          mimeType: 'image/png',
          body: buffer,
          onProgress: bufferProgress,
          fetchFn: failedFetch,
        })
      ).rejects.toThrow('Upload failed with HTTP 500')
      expect(bufferProgress).toHaveBeenCalledOnce()
      expect(bufferProgress).toHaveBeenCalledWith(buffer.byteLength, buffer.byteLength)
    })
  })
})
