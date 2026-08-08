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

export const capsuleOccasionEnum = z.enum([
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
])

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

export const ownerUserIdPathParamsSchema = z
  .object({
    ownerUserId: nonEmptyStringSchema.max(128).describe('Unique owner user ID.'),
  })
  .strict()

export const capsuleIdPathParamsSchema = z
  .object({
    ownerUserId: nonEmptyStringSchema.max(128).describe('Unique owner user ID.'),
    capsuleId: nonEmptyStringSchema.max(128).describe('Unique outfit capsule ID.'),
  })
  .strict()

/**
 * Capsule text limits are expressed in extended grapheme clusters, which is what
 * a user perceives as a character. Counting UTF-16 code units would reject a
 * five-emoji name and accept a 120-character combining-mark name.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function countGraphemes(value: string): number {
  return [...graphemeSegmenter.segment(value)].length
}

/** PostgreSQL `text` cannot store a NUL byte, so it is invalid input, not a 500. */
const hasNullByte = (value: string): boolean => value.includes('\u0000')

/**
 * Trims Unicode whitespace and applies NFC before validating, so that a
 * whitespace-only name fails `min(1)` instead of being accepted and persisted as
 * an empty string that later breaks response parsing.
 */
function graphemeBoundedText(maxGraphemes: number, minGraphemes = 0) {
  return z
    .string()
    .transform((value) => value.trim().normalize('NFC'))
    .superRefine((value, ctx) => {
      if (hasNullByte(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain a null byte',
        })
        return
      }
      const length = countGraphemes(value)
      if (length < minGraphemes) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: minGraphemes,
          type: 'string',
          inclusive: true,
          message: `must be at least ${minGraphemes} characters after normalization`,
        })
      }
      if (length > maxGraphemes) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: maxGraphemes,
          type: 'string',
          inclusive: true,
          message: `must be at most ${maxGraphemes} characters after normalization`,
        })
      }
    })
}

const capsuleNameSchema = graphemeBoundedText(60, 1)

/** An empty normalized description is `null`, never `''`. */
const capsuleDescriptionSchema = graphemeBoundedText(280)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()

const capsuleGarmentIdsSchema = z
  .array(nonEmptyStringSchema.max(128))
  .min(2)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'garmentIds must not contain duplicates',
  })

export const createOutfitCapsuleInputSchema = z
  .object({
    name: capsuleNameSchema,
    description: capsuleDescriptionSchema.optional(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8),
    garmentIds: capsuleGarmentIdsSchema,
    isFavorite: z.boolean().optional().default(false),
  })
  .strict()

export const capsuleGarmentSchema = z
  .object({
    id: nonEmptyStringSchema,
    category: garmentCategoryEnum.nullable(),
    material: garmentMaterialEnum.nullable(),
    comfortRange: garmentComfortRangeEnum.nullable(),
    imageAccess: garmentImageAccessSchema.nullable(),
    availabilityStatus: z.enum(['ready', 'needs_repair']),
    garmentOrder: z.number().int().min(0).max(9),
  })
  .strict()

export const outfitCapsuleSchema = z
  .object({
    id: nonEmptyStringSchema,
    ownerUserId: nonEmptyStringSchema,
    name: z.string().min(1).max(60),
    description: z.string().max(280).nullable(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8),
    isFavorite: z.boolean(),
    revision: z.number().int().min(0),
    availabilityStatus: z.enum(['ready', 'needs_repair']),
    unavailableGarmentCount: z.number().int().min(0),
    garments: z.array(capsuleGarmentSchema),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const outfitCapsuleResponseSchema = z
  .object({
    data: outfitCapsuleSchema,
  })
  .strict()

export const listOutfitCapsulesQuerySchema = z
  .object({
    q: graphemeBoundedText(120)
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional(),
    occasion: capsuleOccasionEnum.optional(),
    isFavorite: z.preprocess((val) => {
      if (typeof val === 'string') {
        if (val === 'true') return true
        if (val === 'false') return false
      }
      return val
    }, z.boolean().optional()),
    garmentId: nonEmptyStringSchema.max(128).optional(),
    comfortRange: garmentComfortRangeEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict()

export const outfitCapsuleListResponseSchema = z
  .object({
    data: z.array(outfitCapsuleSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(10000),
  })
  .strict()

export const updateOutfitCapsuleInputSchema = z
  .object({
    name: capsuleNameSchema.optional(),
    description: capsuleDescriptionSchema.optional(),
    occasions: z.array(capsuleOccasionEnum).min(1).max(8).optional(),
    garmentIds: capsuleGarmentIdsSchema.optional(),
    isFavorite: z.boolean().optional(),
  })
  .strict()

export const favoriteOutfitCapsuleInputSchema = z
  .object({
    isFavorite: z.boolean(),
  })
  .strict()

const capsuleBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string(),
    error: z.literal('Bad Request'),
  })
  .strict()

const capsuleForbiddenErrorSchema = z
  .object({
    statusCode: z.literal(403),
    message: z.enum(['GUARDIAN_READ_ONLY', 'GUARDIAN_CONSENT_REQUIRED']),
    error: z.literal('Forbidden'),
  })
  .strict()

const capsuleNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.literal('NOT_FOUND'),
    error: z.literal('Not Found'),
  })
  .strict()

const capsuleConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum(['GARMENT_NOT_CAPSULE_ELIGIBLE', 'IDEMPOTENCY_KEY_REUSED']),
    error: z.literal('Conflict'),
  })
  .strict()

const capsulePreconditionFailedErrorSchema = z
  .object({
    statusCode: z.literal(412),
    message: z.literal('CAPSULE_REVISION_MISMATCH'),
    error: z.literal('Precondition Failed'),
  })
  .strict()

const capsulePreconditionRequiredErrorSchema = z
  .object({
    statusCode: z.literal(428),
    message: z.literal('PRECONDITION_REQUIRED'),
    error: z.literal('Precondition Required'),
  })
  .strict()

export type GarmentCategory = z.infer<typeof garmentCategoryEnum>
export type GarmentMaterial = z.infer<typeof garmentMaterialEnum>
export type GarmentComfortRange = z.infer<typeof garmentComfortRangeEnum>
export type CapsuleOccasion = z.infer<typeof capsuleOccasionEnum>
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
export type CreateOutfitCapsuleInput = z.infer<typeof createOutfitCapsuleInputSchema>
export type CapsuleGarmentContract = z.infer<typeof capsuleGarmentSchema>
export type OutfitCapsuleContract = z.infer<typeof outfitCapsuleSchema>
export type OutfitCapsuleResponse = z.infer<typeof outfitCapsuleResponseSchema>
export type ListOutfitCapsulesQuery = z.infer<typeof listOutfitCapsulesQuerySchema>
export type OutfitCapsuleListResponse = z.infer<typeof outfitCapsuleListResponseSchema>
export type UpdateOutfitCapsuleInput = z.infer<typeof updateOutfitCapsuleInputSchema>
export type FavoriteOutfitCapsuleInput = z.infer<typeof favoriteOutfitCapsuleInputSchema>

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

  const registeredCreateOutfitCapsuleInput = registry.register(
    'CreateOutfitCapsuleInput',
    createOutfitCapsuleInputSchema
  )
  const registeredOutfitCapsuleResponse = registry.register(
    'OutfitCapsuleResponse',
    outfitCapsuleResponseSchema
  )
  const registeredOutfitCapsuleListResponse = registry.register(
    'OutfitCapsuleListResponse',
    outfitCapsuleListResponseSchema
  )
  const registeredUpdateOutfitCapsuleInput = registry.register(
    'UpdateOutfitCapsuleInput',
    updateOutfitCapsuleInputSchema
  )
  const registeredFavoriteOutfitCapsuleInput = registry.register(
    'FavoriteOutfitCapsuleInput',
    favoriteOutfitCapsuleInputSchema
  )
  const registeredCapsuleBadRequestError = registry.register(
    'CapsuleBadRequestError',
    capsuleBadRequestErrorSchema
  )
  const registeredCapsuleForbiddenError = registry.register(
    'CapsuleForbiddenError',
    capsuleForbiddenErrorSchema
  )
  const registeredCapsuleNotFoundError = registry.register(
    'CapsuleNotFoundError',
    capsuleNotFoundErrorSchema
  )
  const registeredCapsuleConflictError = registry.register(
    'CapsuleConflictError',
    capsuleConflictErrorSchema
  )
  const registeredCapsulePreconditionFailedError = registry.register(
    'CapsulePreconditionFailedError',
    capsulePreconditionFailedErrorSchema
  )
  const registeredCapsulePreconditionRequiredError = registry.register(
    'CapsulePreconditionRequiredError',
    capsulePreconditionRequiredErrorSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules',
    tags: ['wardrobe'],
    summary: 'Create a new outfit capsule for an owner wardrobe',
    security: [{ bearerAuth: [] }],
    request: {
      params: ownerUserIdPathParamsSchema,
      headers: z.object({
        'idempotency-key': z.string().uuid().optional(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Capsule created successfully.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      200: {
        description: 'Idempotent creation replay.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid capsule creation payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
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
        description: 'Guardian consent required or guardian read-only access.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Owner user not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      409: {
        description:
          'Ineligible garments or idempotency key reused with different payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleConflictError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules',
    tags: ['wardrobe'],
    summary: 'List and filter outfit capsules for an owner wardrobe',
    security: [{ bearerAuth: [] }],
    request: {
      params: ownerUserIdPathParamsSchema,
      query: listOutfitCapsulesQuerySchema,
    },
    responses: {
      200: {
        description: 'List of outfit capsules.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleListResponse,
          },
        },
      },
      400: {
        description: 'Invalid query parameters.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
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
      404: {
        description: 'Owner user not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Get details of a specific outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Outfit capsule details.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
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
      404: {
        description: 'Capsule or owner not found or unauthorized.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Update metadata or constituent garments of an outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Capsule updated successfully.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid update payload.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
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
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      409: {
        description: 'Ineligible garments.',
        content: {
          'application/json': {
            schema: registeredCapsuleConflictError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}/favorite',
    tags: ['wardrobe'],
    summary: 'Set favorite status of an outfit capsule',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredFavoriteOutfitCapsuleInput,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Capsule favorite status updated.',
        content: {
          'application/json': {
            schema: registeredOutfitCapsuleResponse,
          },
        },
      },
      400: {
        description: 'Invalid request body.',
        content: {
          'application/json': {
            schema: registeredCapsuleBadRequestError,
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
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/wardrobe/{ownerUserId}/capsules/{capsuleId}',
    tags: ['wardrobe'],
    summary: 'Delete an outfit capsule and its join records',
    security: [{ bearerAuth: [] }],
    request: {
      params: capsuleIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string(),
      }),
    },
    responses: {
      204: {
        description: 'Capsule deleted successfully.',
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
        description: 'Guardian read-only or consent forbidden.',
        content: {
          'application/json': {
            schema: registeredCapsuleForbiddenError,
          },
        },
      },
      404: {
        description: 'Capsule or owner not found.',
        content: {
          'application/json': {
            schema: registeredCapsuleNotFoundError,
          },
        },
      },
      412: {
        description: 'Stale ETag / capsule revision mismatch.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredCapsulePreconditionRequiredError,
          },
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
