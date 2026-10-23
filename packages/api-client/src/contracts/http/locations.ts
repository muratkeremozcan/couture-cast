import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'
import { supportedLocaleSchema } from './localization'

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
  .openapi({
    description: [
      'Cross-field invariants enforced at runtime and NOT expressible in this schema:',
      '(1) at least one property must be present, so an empty patch body is rejected',
      'rather than treated as a no-op;',
      '(2) locationKey, latitude, longitude, and timezone form one identity group and',
      'must be sent all together or not at all, because updating a coordinate without',
      'its key would leave the row internally inconsistent.',
    ].join(' '),
  })

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

/** Story 1.2b: search text bounds. Shorter or longer queries never reach a provider. */
export const LOCATION_SEARCH_QUERY_MIN_LENGTH = 2
export const LOCATION_SEARCH_QUERY_MAX_LENGTH = 80
export const LOCATION_SEARCH_MAX_RESULTS = 5
export const LOCATION_SEARCH_REQUESTS_PER_MINUTE = 30

export const locationPlatformSchema = z.enum(['web', 'mobile'])

export const locationHeadersSchema = z.object({
  'x-couture-platform': locationPlatformSchema.describe(
    'Which client is calling. Required on search and save from search; drives the platform property on location analytics.'
  ),
})

export const locationSearchQueryParamsSchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(LOCATION_SEARCH_QUERY_MIN_LENGTH)
      .max(LOCATION_SEARCH_QUERY_MAX_LENGTH)
      .describe('City name to search for. Never logged or sent to analytics.'),
    locale: supportedLocaleSchema
      .optional()
      .describe('Display locale for candidate labels. Never changes stored values.'),
  })
  .strict()

/**
 * Response bodies strip unknown keys rather than reject them, so an installed
 * mobile build keeps working when the server adds a field. Request bodies stay
 * strict. The integration suite pins the exact server output with `.strict()`.
 */
export const locationSearchCandidateSchema = z.object({
  city: z.string().min(1).max(120).describe("The provider's default place name."),
  region: optionalDisplayFieldSchema,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .describe('ISO 3166-1 alpha-2 country code.'),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  displayLabel: z
    .string()
    .min(1)
    .max(400)
    .describe('Localized label for display only. Not part of the signed candidate.'),
  candidateToken: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      'Signed, identity-free candidate valid for 15 minutes. Pass it to POST /api/v1/locations/from-search.'
    ),
})

export const locationSearchResponseSchema = z.object({
  data: z.array(locationSearchCandidateSchema).max(LOCATION_SEARCH_MAX_RESULTS),
})

export const createSavedLocationFromSearchInputSchema = z
  .object({
    candidateToken: z.string().min(1).max(2048),
    label: locationLabelSchema,
  })
  .strict()

export const createSavedLocationFromSearchResponseSchema = z.object({
  data: savedLocationSchema,
})

export const locationRequestErrorCodeSchema = z.enum([
  'invalid_request',
  'invalid_candidate',
  'location_limit_reached',
  'location_duplicate',
])

export const locationRequestErrorResponseSchema = z.object({
  statusCode: z.literal(400),
  code: locationRequestErrorCodeSchema,
  message: nonEmptyStringSchema,
  error: z.literal('Bad Request'),
})

export const locationUnavailableErrorCodeSchema = z.enum([
  'provider_unavailable',
  'location_service_unavailable',
])

export const locationUnavailableResponseSchema = z.object({
  statusCode: z.literal(503),
  code: locationUnavailableErrorCodeSchema,
  retryable: z.literal(true),
  message: nonEmptyStringSchema,
  error: z.literal('Service Unavailable'),
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

export type LocationPlatform = z.infer<typeof locationPlatformSchema>
export type LocationSearchQueryParams = z.infer<typeof locationSearchQueryParamsSchema>
export type LocationSearchCandidate = z.infer<typeof locationSearchCandidateSchema>
export type LocationSearchResponse = z.infer<typeof locationSearchResponseSchema>
export type CreateSavedLocationFromSearchInput = z.infer<
  typeof createSavedLocationFromSearchInputSchema
>
export type CreateSavedLocationFromSearchResponse = z.infer<
  typeof createSavedLocationFromSearchResponseSchema
>
export type LocationRequestErrorCode = z.infer<typeof locationRequestErrorCodeSchema>
export type LocationRequestErrorResponse = z.infer<
  typeof locationRequestErrorResponseSchema
>
export type LocationUnavailableErrorCode = z.infer<
  typeof locationUnavailableErrorCodeSchema
>
export type LocationUnavailableResponse = z.infer<
  typeof locationUnavailableResponseSchema
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

  const registeredLocationHeadersSchema = registry.register(
    'LocationHeaders',
    locationHeadersSchema
  )
  const registeredLocationSearchQueryParamsSchema = registry.register(
    'LocationSearchQueryParams',
    locationSearchQueryParamsSchema
  )
  registry.register('LocationSearchCandidate', locationSearchCandidateSchema)
  const registeredLocationSearchResponseSchema = registry.register(
    'LocationSearchResponse',
    locationSearchResponseSchema
  )
  const registeredCreateSavedLocationFromSearchInputSchema = registry.register(
    'CreateSavedLocationFromSearchInput',
    createSavedLocationFromSearchInputSchema
  )
  const registeredCreateSavedLocationFromSearchResponseSchema = registry.register(
    'CreateSavedLocationFromSearchResponse',
    createSavedLocationFromSearchResponseSchema
  )
  const registeredLocationRequestErrorResponseSchema = registry.register(
    'LocationRequestErrorResponse',
    locationRequestErrorResponseSchema
  )
  const registeredLocationUnavailableResponseSchema = registry.register(
    'LocationUnavailableResponse',
    locationUnavailableResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/locations/search',
    tags: ['locations'],
    summary: 'Search cities through the configured weather provider',
    description:
      'Returns at most five city candidates from the configured provider geocoding. Each candidate carries a signed, identity-free candidateToken valid for 15 minutes. The query text is never logged or sent to analytics.',
    security: [{ bearerAuth: [] }],
    request: {
      headers: registeredLocationHeadersSchema,
      query: registeredLocationSearchQueryParamsSchema,
    },
    responses: {
      200: {
        description: 'Search candidates returned successfully',
        content: {
          'application/json': { schema: registeredLocationSearchResponseSchema },
        },
      },
      400: {
        description:
          'Query shorter than 2 or longer than 80 characters, or a missing platform header',
        content: {
          'application/json': { schema: registeredLocationRequestErrorResponseSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      429: {
        description: `${LOCATION_SEARCH_REQUESTS_PER_MINUTE} searches per member per minute.`,
        headers: {
          'Retry-After': {
            description: 'Seconds until the member may search again.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          'application/json': { schema: commonSchemas.tooManyRequestsHttpErrorSchema },
        },
      },
      503: {
        description:
          'The provider failed, timed out after 3 seconds or has no key, or the candidate secret is missing. Retryable.',
        content: {
          'application/json': { schema: registeredLocationUnavailableResponseSchema },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/locations/from-search',
    tags: ['locations'],
    summary: 'Save a searched city as a location',
    description:
      'Verifies the candidate token, fetches one forecast for the candidate coordinates (3-second timeout) for its IANA timezone, and persists that forecast as the location snapshot before saving. Coordinates, timezone and country never come from the client. Storage follows the saved-location rules: at most three, the first becomes primary, a duplicate key is refused.',
    security: [{ bearerAuth: [] }],
    request: {
      headers: registeredLocationHeadersSchema,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredCreateSavedLocationFromSearchInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Saved location created with its weather snapshot',
        content: {
          'application/json': {
            schema: registeredCreateSavedLocationFromSearchResponseSchema,
          },
        },
      },
      400: {
        description:
          'Invalid body, tampered, foreign-environment or expired candidate, three saved locations already, or a duplicate location',
        content: {
          'application/json': { schema: registeredLocationRequestErrorResponseSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: 'Guardian consent is required for teen access',
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      503: {
        description:
          'The forecast call failed, timed out or returned an invalid timezone, or the candidate secret is missing. Nothing was saved. Retryable.',
        content: {
          'application/json': { schema: registeredLocationUnavailableResponseSchema },
        },
      },
    },
  })

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
