import { expect, test } from 'vitest'
import {
  createGarmentItemInputSchema,
  createGarmentItemResponseSchema,
  createGarmentUploadUrlInputSchema,
  createGarmentUploadUrlResponseSchema,
  garmentItemSchema,
  generateHttpOpenApiDocument,
} from '../src/contracts/http'

const validSha256 = 'b6d81b360a5672d80c27430f39153e2c3f359dd3a214b61213cfa1447d2d73e5'

const sampleGarmentItem = {
  id: 'clx123456789',
  status: 'processing',
  category: null,
  fileSizeBytes: 2048576,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-04T09:25:00.000Z',
  committedAt: '2026-08-04T09:26:22.000Z',
  imageAccess: {
    url: 'https://example.supabase.co/storage/v1/object/sign/wardrobe-images/wardrobe/user_123/clx123456789.png',
    expiresAt: '2026-08-04T09:41:22.000Z',
  },
}

test('validates wardrobe upload-url and garment commit schemas', () => {
  const uploadUrlInput = createGarmentUploadUrlInputSchema.parse({
    fileSizeBytes: 2048576,
    mimeType: 'image/png',
    sha256: validSha256,
    widthPx: 1024,
    heightPx: 1024,
  })
  expect(uploadUrlInput).toEqual({
    fileSizeBytes: 2048576,
    mimeType: 'image/png',
    sha256: validSha256,
    widthPx: 1024,
    heightPx: 1024,
  })

  const uploadSession = createGarmentUploadUrlResponseSchema.parse({
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
  })
  expect(uploadSession.data.garmentId).toBe('clx123456789')

  const garmentInput = createGarmentItemInputSchema.parse({
    garmentId: 'clx123456789',
    uploadSessionId: 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
    hasCropping: true,
    hasBgCleanup: true,
  })
  expect(garmentInput.garmentId).toBe('clx123456789')

  const garmentItem = garmentItemSchema.parse(sampleGarmentItem)
  expect(garmentItem.id).toBe('clx123456789')
  expect(garmentItem.status).toBe('processing')

  const commitResponse = createGarmentItemResponseSchema.parse({
    data: sampleGarmentItem,
  })
  expect(commitResponse.data.id).toBe('clx123456789')
})

test('rejects client-controlled ownership fields and invalid upload inputs', () => {
  // Reject extra/unknown fields (.strict())
  expect(() =>
    createGarmentUploadUrlInputSchema.parse({
      fileSizeBytes: 2048576,
      mimeType: 'image/png',
      sha256: validSha256,
      widthPx: 1024,
      heightPx: 1024,
      userId: 'client-injected-user-id',
    })
  ).toThrow()

  // Reject invalid sha256
  expect(() =>
    createGarmentUploadUrlInputSchema.parse({
      fileSizeBytes: 2048576,
      mimeType: 'image/png',
      sha256: 'invalid-sha-256',
      widthPx: 1024,
      heightPx: 1024,
    })
  ).toThrow()

  // Reject oversized file (>10MB)
  expect(() =>
    createGarmentUploadUrlInputSchema.parse({
      fileSizeBytes: 20_000_000,
      mimeType: 'image/png',
      sha256: validSha256,
      widthPx: 1024,
      heightPx: 1024,
    })
  ).toThrow()

  // Reject unsupported mime type
  expect(() =>
    createGarmentUploadUrlInputSchema.parse({
      fileSizeBytes: 2048576,
      mimeType: 'image/gif',
      sha256: validSha256,
      widthPx: 1024,
      heightPx: 1024,
    })
  ).toThrow()

  // Reject client-injected userId in commit input
  expect(() =>
    createGarmentItemInputSchema.parse({
      garmentId: 'clx123456789',
      uploadSessionId: 'b0e9bf1d-2a18-4d59-bef8-fb559cbb3272',
      hasCropping: true,
      hasBgCleanup: true,
      userId: 'hacker-user',
    })
  ).toThrow()
})

test('registers authenticated wardrobe routes in OpenAPI', () => {
  const spec = generateHttpOpenApiDocument()

  const uploadUrlPath = spec.paths?.['/api/v1/wardrobe/upload-url']
  const uploadRelayPath = spec.paths?.['/api/v1/wardrobe/uploads/{uploadSessionId}']
  const garmentsPath = spec.paths?.['/api/v1/wardrobe/garments']

  expect(uploadUrlPath?.post?.security).toEqual([{ bearerAuth: [] }])
  expect(uploadUrlPath?.post?.responses?.['201']).toBeDefined()
  expect(uploadRelayPath?.put?.security).toEqual([{ bearerAuth: [] }])
  expect(uploadRelayPath?.put?.responses?.['204']).toBeDefined()
  expect(garmentsPath?.post?.security).toEqual([{ bearerAuth: [] }])
  expect(garmentsPath?.post?.responses?.['201']).toBeDefined()
})
