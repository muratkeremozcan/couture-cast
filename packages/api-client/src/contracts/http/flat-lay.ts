import { z } from 'zod'
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { garmentSubtypeMatchesCategory } from '@couture/utils'
import { isoTimestampSchema, type RegisteredCommonHttpSchemas } from './common'
import {
  garmentCategoryEnum,
  garmentExpectedTagsSchema,
  garmentItemWireSchema,
} from './wardrobe'

export const FLAT_LAY_REVIEW_PATH = '/api/v1/wardrobe/flat-lay/review'
export const FLAT_LAY_CONFIRM_PATH = '/api/v1/wardrobe/flat-lay/confirm'
export const FLAT_LAY_MAX_PHOTO_BYTES = 4 * 1024 * 1024
export const FLAT_LAY_MAX_MASK_BYTES = 240 * 1024
export const FLAT_LAY_MAX_PIECES = 5
export const FLAT_LAY_REVIEW_LIFETIME_MS = 15 * 60_000

export const flatLayTagsSchema = garmentExpectedTagsSchema
  .required({ category: true })
  .refine(
    ({ category, subtype }) =>
      subtype == null || garmentSubtypeMatchesCategory(category, subtype),
    {
      path: ['subtype'],
      message: 'Subtype must match the garment category',
    }
  )

const flatLayMaskSchema = z
  .object({
    id: z.uuid(),
    mask: z
      .base64()
      .min(4)
      .max(Math.ceil(FLAT_LAY_MAX_MASK_BYTES / 3) * 4),
    token: z.string().min(1).max(1024),
  })
  .strict()

export const flatLayReviewResponseSchema = z
  .object({
    items: z
      .array(flatLayMaskSchema.extend({ category: garmentCategoryEnum.nullable() }))
      .min(2)
      .max(FLAT_LAY_MAX_PIECES),
    expiresAt: isoTimestampSchema,
  })
  .strict()

export const flatLayConfirmInputSchema = z
  .object({
    items: z
      .array(flatLayMaskSchema.extend({ tags: flatLayTagsSchema }))
      .min(1)
      .max(FLAT_LAY_MAX_PIECES),
  })
  .strict()

export const flatLayConfirmResponseSchema = z
  .object({
    garments: z.array(garmentItemWireSchema).min(1).max(FLAT_LAY_MAX_PIECES),
  })
  .strict()

export type FlatLayReview = z.infer<typeof flatLayReviewResponseSchema>
export type FlatLaySelection = z.infer<typeof flatLayConfirmInputSchema>
export type FlatLayTags = z.infer<typeof flatLayTagsSchema>
export type FlatLayConfirmation = z.infer<typeof flatLayConfirmResponseSchema>

export function registerFlatLayContracts(
  registry: OpenAPIRegistry,
  common: RegisteredCommonHttpSchemas
) {
  const review = registry.register('FlatLayReview', flatLayReviewResponseSchema)
  const selection = registry.register('FlatLaySelection', flatLayConfirmInputSchema)
  const confirmation = registry.register(
    'FlatLayConfirmation',
    flatLayConfirmResponseSchema
  )
  const headers = z.object({ 'Cache-Control': z.literal('private, no-store') })
  const json = (schema: z.ZodType) => ({ 'application/json': { schema } })
  const response = (description: string, schema: z.ZodType) => ({
    description,
    headers,
    content: json(schema),
  })
  const access = {
    401: response(
      'Missing or invalid authentication.',
      common.unauthorizedHttpErrorSchema
    ),
    403: response(
      'Account is restricted from wardrobe uploads.',
      common.forbiddenHttpErrorSchema
    ),
  }
  const route = {
    method: 'post' as const,
    tags: ['wardrobe'],
    security: [{ bearerAuth: [] }],
  }
  registry.registerPath({
    ...route,
    path: FLAT_LAY_REVIEW_PATH,
    operationId: 'reviewFlatLay',
    summary: 'Screen a flat-lay photo locally and return cutouts for review',
    request: {
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.object({
              photo: z.string().openapi({
                format: 'binary',
                description: 'JPEG, PNG or WebP photo up to 4 MiB.',
              }),
            }),
          },
        },
      },
    },
    responses: {
      200: response('Two to five cutouts with masks that expire in 15 minutes.', review),
      413: { description: 'Photo exceeds the upload limit.', headers },
      422: response(
        'FLAT_LAY_PERSON or FLAT_LAY_UNCERTAIN.',
        z.object({
          statusCode: z.literal(422),
          message: z.enum(['FLAT_LAY_PERSON', 'FLAT_LAY_UNCERTAIN']),
          error: z.string(),
        })
      ),
      ...access,
    },
  })
  registry.registerPath({
    ...route,
    path: FLAT_LAY_CONFIRM_PATH,
    operationId: 'confirmFlatLay',
    summary: 'Save the selected flat-lay cutouts with the reviewed tags',
    request: { body: { required: true, content: json(selection) } },
    responses: {
      200: response('Garments saved from the selected cutouts.', confirmation),
      400: response(
        'FLAT_LAY_INVALID for an invalid or stale selection.',
        common.badRequestHttpErrorSchema
      ),
      409: {
        description: 'A confirmation attempt is publishing a selected piece.',
        headers,
      },
      413: { description: 'Selection exceeds the request limit.', headers },
      ...access,
    },
  })
}
