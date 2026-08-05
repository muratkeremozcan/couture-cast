import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
// Story 4.1 Task 4 step 1 owner: define Zod request and response envelope schemas and uploadGarmentBytes helper
// Story 4.2 Task 4 step 1 owner: define suggestGarmentTags and updateGarmentTags HTTP contracts and Zod schemas in packages/api-client/src/contracts/http/wardrobe.ts
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

export const garmentCategoryEnum = z.enum([
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory',
])

export const garmentMaterialEnum = z.enum([
  'cotton',
  'wool',
  'linen',
  'leather',
  'denim',
  'fleece',
  'synthetic',
  'down',
  'silk',
])

export const garmentComfortRangeEnum = z.enum(['cold', 'cool', 'mild', 'warm', 'hot'])

export const GARMENT_TAGGING_ANALYSIS_VERSION =
  'fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1' as const

export const garmentTagSuggestionSnapshotSchema = z
  .object({
    analysisVersion: z.literal(GARMENT_TAGGING_ANALYSIS_VERSION),
    category: z
      .object({
        value: garmentCategoryEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
    material: z
      .object({
        value: garmentMaterialEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
    comfortRange: z
      .object({
        value: garmentComfortRangeEnum,
        confidence: z.number().min(0).max(1),
        isConfident: z.boolean(),
      })
      .strict(),
  })
  .strict()

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
    status: z
      .enum([
        'pending_upload',
        'bytes_uploaded',
        'processing',
        'awaiting_tags',
        'ready',
        'failed',
      ])
      .openapi({ 'x-optic-exemptions': 'request and response property enums' }),
    category: garmentCategoryEnum.nullable(),
    material: garmentMaterialEnum.nullable(),
    comfortRange: garmentComfortRangeEnum.nullable(),
    tagsConfirmedAt: isoTimestampSchema.nullable(),
    fileSizeBytes: z.number().int().min(1).max(10_485_760).nullable(),
    mimeType: z
      .enum(['image/jpeg', 'image/png', 'image/webp'])
      .nullable()
      .openapi({ 'x-optic-exemptions': 'request and response property enums' }),
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

export const garmentIdPathParamsSchema = z
  .object({
    garmentId: nonEmptyStringSchema.max(128).describe('Unique garment item ID.'),
  })
  .strict()

export const suggestGarmentTagsDataSchema = z
  .object({
    garmentId: nonEmptyStringSchema.max(128),
    analysisVersion: z.literal(GARMENT_TAGGING_ANALYSIS_VERSION),
    suggestions: z
      .object({
        category: z
          .object({
            value: garmentCategoryEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
        material: z
          .object({
            value: garmentMaterialEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
        comfortRange: z
          .object({
            value: garmentComfortRangeEnum,
            confidence: z.number().min(0).max(1),
            isConfident: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

export const suggestGarmentTagsResponseSchema = z
  .object({
    data: suggestGarmentTagsDataSchema,
  })
  .strict()

export const updateGarmentTagsInputSchema = z
  .object({
    category: garmentCategoryEnum,
    material: garmentMaterialEnum.nullable().optional(),
    comfortRange: garmentComfortRangeEnum,
  })
  .strict()

export const updateGarmentTagsResponseSchema = z
  .object({
    data: garmentItemSchema,
  })
  .strict()

const garmentIdBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string().startsWith('Invalid garment id'),
    error: z.literal('Bad Request'),
  })
  .strict()

const garmentTagsBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.union([
      z.string().startsWith('Invalid garment id'),
      z.string().startsWith('Invalid garment tags'),
    ]),
    error: z.literal('Bad Request'),
  })
  .strict()

const garmentTaggingUnauthorizedErrorSchema = z
  .object({
    statusCode: z.literal(401),
    message: z.enum(['Missing or invalid bearer token', 'Invalid access token']),
    error: z.literal('Unauthorized'),
  })
  .strict()

const garmentTaggingForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum([
      'Guardian consent required before continuing',
      'GUARDIAN_CONSENT_REQUIRED',
    ]),
    error: z.literal('Forbidden'),
  })
  .strict()

const garmentTaggingNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.literal('GARMENT_NOT_FOUND'),
    error: z.literal('Not Found'),
  })
  .strict()

const garmentSuggestionConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum(['GARMENT_ANALYSIS_PENDING', 'GARMENT_NOT_TAGGABLE']),
    error: z.literal('Conflict'),
  })
  .strict()

const garmentUpdateConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum([
      'GARMENT_ANALYSIS_PENDING',
      'GARMENT_NOT_TAGGABLE',
      'CONCURRENT_TAG_UPDATE',
    ]),
    error: z.literal('Conflict'),
  })
  .strict()

const garmentTaggingUnavailableErrorSchema = z
  .object({
    statusCode: z.literal(503),
    message: z.literal('TAGGING_INFERENCE_UNAVAILABLE'),
    error: z.literal('Service Unavailable'),
  })
  .strict()

export type GarmentCategory = z.infer<typeof garmentCategoryEnum>
export type GarmentMaterial = z.infer<typeof garmentMaterialEnum>
export type GarmentComfortRange = z.infer<typeof garmentComfortRangeEnum>
export type GarmentTagSuggestionSnapshot = z.infer<
  typeof garmentTagSuggestionSnapshotSchema
>
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
export type SuggestGarmentTagsData = z.infer<typeof suggestGarmentTagsDataSchema>
export type SuggestGarmentTagsResponse = z.infer<typeof suggestGarmentTagsResponseSchema>
export type UpdateGarmentTagsInput = z.infer<typeof updateGarmentTagsInputSchema>
export type UpdateGarmentTagsResponse = z.infer<typeof updateGarmentTagsResponseSchema>

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
  const registeredSuggestGarmentTagsResponse = registry.register(
    'SuggestGarmentTagsResponse',
    suggestGarmentTagsResponseSchema
  )
  const registeredUpdateGarmentTagsInput = registry.register(
    'UpdateGarmentTagsInput',
    updateGarmentTagsInputSchema
  )
  const registeredUpdateGarmentTagsResponse = registry.register(
    'UpdateGarmentTagsResponse',
    updateGarmentTagsResponseSchema
  )
  const registeredGarmentIdBadRequestError = registry.register(
    'GarmentIdBadRequestError',
    garmentIdBadRequestErrorSchema
  )
  const registeredGarmentTagsBadRequestError = registry.register(
    'GarmentTagsBadRequestError',
    garmentTagsBadRequestErrorSchema
  )
  const registeredGarmentTaggingUnauthorizedError = registry.register(
    'GarmentTaggingUnauthorizedError',
    garmentTaggingUnauthorizedErrorSchema
  )
  const registeredGarmentTaggingForbiddenError = registry.register(
    'GarmentTaggingForbiddenError',
    garmentTaggingForbiddenErrorSchema
  )
  const registeredGarmentTaggingNotFoundError = registry.register(
    'GarmentTaggingNotFoundError',
    garmentTaggingNotFoundErrorSchema
  )
  const registeredGarmentSuggestionConflictError = registry.register(
    'GarmentSuggestionConflictError',
    garmentSuggestionConflictErrorSchema
  )
  const registeredGarmentUpdateConflictError = registry.register(
    'GarmentUpdateConflictError',
    garmentUpdateConflictErrorSchema
  )
  const registeredGarmentTaggingUnavailableError = registry.register(
    'GarmentTaggingUnavailableError',
    garmentTaggingUnavailableErrorSchema
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
    path: '/api/v1/wardrobe/garments/{garmentId}/suggest-tags',
    tags: ['wardrobe'],
    summary:
      'Retrieve algorithmically inferred tag suggestions for an awaiting-tags garment',
    security: [{ bearerAuth: [] }],
    request: {
      params: garmentIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Tag suggestions retrieved successfully.',
        content: {
          'application/json': {
            schema: registeredSuggestGarmentTagsResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment ID.',
        content: {
          'application/json': {
            schema: registeredGarmentIdBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnauthorizedError,
          },
        },
      },
      403: {
        description: 'Guardian consent required or access forbidden.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingForbiddenError,
          },
        },
      },
      404: {
        description: 'Garment not found or owned by another user.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingNotFoundError,
          },
        },
      },
      409: {
        description: 'Garment analysis pending or not taggable.',
        content: {
          'application/json': { schema: registeredGarmentSuggestionConflictError },
        },
      },
      503: {
        description: 'Tagging inference unavailable.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnavailableError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/garments/{garmentId}/tags',
    tags: ['wardrobe'],
    summary: 'Confirm or edit garment category, material, and comfort tags',
    security: [{ bearerAuth: [] }],
    request: {
      params: garmentIdPathParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateGarmentTagsInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Garment tags updated successfully.',
        content: {
          'application/json': {
            schema: registeredUpdateGarmentTagsResponse,
          },
        },
      },
      400: {
        description: 'Invalid garment tags input.',
        content: {
          'application/json': {
            schema: registeredGarmentTagsBadRequestError,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingUnauthorizedError,
          },
        },
      },
      403: {
        description: 'Guardian consent required or access forbidden.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingForbiddenError,
          },
        },
      },
      404: {
        description: 'Garment not found or owned by another user.',
        content: {
          'application/json': {
            schema: registeredGarmentTaggingNotFoundError,
          },
        },
      },
      409: {
        description: 'Garment analysis pending or not taggable.',
        content: {
          'application/json': { schema: registeredGarmentUpdateConflictError },
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
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
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
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
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
        content: {
          'application/json': { schema: commonSchemas.conflictHttpErrorSchema },
        },
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
