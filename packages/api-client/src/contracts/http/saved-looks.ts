// Story CC-7.2: Account-backed saved looks HTTP contracts (Style this piece & Home sample).
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'
import {
  garmentCategoryEnum,
  garmentComfortRangeEnum,
  garmentImageAccessSchema,
} from './wardrobe'

let graphemeSegmenter: Intl.Segmenter | undefined
let graphemeSegmenterResolved = false

function getGraphemeSegmenter(): Intl.Segmenter | undefined {
  if (!graphemeSegmenterResolved) {
    graphemeSegmenterResolved = true
    const segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter })
      .Segmenter
    if (segmenter) {
      graphemeSegmenter = new segmenter(undefined, { granularity: 'grapheme' })
    }
  }
  return graphemeSegmenter
}

function countGraphemes(value: string): number {
  const segmenter = getGraphemeSegmenter()
  if (segmenter) {
    return [...segmenter.segment(value)].length
  }
  return [...value].length
}

const MAX_TITLE_GRAPHEMES = 80
const MAX_TITLE_UTF16 = 320

function graphemeBoundedTitle(maxGraphemes: number) {
  return z
    .string()
    .transform((value) => value.trim().normalize('NFC'))
    .superRefine((value, ctx) => {
      if (value.includes('\u0000')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain a null byte',
        })
        return
      }
      if (countGraphemes(value) > maxGraphemes || value.length > MAX_TITLE_UTF16) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: maxGraphemes,
          origin: 'string',
          inclusive: true,
          message: `must be at most ${maxGraphemes} characters after normalization`,
        })
      }
    })
    .transform((value) => (value.length === 0 ? null : value))
    .openapi({
      description: `Trimmed and NFC-normalized title bounded to ${maxGraphemes} extended grapheme clusters.`,
    })
}

export const savedLookSourceEnum = z.enum(['style_piece', 'home_sample'])
export const savedLookAvailabilityStatusEnum = z.enum([
  'ready',
  'missing_garment',
  'needs_review',
])
export const savedLookSlotKindEnum = z.enum(['garment', 'catalog'])
export const savedLookNeedsReviewReasonEnum = z.enum([
  'category_changed',
  'comfort_range_changed',
])

export const savedLookCompositionSlotInputSchema = z
  .object({
    slotIndex: z.number().int().min(0).max(11),
    category: garmentCategoryEnum,
    kind: savedLookSlotKindEnum,
    itemId: nonEmptyStringSchema.max(128),
    label: z.string().max(120).nullable().optional(),
  })
  .strict()

export const savedLookCompositionSlotSchema = z
  .object({
    slotIndex: z.number().int().min(0).max(11),
    category: garmentCategoryEnum,
    kind: savedLookSlotKindEnum,
    itemId: nonEmptyStringSchema.max(128),
    label: z.string().max(120).nullable(),
    missing: z.boolean(),
    imageAccess: garmentImageAccessSchema.nullable(),
  })
  .strict()

export const savedLookAnchorSnapshotSchema = z
  .object({
    garmentId: nonEmptyStringSchema.max(128),
    category: garmentCategoryEnum,
    comfortRange: garmentComfortRangeEnum,
  })
  .strict()

export const savedLookComfortSchema = z
  .object({
    runsColdWarm: z.enum(['cold', 'neutral', 'warm']),
    windTolerance: z.enum(['low', 'medium', 'high']),
    precipPreparedness: z.enum(['low', 'medium', 'high']),
  })
  .strict()

export const createSavedLookInputSchema = z
  .object({
    source: savedLookSourceEnum,
    lookId: nonEmptyStringSchema.max(64),
    weather: nonEmptyStringSchema.max(32),
    title: graphemeBoundedTitle(80).nullable().optional(),
    anchorGarmentId: nonEmptyStringSchema.max(128).nullable().optional(),
    anchorSnapshot: savedLookAnchorSnapshotSchema.nullable().optional(),
    composition: z.array(savedLookCompositionSlotInputSchema).min(1).max(12),
    swaps: z
      .partialRecord(garmentCategoryEnum, nonEmptyStringSchema.max(128))
      .optional()
      .default({}),
    collection: nonEmptyStringSchema.max(32).nullable().optional(),
    comfort: savedLookComfortSchema.nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<number>()
    for (let i = 0; i < data.composition.length; i += 1) {
      const slot = data.composition[i]
      if (!slot) continue
      if (seen.has(slot.slotIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['composition', i, 'slotIndex'],
          message: 'composition slotIndex values must be unique',
        })
      }
      seen.add(slot.slotIndex)
    }
    for (let expected = 0; expected < data.composition.length; expected += 1) {
      if (!seen.has(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['composition'],
          message: 'composition slotIndex values must be sequential starting from 0',
        })
        break
      }
    }

    if (data.source === 'style_piece') {
      if (!data.anchorGarmentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchorGarmentId'],
          message: 'anchorGarmentId is required for style_piece saved looks',
        })
      }
      if (!data.anchorSnapshot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchorSnapshot'],
          message: 'anchorSnapshot is required for style_piece saved looks',
        })
      } else if (
        data.anchorGarmentId &&
        data.anchorSnapshot.garmentId !== data.anchorGarmentId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchorSnapshot', 'garmentId'],
          message: 'anchorSnapshot.garmentId must match anchorGarmentId',
        })
      }
    } else {
      if (data.anchorGarmentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchorGarmentId'],
          message: 'anchorGarmentId must be omitted or null for home_sample saved looks',
        })
      }
      if (data.anchorSnapshot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['anchorSnapshot'],
          message: 'anchorSnapshot must be omitted or null for home_sample saved looks',
        })
      }
      for (let i = 0; i < data.composition.length; i += 1) {
        if (data.composition[i]?.kind === 'garment') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['composition', i, 'kind'],
            message: 'home_sample saved looks cannot reference wardrobe garment slots',
          })
        }
      }
    }
  })

export const savedLookSchema = z
  .object({
    id: nonEmptyStringSchema,
    ownerUserId: nonEmptyStringSchema,
    source: savedLookSourceEnum,
    lookId: nonEmptyStringSchema.max(64),
    weather: nonEmptyStringSchema.max(32),
    title: z
      .string()
      .max(MAX_TITLE_UTF16)
      .refine((value) => countGraphemes(value) <= MAX_TITLE_GRAPHEMES, {
        message: `must be at most ${MAX_TITLE_GRAPHEMES} characters`,
      })
      .nullable(),
    anchorGarmentId: nonEmptyStringSchema.max(128).nullable(),
    anchorSnapshot: savedLookAnchorSnapshotSchema.nullable(),
    composition: z.array(savedLookCompositionSlotSchema).min(1).max(12),
    swaps: z.partialRecord(garmentCategoryEnum, nonEmptyStringSchema.max(128)),
    collection: nonEmptyStringSchema.max(32).nullable(),
    comfort: savedLookComfortSchema.nullable(),
    availabilityStatus: savedLookAvailabilityStatusEnum,
    missingGarmentIds: z.array(nonEmptyStringSchema),
    needsReviewReasons: z.array(savedLookNeedsReviewReasonEnum),
    revision: z.number().int().min(0),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const listSavedLooksQuerySchema = z
  .object({
    source: savedLookSourceEnum.optional(),
    anchorGarmentId: nonEmptyStringSchema.max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict()

export const savedLookIdPathParamsSchema = z
  .object({
    savedLookId: nonEmptyStringSchema.max(128).describe('Unique saved look ID.'),
  })
  .strict()

export const savedLookResponseSchema = z
  .object({
    data: savedLookSchema,
  })
  .strict()

export const savedLookListResponseSchema = z
  .object({
    data: z.array(savedLookSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(10000),
  })
  .strict()

export const savedLookBadRequestErrorSchema = z
  .object({
    statusCode: z.literal(400),
    message: z.string(),
    error: z.literal('Bad Request'),
  })
  .strict()

export const savedLookNotFoundErrorSchema = z
  .object({
    statusCode: z.literal(404),
    message: z.enum(['SAVED_LOOK_NOT_FOUND', 'GARMENT_NOT_FOUND']),
    error: z.literal('Not Found'),
  })
  .strict()

export const savedLookConflictErrorSchema = z
  .object({
    statusCode: z.literal(409),
    message: z.enum([
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
      'SAVED_LOOK_ALREADY_REMOVED',
    ]),
    error: z.literal('Conflict'),
  })
  .strict()

export const savedLookPreconditionFailedErrorSchema = z
  .object({
    statusCode: z.literal(412),
    message: z.literal('SAVED_LOOK_REVISION_MISMATCH'),
    error: z.literal('Precondition Failed'),
  })
  .strict()

export const savedLookPreconditionRequiredErrorSchema = z
  .object({
    statusCode: z.literal(428),
    message: z.literal('PRECONDITION_REQUIRED'),
    error: z.literal('Precondition Required'),
  })
  .strict()

export type SavedLookSource = z.infer<typeof savedLookSourceEnum>
export type SavedLookAvailabilityStatus = z.infer<typeof savedLookAvailabilityStatusEnum>
export type SavedLookSlotKind = z.infer<typeof savedLookSlotKindEnum>
export type SavedLookNeedsReviewReason = z.infer<typeof savedLookNeedsReviewReasonEnum>
export type SavedLookCompositionSlotInput = z.infer<
  typeof savedLookCompositionSlotInputSchema
>
export type SavedLookCompositionSlotContract = z.infer<
  typeof savedLookCompositionSlotSchema
>
export type SavedLookAnchorSnapshotContract = z.infer<
  typeof savedLookAnchorSnapshotSchema
>
export type SavedLookComfortContract = z.infer<typeof savedLookComfortSchema>
export type CreateSavedLookInput = z.input<typeof createSavedLookInputSchema>
export type ParsedCreateSavedLookInput = z.infer<typeof createSavedLookInputSchema>
export type SavedLookContract = z.infer<typeof savedLookSchema>
export type ListSavedLooksQuery = z.infer<typeof listSavedLooksQuerySchema>
export type SavedLookResponse = z.infer<typeof savedLookResponseSchema>
export type SavedLookListResponse = z.infer<typeof savedLookListResponseSchema>

export function registerSavedLooksContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredCreateInput = registry.register(
    'CreateSavedLookInput',
    createSavedLookInputSchema
  )
  const registeredSavedLookResponse = registry.register(
    'SavedLookResponse',
    savedLookResponseSchema
  )
  const registeredSavedLookListResponse = registry.register(
    'SavedLookListResponse',
    savedLookListResponseSchema
  )
  const registeredBadRequestError = registry.register(
    'SavedLookBadRequestError',
    savedLookBadRequestErrorSchema
  )
  const registeredNotFoundError = registry.register(
    'SavedLookNotFoundError',
    savedLookNotFoundErrorSchema
  )
  const registeredConflictError = registry.register(
    'SavedLookConflictError',
    savedLookConflictErrorSchema
  )
  const registeredPreconditionFailedError = registry.register(
    'SavedLookPreconditionFailedError',
    savedLookPreconditionFailedErrorSchema
  )
  const registeredPreconditionRequiredError = registry.register(
    'SavedLookPreconditionRequiredError',
    savedLookPreconditionRequiredErrorSchema
  )

  const privateNoStoreHeader = z
    .object({
      'Cache-Control': z.string().openapi({
        description: 'Always private, no-store on all responses.',
        example: 'private, no-store',
      }),
    })
    .openapi({ description: 'Private no-store response header.' })

  const resourceHeaders = z
    .object({
      'Cache-Control': z.string().openapi({
        description: 'Always private, no-store on all responses.',
        example: 'private, no-store',
      }),
      ETag: z.string().openapi({
        description:
          'Strong resource revision tag ("saved-look:<id>:<revision>") for optimistic concurrency. Ephemeral signed image URLs rotate per read independently of revision.',
        example: '"saved-look:sl-1:0"',
      }),
    })
    .openapi({ description: 'Saved look response headers.' })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/saved-looks',
    tags: ['wardrobe'],
    summary: 'List saved looks belonging to the authenticated account',
    security: [{ bearerAuth: [] }],
    request: {
      query: listSavedLooksQuerySchema,
    },
    responses: {
      200: {
        description: 'List of account-backed saved looks.',
        headers: privateNoStoreHeader,
        content: {
          'application/json': {
            schema: registeredSavedLookListResponse,
          },
        },
      },
      400: {
        description: 'Invalid query parameters.',
        content: {
          'application/json': {
            schema: registeredBadRequestError,
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
        description: 'Account access restricted.',
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
    path: '/api/v1/wardrobe/saved-looks',
    tags: ['wardrobe'],
    summary: 'Save a Style this piece or Home sample look to the authenticated account',
    security: [{ bearerAuth: [] }],
    request: {
      headers: z.object({
        'idempotency-key': z
          .string()
          .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
          .optional()
          .openapi({
            description:
              'UUID v4 idempotency key scoped per account. Replays matching payloads with 200 and rejects mismatched payloads or already-removed rows with 409.',
          }),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateInput,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Saved look created.',
        headers: resourceHeaders,
        content: {
          'application/json': {
            schema: registeredSavedLookResponse,
          },
        },
      },
      200: {
        description: 'Idempotent replay of an existing saved look.',
        headers: resourceHeaders,
        content: {
          'application/json': {
            schema: registeredSavedLookResponse,
          },
        },
      },
      400: {
        description: 'Invalid saved look payload or Idempotency-Key header.',
        content: {
          'application/json': {
            schema: registeredBadRequestError,
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
        description: 'Account access restricted.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Referenced wardrobe garment was not found for this account.',
        content: {
          'application/json': {
            schema: registeredNotFoundError,
          },
        },
      },
      409: {
        description:
          'Idempotency-Key reused with a different payload or for an already-removed saved look.',
        content: {
          'application/json': {
            schema: registeredConflictError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/wardrobe/saved-looks/{savedLookId}',
    tags: ['wardrobe'],
    summary: 'Get a single saved look belonging to the authenticated account',
    security: [{ bearerAuth: [] }],
    request: {
      params: savedLookIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Saved look details.',
        headers: resourceHeaders,
        content: {
          'application/json': {
            schema: registeredSavedLookResponse,
          },
        },
      },
      400: {
        description: 'Invalid savedLookId path parameter.',
        content: {
          'application/json': {
            schema: registeredBadRequestError,
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
        description: 'Account access restricted.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved look not found for this account.',
        content: {
          'application/json': {
            schema: registeredNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/wardrobe/saved-looks/{savedLookId}/restore',
    tags: ['wardrobe'],
    summary:
      'Restore a recently removed saved look belonging to the authenticated account',
    security: [{ bearerAuth: [] }],
    request: {
      params: savedLookIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Saved look restored (idempotent if already active).',
        headers: resourceHeaders,
        content: {
          'application/json': {
            schema: registeredSavedLookResponse,
          },
        },
      },
      400: {
        description: 'Invalid savedLookId path parameter.',
        content: {
          'application/json': {
            schema: registeredBadRequestError,
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
        description: 'Account access restricted.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved look not found for this account.',
        content: {
          'application/json': {
            schema: registeredNotFoundError,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/wardrobe/saved-looks/{savedLookId}',
    tags: ['wardrobe'],
    summary: 'Remove a saved look belonging to the authenticated account',
    security: [{ bearerAuth: [] }],
    request: {
      params: savedLookIdPathParamsSchema,
      headers: z.object({
        'if-match': z.string().openapi({
          description:
            'Required strong ETag ("saved-look:<id>:<revision>"), comma-separated list of strong ETags, or *.',
        }),
      }),
    },
    responses: {
      204: {
        description: 'Saved look removed.',
        headers: privateNoStoreHeader,
      },
      400: {
        description: 'Invalid savedLookId path parameter.',
        content: {
          'application/json': {
            schema: registeredBadRequestError,
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
        description: 'Account access restricted.',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved look not found for this account.',
        content: {
          'application/json': {
            schema: registeredNotFoundError,
          },
        },
      },
      412: {
        description: 'Stale ETag / saved look revision mismatch.',
        content: {
          'application/json': {
            schema: registeredPreconditionFailedError,
          },
        },
      },
      428: {
        description: 'If-Match header required.',
        content: {
          'application/json': {
            schema: registeredPreconditionRequiredError,
          },
        },
      },
    },
  })
}
