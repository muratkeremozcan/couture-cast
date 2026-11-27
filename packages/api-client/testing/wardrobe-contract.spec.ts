// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Learning path Step 63: Garment detail and tag edit (7.5-UNIT-010..013, opt-in colorFamily).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 64: Garment delete (7.6-UNIT-010..011, usage read and DELETE contract).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createGarmentItemInputSchema,
  createGarmentItemResponseSchema,
  createGarmentUploadUrlInputSchema,
  createGarmentUploadUrlResponseSchema,
  garmentColorFamilyEnum,
  garmentItemSchema,
  garmentItemWithColorSchema,
  garmentListClientResponseSchema,
  garmentListResponseSchema,
  garmentListWithColorResponseSchema,
  GARMENT_TAGGING_ANALYSIS_VERSION,
  generateHttpOpenApiDocument,
  parseGarmentListWithColorResponse,
  parseUpdateGarmentTagsWithColorResponse,
  suggestGarmentTagsResponseSchema,
  suggestGarmentTagsWireResponseSchema,
  updateGarmentTagsResponseSchema,
  updateGarmentTagsClientResponseSchema,
  updateGarmentTagsWithColorResponseSchema,
  uploadGarmentBytes,
  WARDROBE_GARMENT_COLOR_HEADER,
  WARDROBE_GARMENT_SUBTYPE_HEADER,
  resolveApiUploadUrl,
  WARDROBE_UPLOAD_CACHE_CONTROL,
  uploadCommitConflictErrorSchema,
  uploadCommitUnprocessableErrorSchema,
  GARMENT_TAGS_CHANGED_MESSAGE,
  garmentExpectedTagsSchema,
  garmentListWireResponseSchema,
  updateGarmentTagsInputSchema,
  updateGarmentTagsWireResponseSchema,
  garmentUsageResponseSchema,
} from '../src/contracts/http'
import type {
  GarmentListResponse,
  GarmentListResponseDataInner,
  UpdateGarmentTagsInput as GeneratedUpdateGarmentTagsInput,
  UpdateGarmentTagsResponse as GeneratedUpdateGarmentTagsResponse,
} from '../src/generated/models'

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
            mode: 'suggested',
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
          method: 'post',
          path: '/api/v1/wardrobe/garments',
          statuses: ['200', '201', '400', '401', '403', '404', '409', '415', '422'],
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
        {
          method: 'post',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules',
          statuses: ['200', '201', '400', '401', '403', '404', '409'],
        },
        {
          method: 'get',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules',
          statuses: ['200', '400', '401', '404'],
        },
        {
          method: 'get',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
          statuses: ['200', '401', '404'],
        },
        {
          method: 'patch',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
          statuses: ['200', '400', '401', '403', '404', '409', '412', '428'],
        },
        {
          method: 'patch',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}/favorite',
          statuses: ['200', '400', '401', '403', '404', '412', '428'],
        },
        {
          method: 'delete',
          path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
          statuses: ['204', '401', '403', '404', '412', '428'],
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

      // Upload bytes go straight to a storage signed URL: a Vercel Function refuses a body over
      // about 4.5 MB (production follow-up 2026-11-19), so the API documents no byte relay.
      const relayPaths = Object.keys(spec.paths ?? {}).filter((path) =>
        /\/uploads\/\{uploadSessionId\}$/.test(path)
      )
      expect(relayPaths).toEqual([])

      // Commit is now the only byte check, so every refusal it answers is documented.
      expect(
        uploadCommitConflictErrorSchema.parse({
          statusCode: 409,
          message: 'UPLOAD_BYTES_MISSING',
          error: 'Conflict',
        }).message
      ).toBe('UPLOAD_BYTES_MISSING')
      expect(
        uploadCommitUnprocessableErrorSchema.parse({
          statusCode: 422,
          message: 'IMAGE_SIZE_MISMATCH',
          error: 'Unprocessable Entity',
        }).message
      ).toBe('IMAGE_SIZE_MISMATCH')
      const garmentCommit = spec.paths?.['/api/v1/wardrobe/garments']?.post
      expect(garmentCommit?.responses?.['415']).toHaveProperty(
        'content.application/json.schema.$ref',
        '#/components/schemas/UploadCommitUnsupportedMediaTypeError'
      )
      expect(garmentCommit?.responses?.['422']).toHaveProperty(
        'content.application/json.schema.$ref',
        '#/components/schemas/UploadCommitUnprocessableError'
      )

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
      expect(garmentResponse?.properties?.data?.properties?.mimeType).toMatchObject({
        enum: ['image/jpeg', 'image/png', 'image/webp', null],
        'x-optic-exemptions': 'request and response property enums',
      })
    })
  })

  describe('uploadGarmentBytes Transport Helper', () => {
    // Tester report 2026-11-17: production named http://localhost:3001 in the upload URL and
    // the phone's upload failed with "Failed to fetch".
    it('sends an /api/v1 upload to the client API base whatever host the API named', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }))
      await uploadGarmentBytes({
        uploadUrl: 'http://localhost:3001/api/v1/wardrobe/uploads/session-1?part=1',
        apiBaseUrl: '',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/png',
        body: new Blob(['x'], { type: 'image/png' }),
        fetchFn,
      })
      expect(fetchFn.mock.calls[0]?.[0]).toBe('/api/v1/wardrobe/uploads/session-1?part=1')
    })

    it('resolves upload URLs against the client API base only for the API path', () => {
      const named = 'http://localhost:3001/api/v1/wardrobe/uploads/session-1'
      expect(resolveApiUploadUrl(named)).toBe(named)
      expect(resolveApiUploadUrl(named, '')).toBe('/api/v1/wardrobe/uploads/session-1')
      expect(resolveApiUploadUrl(named, 'https://api.example.test/')).toBe(
        'https://api.example.test/api/v1/wardrobe/uploads/session-1'
      )
      const signed =
        'https://storage.example.test/object/upload/sign/community/a.jpg?token=t'
      expect(resolveApiUploadUrl(signed, '')).toBe(signed)
      expect(resolveApiUploadUrl('not a url', '')).toBe('not a url')
    })

    /**
     * Review round 1, 2026-11-19: wardrobe uploads PUT straight to storage, so the client sends
     * the cache policy the removed server upload set, and a retry after a lost answer finds
     * storage's "already exists" (no upsert) and goes on to commit, which verifies the sha256.
     */
    it('sends cache-control only when asked', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }))
      const base = {
        uploadUrl:
          'https://storage.example.test/object/upload/sign/w/staging/s.jpg?token=t',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/jpeg' as const,
        body: new Blob(['x'], { type: 'image/jpeg' }),
        fetchFn,
      }
      await uploadGarmentBytes({ ...base, cacheControl: WARDROBE_UPLOAD_CACHE_CONTROL })
      await uploadGarmentBytes(base)

      const headersOf = (call: number) =>
        fetchFn.mock.calls[call]?.[1]?.headers as Record<string, string>
      expect(headersOf(0)['Cache-Control']).toBe('private, max-age=0')
      expect(headersOf(1)).not.toHaveProperty('Cache-Control')
    })

    it.each([
      ['a 409', new Response(null, { status: 409 })],
      [
        'a 400 naming 409',
        new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ],
    ])(
      'treats %s from storage as uploaded when the caller accepts it',
      async (_, answer) => {
        const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(answer)
        await expect(
          uploadGarmentBytes({
            uploadUrl:
              'https://storage.example.test/object/upload/sign/w/staging/s.jpg?token=t',
            uploadToken: 'upload-token',
            bearerToken: 'access-token',
            mimeType: 'image/jpeg',
            body: new Blob(['x'], { type: 'image/jpeg' }),
            fetchFn,
            acceptExistingObject: true,
          })
        ).resolves.toBeUndefined()
      }
    )

    it('still fails a duplicate the caller did not accept, and any other 400', async () => {
      const duplicate = () =>
        new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      const options = {
        uploadUrl:
          'https://storage.example.test/object/upload/sign/w/staging/s.jpg?token=t',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/jpeg' as const,
        body: new Blob(['x'], { type: 'image/jpeg' }),
      }
      await expect(
        uploadGarmentBytes({
          ...options,
          fetchFn: vi.fn<typeof fetch>().mockResolvedValue(duplicate()),
        })
      ).rejects.toThrow('Upload failed with HTTP 400')
      await expect(
        uploadGarmentBytes({
          ...options,
          acceptExistingObject: true,
          fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
              JSON.stringify({ statusCode: '413', error: 'Payload too large' }),
              {
                status: 400,
                headers: { 'content-type': 'application/json' },
              }
            )
          ),
        })
      ).rejects.toThrow('Upload failed with HTTP 400')
    })

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

    // The relay returns the shared `{ error: { message } }` envelope, so the
    // upload surface should show the server's reason rather than a bare status.
    it('surfaces the server error message from a JSON failure envelope', async () => {
      const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'UPLOAD_EXPIRED', message: 'Upload session expired' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      )

      await expect(
        uploadGarmentBytes({
          uploadUrl: 'https://api.example.test/upload',
          uploadToken: 'upload-token',
          bearerToken: 'access-token',
          mimeType: 'image/png',
          body: new Blob(['fixture-body'], { type: 'image/png' }),
          fetchFn: failedFetch,
        })
      ).rejects.toThrow('Upload session expired')
    })

    it('falls back to the status message when the error body carries no message', async () => {
      const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'UPLOAD_EXPIRED' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      )

      await expect(
        uploadGarmentBytes({
          uploadUrl: 'https://api.example.test/upload',
          uploadToken: 'upload-token',
          bearerToken: 'access-token',
          mimeType: 'image/png',
          body: new Blob(['fixture-body'], { type: 'image/png' }),
          fetchFn: failedFetch,
        })
      ).rejects.toThrow('Upload failed with HTTP 409')
    })

    // A caller-supplied cancel signal and the upload timeout must both be able
    // to abort the request; composing them is what keeps a user cancel working
    // on a slow upload.
    it('aborts when the caller signal fires even though a timeout is also set', async () => {
      const controller = new AbortController()
      const abortingFetch = vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'))
            })
          })
      )

      const uploading = uploadGarmentBytes({
        uploadUrl: 'https://api.example.test/upload',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/png',
        body: new Blob(['fixture-body'], { type: 'image/png' }),
        signal: controller.signal,
        timeoutMs: 60_000,
        fetchFn: abortingFetch,
      })

      controller.abort()

      await expect(uploading).rejects.toThrow('aborted')
      expect(abortingFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    })

    it('sends the upload token and bearer token as headers', async () => {
      const successfulFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }))

      await uploadGarmentBytes({
        uploadUrl: 'https://api.example.test/upload',
        uploadToken: 'upload-token',
        bearerToken: 'access-token',
        mimeType: 'image/webp',
        body: new Blob(['fixture-body'], { type: 'image/webp' }),
        fetchFn: successfulFetch,
      })

      expect(successfulFetch.mock.calls[0]?.[1]).toMatchObject({
        method: 'PUT',
        headers: {
          Authorization: 'Bearer access-token',
          'X-Upload-Token': 'upload-token',
          'Content-Type': 'image/webp',
        },
      })
      // No timeout and no caller signal means no composed AbortSignal at all.
      expect(successfulFetch.mock.calls[0]?.[1]?.signal).toBeUndefined()
    })
  })
})

// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
describe('suggest-tags wire compatibility (mixed deployments)', () => {
  const group = { value: 'top', confidence: 0.9, isConfident: true }
  const suggestedWire = {
    data: {
      garmentId: 'garment-1',
      analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
      suggestions: {
        category: group,
        material: { value: 'cotton', confidence: 0.8, isConfident: true },
        comfortRange: { value: 'mild', confidence: 0.8, isConfident: true },
      },
    },
  }
  const manualWire = { data: { mode: 'manual', garmentId: 'garment-1' } }

  /** The client schema as it shipped before manual mode: strict, no `mode` key. */
  const legacyGroup = z
    .object({
      value: z.string(),
      confidence: z.number().min(0).max(1),
      isConfident: z.boolean(),
    })
    .strict()
  const legacyClientSchema = z
    .object({
      data: z
        .object({
          garmentId: z.string().min(1).max(128),
          analysisVersion: z.literal(GARMENT_TAGGING_ANALYSIS_VERSION),
          suggestions: z
            .object({
              category: legacyGroup,
              material: legacyGroup,
              comfortRange: legacyGroup,
            })
            .strict(),
        })
        .strict(),
    })
    .strict()

  it('keeps the suggested answer byte-compatible: it carries no mode key', () => {
    const wire = suggestGarmentTagsWireResponseSchema.parse(suggestedWire)
    expect(wire).toEqual(suggestedWire)
    expect(wire.data).not.toHaveProperty('mode')
  })

  it('lets a client from before manual mode parse a suggested answer (new API, old client)', () => {
    expect(legacyClientSchema.safeParse(suggestedWire).success).toBe(true)
    // The new mode key is what a legacy strict schema rejects, so only manual answers carry it.
    expect(
      legacyClientSchema.safeParse({ data: { ...suggestedWire.data, mode: 'manual' } })
        .success
    ).toBe(false)
  })

  it('normalizes an answer with no mode to suggested (old API, new client)', () => {
    expect(suggestGarmentTagsResponseSchema.parse(suggestedWire)).toEqual({
      data: { ...suggestedWire.data, mode: 'suggested' },
    })
  })

  it('passes a manual answer through unchanged and refuses one that carries suggestions', () => {
    expect(suggestGarmentTagsResponseSchema.parse(manualWire)).toEqual(manualWire)
    expect(suggestGarmentTagsWireResponseSchema.parse(manualWire)).toEqual(manualWire)
    expect(
      suggestGarmentTagsResponseSchema.safeParse({
        data: { ...manualWire.data, suggestions: suggestedWire.data.suggestions },
      }).success
    ).toBe(false)
  })

  it('still refuses a no-mode answer that is not a complete suggestion', () => {
    const { suggestions: _suggestions, ...withoutSuggestions } = suggestedWire.data
    void _suggestions
    expect(
      suggestGarmentTagsResponseSchema.safeParse({ data: withoutSuggestions }).success
    ).toBe(false)
    expect(
      suggestGarmentTagsResponseSchema.safeParse({
        data: { ...suggestedWire.data, analysisVersion: 'fashion-clip:untrusted' },
      }).success
    ).toBe(false)
  })
})

describe('7.5 opt-in garment colorFamily', () => {
  const ready = buildGarmentItem({
    status: 'ready',
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-04T09:30:00.000Z',
  })

  it('[P0] [7.5-UNIT-010] keeps the legacy list and tag responses strict: colorFamily is refused', () => {
    const withColor = { ...ready, colorFamily: 'blue' }
    expect(garmentItemSchema.safeParse(withColor).success).toBe(false)
    expect(garmentListResponseSchema.safeParse({ data: [withColor] }).success).toBe(false)
    expect(updateGarmentTagsResponseSchema.safeParse({ data: withColor }).success).toBe(
      false
    )
    expect(garmentListResponseSchema.safeParse({ data: [ready] }).success).toBe(true)
  })

  it('[P0] [7.5-UNIT-011] accepts every family and null, and refuses a missing or unknown colorFamily', () => {
    expect(garmentColorFamilyEnum.options).toEqual([
      'black',
      'gray',
      'white',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'brown',
    ])
    for (const colorFamily of [...garmentColorFamilyEnum.options, null]) {
      expect(
        garmentItemWithColorSchema.safeParse({ ...ready, colorFamily }).success
      ).toBe(true)
    }
    expectIssuePath(garmentItemWithColorSchema, ready, 'colorFamily')
    expectIssuePath(
      garmentItemWithColorSchema,
      { ...ready, colorFamily: 'navy' },
      'colorFamily'
    )
    expectIssuePath(
      garmentItemWithColorSchema,
      { ...ready, colorFamily: 'blue', colorHex: '#1e3cc8' },
      ''
    )
    expect(
      garmentListWithColorResponseSchema.safeParse({
        data: [{ ...ready, colorFamily: 'blue' }],
      }).success
    ).toBe(true)
    expect(
      updateGarmentTagsWithColorResponseSchema.safeParse({
        data: { ...ready, colorFamily: null },
      }).success
    ).toBe(true)
  })

  it('[P0] [7.5-UNIT-011] reads a legacy answer to an opted-in request as colorFamily null', () => {
    // A server from before the header (rollback, or a client deployed first) must not fail
    // the member's whole closet.
    expect(parseGarmentListWithColorResponse({ data: [ready] })).toEqual({
      data: [{ ...ready, colorFamily: null }],
    })
    expect(parseUpdateGarmentTagsWithColorResponse({ data: ready })).toEqual({
      data: { ...ready, colorFamily: null },
    })
    expect(
      parseGarmentListWithColorResponse({ data: [{ ...ready, colorFamily: 'blue' }] })
    ).toEqual({ data: [{ ...ready, colorFamily: 'blue' }] })
  })

  it('[P0] [7.5-UNIT-011] still refuses unknown keys and unknown families in either shape', () => {
    expect(() =>
      parseGarmentListWithColorResponse({ data: [{ ...ready, colorFamily: 'navy' }] })
    ).toThrow(/colorFamily/)
    expect(() =>
      parseUpdateGarmentTagsWithColorResponse({ data: { ...ready, colorHex: '#1e3cc8' } })
    ).toThrow()
    expect(() =>
      parseGarmentListWithColorResponse({
        data: [{ ...ready, retentionStatus: 'archived' }],
      })
    ).toThrow(/retentionStatus/)
  })

  it('[P1] [7.5-UNIT-012] [7.19-HTTP] documents both metadata headers on the list and tag update', () => {
    const spec = generateHttpOpenApiDocument()
    expect(spec.info.version).toBe('1.12.0')
    type Operation = {
      parameters?: {
        in?: string
        name?: string
        required?: boolean
        schema?: { enum?: string[] }
      }[]
    }
    const operations = [
      spec.paths?.['/api/v1/wardrobe/garments']?.get,
      spec.paths?.['/api/v1/wardrobe/garments/{garmentId}/tags']?.patch,
    ] as (Operation | undefined)[]
    for (const operation of operations) {
      for (const name of [
        WARDROBE_GARMENT_COLOR_HEADER,
        WARDROBE_GARMENT_SUBTYPE_HEADER,
      ]) {
        const header = operation?.parameters?.find(
          (parameter) => parameter.in === 'header' && parameter.name === name
        )
        expect(header).toBeDefined()
        expect(header?.required ?? false).toBe(false)
        expect(header?.schema?.enum).toEqual(['1'])
      }
    }
  })

  it('[P2] [7.5-UNIT-013] names the opt-in header x-couture-garment-color', () => {
    expect(WARDROBE_GARMENT_COLOR_HEADER).toBe('x-couture-garment-color')
    expect(WARDROBE_GARMENT_SUBTYPE_HEADER).toBe('x-couture-garment-subtype')
  })
})

describe('[7.19-HTTP] client subtype contract', () => {
  const ready = buildGarmentItem({
    status: 'ready',
    category: 'top',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-04T09:30:00.000Z',
  })

  it('reads subtype metadata on list and PATCH while accepting legacy omission', () => {
    expect(
      garmentListClientResponseSchema.parse({ data: [ready] }).data[0]?.subtype
    ).toBeUndefined()
    expect(
      updateGarmentTagsClientResponseSchema.parse({ data: ready }).data.subtype
    ).toBeUndefined()
    const typed = { ...ready, subtype: 'tank' }
    expect(
      garmentListClientResponseSchema.parse({ data: [typed] }).data[0]?.subtype
    ).toBe('tank')
    expect(
      updateGarmentTagsClientResponseSchema.parse({ data: typed }).data.subtype
    ).toBe('tank')

    const malformed = { ...ready, subtype: 'unknown-subtype' }
    expect(garmentListClientResponseSchema.safeParse({ data: [malformed] }).success).toBe(
      false
    )
    expect(
      updateGarmentTagsClientResponseSchema.safeParse({ data: malformed }).success
    ).toBe(false)
  })

  it('accepts the prior subtype while validating the resulting category and subtype pair', () => {
    const tags = {
      category: 'shoes',
      comfortRange: 'mild',
      subtype: 'ankle-boots',
      expected: {
        category: 'top',
        subtype: 'tank',
        material: null,
        comfortRange: 'mild',
      },
    }
    expect(updateGarmentTagsInputSchema.parse(tags)).toEqual(tags)
    expect(
      updateGarmentTagsInputSchema.safeParse({ ...tags, subtype: 'tank' }).success
    ).toBe(false)
    expect(
      garmentExpectedTagsSchema.safeParse({
        ...tags.expected,
        subtype: 'unknown-subtype',
      }).success
    ).toBe(false)
  })
})

describe('7.5 Codex P2.1 and P2.4: expected tags and the published wire shape', () => {
  const ready = buildGarmentItem({
    status: 'ready',
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-04T09:30:00.000Z',
  })

  it('[P0] [7.5-UNIT-017] accepts optional expected tags and refuses unknown keys in them', () => {
    const tags = { category: 'top', material: null, comfortRange: 'mild' }
    expect(updateGarmentTagsInputSchema.safeParse(tags).success).toBe(true)
    expect(
      updateGarmentTagsInputSchema.safeParse({
        ...tags,
        expected: { category: 'top', material: null, comfortRange: 'mild' },
      }).success
    ).toBe(true)
    expect(garmentExpectedTagsSchema.safeParse({}).success).toBe(true)
    expect(garmentExpectedTagsSchema.safeParse({ colorFamily: 'blue' }).success).toBe(
      false
    )
    expect(
      updateGarmentTagsInputSchema.safeParse({ ...tags, expected: { category: 'cape' } })
        .success
    ).toBe(false)
    expect(GARMENT_TAGS_CHANGED_MESSAGE).toBe('GARMENT_TAGS_CHANGED')
  })

  it('[P1] [7.5-UNIT-018] publishes one wire shape whose colorFamily is optional', () => {
    for (const garment of [
      ready,
      { ...ready, colorFamily: 'blue' },
      { ...ready, colorFamily: null },
    ]) {
      expect(garmentListWireResponseSchema.safeParse({ data: [garment] }).success).toBe(
        true
      )
      expect(
        updateGarmentTagsWireResponseSchema.safeParse({ data: garment }).success
      ).toBe(true)
    }
    expect(garmentListWireResponseSchema.safeParse({ data: [] }).success).toBe(true)
    expect(
      updateGarmentTagsWireResponseSchema.safeParse({
        data: { ...ready, colorFamily: 'navy' },
      }).success
    ).toBe(false)

    const spec = generateHttpOpenApiDocument()
    const schemas = spec.components?.schemas as Record<string, unknown>
    expect(schemas).not.toHaveProperty('GarmentListWithColorResponse')
    expect(schemas).not.toHaveProperty('UpdateGarmentTagsWithColorResponse')
  })

  it('[P1] [7.5-UNIT-018] generated SDK types read a legacy and an opted-in garment', () => {
    // Compile-time proof: these only type-check while the generated colorFamily stays optional
    // on both the list item and the tag update answer, and the update input takes expected.
    type ColorIsOptional<T> =
      object extends Pick<T, Extract<keyof T, 'colorFamily'>> ? true : false
    const listItem: ColorIsOptional<GarmentListResponseDataInner> = true
    const updated: ColorIsOptional<GeneratedUpdateGarmentTagsResponse['data']> = true
    const list: ColorIsOptional<GarmentListResponse['data'][number]> = true
    const input: GeneratedUpdateGarmentTagsInput = {
      category: 'top',
      comfortRange: 'mild',
      expected: { category: 'top', material: null, comfortRange: 'mild' },
    }
    expect([listItem, updated, list]).toEqual([true, true, true])
    expect(input.expected?.material).toBeNull()
  })
})

describe('7.6 garment usage read and delete contract', () => {
  const usage = { garmentId: 'garment-1', savedLookCount: 2, capsuleCount: 1 }

  it('[P0] [7.6-UNIT-010] accepts the usage shape and refuses extra, missing, negative and fractional counts', () => {
    expect(garmentUsageResponseSchema.parse(usage)).toEqual(usage)
    expect(
      garmentUsageResponseSchema.safeParse({
        ...usage,
        savedLookCount: 0,
        capsuleCount: 0,
      }).success
    ).toBe(true)
    // Strict: a server that adds a key breaks installed clients loudly in tests first.
    expect(garmentUsageResponseSchema.safeParse({ ...usage, total: 3 }).success).toBe(
      false
    )
    for (const key of ['garmentId', 'savedLookCount', 'capsuleCount'] as const) {
      const missing: Record<string, unknown> = { ...usage }
      delete missing[key]
      expect(garmentUsageResponseSchema.safeParse(missing).success).toBe(false)
    }
    expect(
      garmentUsageResponseSchema.safeParse({ ...usage, capsuleCount: -1 }).success
    ).toBe(false)
    expect(
      garmentUsageResponseSchema.safeParse({ ...usage, savedLookCount: 1.5 }).success
    ).toBe(false)
    expect(
      garmentUsageResponseSchema.safeParse({ ...usage, garmentId: '' }).success
    ).toBe(false)
  })

  it('[P1] [7.6-UNIT-011] documents DELETE garment as 204 without a body and the usage read as 200 or 404', () => {
    const spec = generateHttpOpenApiDocument()
    type Operation = {
      security?: unknown[]
      parameters?: { in?: string; name?: string; required?: boolean }[]
      responses?: Record<string, { content?: Record<string, unknown> }>
    }
    const remove = spec.paths?.['/api/v1/wardrobe/garments/{garmentId}']?.delete as
      | Operation
      | undefined
    const read = spec.paths?.['/api/v1/wardrobe/garments/{garmentId}/usage']?.get as
      | Operation
      | undefined

    for (const operation of [remove, read]) {
      expect(operation).toBeDefined()
      expect(operation?.security).toEqual([{ bearerAuth: [] }])
      expect(
        operation?.parameters?.find(
          (parameter) => parameter.in === 'path' && parameter.name === 'garmentId'
        )?.required
      ).toBe(true)
    }
    expect(remove?.responses?.['204']).toBeDefined()
    expect(remove?.responses?.['204']?.content).toBeUndefined()
    expect(read?.responses?.['200']?.content?.['application/json']).toEqual({
      schema: { $ref: '#/components/schemas/GarmentUsageResponse' },
    })
    expect(read?.responses?.['404']).toBeDefined()
  })
})
