import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
// Story 4.1 Task 4 step 1 owner: define Zod request and response envelope schemas and uploadGarmentBytes helper
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

export const createGarmentUploadUrlInputSchema = z
  .object({
    fileSizeBytes: z.number().int().min(1).max(10_485_760),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/, {
        message: 'sha256 must be a 64-character lowercase hex string.',
      }),
    widthPx: z.number().int().min(256).max(4096),
    heightPx: z.number().int().min(256).max(4096),
  })
  .strict()

export const garmentUploadSessionSchema = z
  .object({
    garmentId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    uploadUrl: z.string().url(),
    uploadToken: nonEmptyStringSchema,
    requiredHeaders: z
      .object({
        'content-type': z.string(),
      })
      .strict(),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const createGarmentUploadUrlResponseSchema = z
  .object({
    data: garmentUploadSessionSchema,
  })
  .strict()

export const createGarmentItemInputSchema = z
  .object({
    garmentId: nonEmptyStringSchema,
    uploadSessionId: nonEmptyStringSchema,
    hasCropping: z.boolean(),
    hasBgCleanup: z.boolean(),
  })
  .strict()

export const garmentImageAccessSchema = z
  .object({
    url: z.string().url(),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const garmentItemSchema = z
  .object({
    id: nonEmptyStringSchema,
    status: z.enum(['pending_upload', 'bytes_uploaded', 'processing', 'ready', 'failed']),
    category: z.string().nullable(),
    fileSizeBytes: z.number().int().min(1).max(10_485_760).nullable(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable(),
    retentionStatus: z.enum(['active', 'deletion_pending', 'legal_hold']),
    createdAt: isoTimestampSchema,
    committedAt: isoTimestampSchema.nullable(),
    imageAccess: garmentImageAccessSchema.nullable(),
  })
  .strict()

export const createGarmentItemResponseSchema = z
  .object({
    data: garmentItemSchema,
  })
  .strict()

export const garmentListResponseSchema = z
  .object({
    data: z.array(garmentItemSchema),
  })
  .strict()

export const uploadSessionPathParamsSchema = z.object({
  uploadSessionId: nonEmptyStringSchema.describe('Opaque upload session ID.'),
})

export type CreateGarmentUploadUrlInput = z.infer<
  typeof createGarmentUploadUrlInputSchema
>
export type CreateGarmentUploadUrlResponse = z.infer<
  typeof createGarmentUploadUrlResponseSchema
>
export type CreateGarmentItemInput = z.infer<typeof createGarmentItemInputSchema>
export type GarmentItemResponse = z.infer<typeof createGarmentItemResponseSchema>
export type GarmentItemContract = z.infer<typeof garmentItemSchema>
export type GarmentListResponse = z.infer<typeof garmentListResponseSchema>

export function registerWardrobeContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredCreateUploadUrlInput = registry.register(
    'CreateGarmentUploadUrlInput',
    createGarmentUploadUrlInputSchema
  )
  const registeredCreateUploadUrlResponse = registry.register(
    'CreateGarmentUploadUrlResponse',
    createGarmentUploadUrlResponseSchema
  )
  const registeredCreateGarmentInput = registry.register(
    'CreateGarmentItemInput',
    createGarmentItemInputSchema
  )
  const registeredCreateGarmentResponse = registry.register(
    'CreateGarmentItemResponse',
    createGarmentItemResponseSchema
  )
  const registeredGarmentListResponse = registry.register(
    'GarmentListResponse',
    garmentListResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/garments',
    tags: ['wardrobe'],
    summary: 'List persisted garments for the authenticated wardrobe',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Persisted wardrobe garments.',
        content: {
          'application/json': {
            schema: registeredGarmentListResponse,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/upload-url',
    tags: ['wardrobe'],
    summary: 'Allocate a private garment upload session and signed upload URL',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Upload session created successfully.',
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlResponse,
          },
        },
      },
      200: {
        description: 'Idempotent upload session replay.',
        content: {
          'application/json': {
            schema: registeredCreateUploadUrlResponse,
          },
        },
      },
      400: {
        description: 'Invalid upload declaration.',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required or upload forbidden.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      409: {
        description: 'Idempotency key reused or upload session expired.',
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/wardrobe/uploads/{uploadSessionId}',
    tags: ['wardrobe'],
    summary: 'Upload binary image bytes for a pending upload session',
    security: [{ bearerAuth: [] }],
    request: {
      params: uploadSessionPathParamsSchema,
      headers: z.object({
        'x-upload-token': z.string().min(1),
        'content-type': z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
      body: {
        required: true,
        content: {
          'image/jpeg': {
            schema: z.string().openapi({ format: 'binary' }),
          },
          'image/png': {
            schema: z.string().openapi({ format: 'binary' }),
          },
          'image/webp': {
            schema: z.string().openapi({ format: 'binary' }),
          },
        },
      },
    },
    responses: {
      204: {
        description: 'Bytes uploaded and verified successfully.',
      },
      400: {
        description: 'Invalid upload body.',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required or token invalid.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Upload session not found.',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
      409: {
        description: 'Upload session expired or token already consumed.',
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/garments',
    tags: ['wardrobe'],
    summary: 'Commit uploaded garment bytes and initiate background processing',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z.string().uuid(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateGarmentInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Garment committed and moved to processing.',
        content: {
          'application/json': {
            schema: registeredCreateGarmentResponse,
          },
        },
      },
      200: {
        description: 'Idempotent garment commit replay.',
        content: {
          'application/json': {
            schema: registeredCreateGarmentResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment commit payload.',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent required.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Upload session not found.',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
      409: {
        description: 'Idempotency key reused, session expired, or upload claimed.',
      },
    },
  })
}

export interface UploadGarmentBytesOptions {
  uploadUrl: string
  uploadToken: string
  bearerToken: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  body: ArrayBuffer | Blob
  onProgress?: (bytesUploaded: number, totalBytes: number) => void
  signal?: AbortSignal
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export async function uploadGarmentBytes({
  uploadUrl,
  uploadToken,
  bearerToken,
  mimeType,
  body,
  onProgress,
  signal,
  timeoutMs,
  fetchFn = globalThis.fetch,
}: UploadGarmentBytesOptions): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    'X-Upload-Token': uploadToken,
    'Content-Type': mimeType,
  }

  const requestSignal =
    timeoutMs === undefined
      ? signal
      : AbortSignal.any(
          signal
            ? [signal, AbortSignal.timeout(timeoutMs)]
            : [AbortSignal.timeout(timeoutMs)]
        )
  const totalBytes = 'byteLength' in body ? body.byteLength : body.size

  try {
    const response = await fetchFn(uploadUrl, {
      method: 'PUT',
      headers,
      body,
      signal: requestSignal,
    })

    if (!response.ok) {
      let errorMessage = `Upload failed with HTTP ${response.status}`
      try {
        const errorJson = (await response.json()) as { error?: { message?: string } }
        if (errorJson?.error?.message) {
          errorMessage = errorJson.error.message
        }
      } catch {
        // JSON parse fallback
      }
      throw new Error(errorMessage)
    }
  } finally {
    // Fetch exposes completion only. Use XMLHttpRequest.upload for incremental web progress.
    onProgress?.(totalBytes, totalBytes)
  }
}
