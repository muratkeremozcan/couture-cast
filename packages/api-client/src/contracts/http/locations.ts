import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

const locationLabelSchema = z.string().trim().min(1).max(80)
const optionalDisplayFieldSchema = z.string().trim().min(1).max(120).nullable()
const timezoneInputSchema = z.string().trim().min(1).max(120)
const postgresIntegerMax = 2_147_483_647
const sortOrderSchema = z.number().int().nonnegative().max(postgresIntegerMax)
const locationKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'locationKey must be a lowercase slug containing only alphanumeric characters and hyphens.',
  })

const locationIdentityFields = [
  'locationKey',
  'latitude',
  'longitude',
  'timezone',
] as const

export const savedLocationIdPathParamsSchema = z.object({
  locationId: nonEmptyStringSchema.describe('Saved location ID.'),
})

export const savedLocationSchema = z.object({
  id: nonEmptyStringSchema,
  label: nonEmptyStringSchema,
  locationKey: locationKeySchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezone: nonEmptyStringSchema,
  city: optionalDisplayFieldSchema,
  region: optionalDisplayFieldSchema,
  country: optionalDisplayFieldSchema,
  isPrimary: z.boolean(),
  sortOrder: sortOrderSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
})

export const createSavedLocationInputSchema = z
  .object({
    label: locationLabelSchema,
    locationKey: locationKeySchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    timezone: timezoneInputSchema,
    city: z.string().trim().min(1).max(120).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    country: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

export const updateSavedLocationInputSchema = z
  .object({
    label: locationLabelSchema.optional(),
    locationKey: locationKeySchema.optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    timezone: timezoneInputSchema.optional(),
    city: z.string().trim().min(1).max(120).nullable().optional(),
    region: z.string().trim().min(1).max(120).nullable().optional(),
    country: z.string().trim().min(1).max(120).nullable().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one saved-location field is required.',
  })
  .refine(
    (value) => {
      const identityFieldCount = locationIdentityFields.filter(
        (field) => value[field] !== undefined
      ).length

      return (
        identityFieldCount === 0 || identityFieldCount === locationIdentityFields.length
      )
    },
    {
      message: 'locationKey, latitude, longitude, and timezone must be updated together.',
    }
  )

export const listSavedLocationsResponseSchema = z.object({
  data: z.array(savedLocationSchema),
})

export const createSavedLocationResponseSchema = z.object({
  data: savedLocationSchema,
})

export const updateSavedLocationResponseSchema = z.object({
  data: savedLocationSchema,
})

export const setPrimarySavedLocationResponseSchema = z.object({
  data: savedLocationSchema,
})

export const deleteSavedLocationResponseSchema = z.object({
  data: z.object({
    deleted: z.literal(true),
  }),
})

export type SavedLocationIdPathParams = z.infer<typeof savedLocationIdPathParamsSchema>
export type SavedLocation = z.infer<typeof savedLocationSchema>
export type CreateSavedLocationInput = z.infer<typeof createSavedLocationInputSchema>
export type UpdateSavedLocationInput = z.infer<typeof updateSavedLocationInputSchema>
export type ListSavedLocationsResponse = z.infer<typeof listSavedLocationsResponseSchema>
export type CreateSavedLocationResponse = z.infer<
  typeof createSavedLocationResponseSchema
>
export type UpdateSavedLocationResponse = z.infer<
  typeof updateSavedLocationResponseSchema
>
export type SetPrimarySavedLocationResponse = z.infer<
  typeof setPrimarySavedLocationResponseSchema
>
export type DeleteSavedLocationResponse = z.infer<
  typeof deleteSavedLocationResponseSchema
>

export function registerLocationsContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredSavedLocationIdPathParamsSchema = registry.register(
    'SavedLocationIdPathParams',
    savedLocationIdPathParamsSchema
  )
  const registeredCreateSavedLocationInputSchema = registry.register(
    'CreateSavedLocationInput',
    createSavedLocationInputSchema
  )
  const registeredUpdateSavedLocationInputSchema = registry.register(
    'UpdateSavedLocationInput',
    updateSavedLocationInputSchema
  )
  registry.register('SavedLocation', savedLocationSchema)
  const registeredListSavedLocationsResponseSchema = registry.register(
    'ListSavedLocationsResponse',
    listSavedLocationsResponseSchema
  )
  const registeredCreateSavedLocationResponseSchema = registry.register(
    'CreateSavedLocationResponse',
    createSavedLocationResponseSchema
  )
  const registeredUpdateSavedLocationResponseSchema = registry.register(
    'UpdateSavedLocationResponse',
    updateSavedLocationResponseSchema
  )
  const registeredSetPrimarySavedLocationResponseSchema = registry.register(
    'SetPrimarySavedLocationResponse',
    setPrimarySavedLocationResponseSchema
  )
  const registeredDeleteSavedLocationResponseSchema = registry.register(
    'DeleteSavedLocationResponse',
    deleteSavedLocationResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/locations',
    tags: ['locations'],
    summary: 'List saved locations',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Saved locations returned successfully',
        content: {
          'application/json': {
            schema: registeredListSavedLocationsResponseSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
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
    path: '/api/v1/locations',
    tags: ['locations'],
    summary: 'Create a saved location',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateSavedLocationInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Saved location created successfully',
        content: {
          'application/json': {
            schema: registeredCreateSavedLocationResponseSchema,
          },
        },
      },
      400: {
        description: 'Saved location failed validation',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/locations/{locationId}',
    tags: ['locations'],
    summary: 'Update a saved location',
    security: [{ bearerAuth: [] }],
    request: {
      params: registeredSavedLocationIdPathParamsSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateSavedLocationInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Saved location updated successfully',
        content: {
          'application/json': {
            schema: registeredUpdateSavedLocationResponseSchema,
          },
        },
      },
      400: {
        description: 'Saved location failed validation',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved location was not found',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/locations/{locationId}/primary',
    tags: ['locations'],
    summary: 'Set a saved location as primary',
    security: [{ bearerAuth: [] }],
    request: {
      params: registeredSavedLocationIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Primary saved location updated successfully',
        content: {
          'application/json': {
            schema: registeredSetPrimarySavedLocationResponseSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved location was not found',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/locations/{locationId}',
    tags: ['locations'],
    summary: 'Delete a saved location',
    security: [{ bearerAuth: [] }],
    request: {
      params: registeredSavedLocationIdPathParamsSchema,
    },
    responses: {
      200: {
        description: 'Saved location deleted successfully',
        content: {
          'application/json': {
            schema: registeredDeleteSavedLocationResponseSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: commonSchemas.unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Saved location was not found',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
    },
  })
}
