import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { type RegisteredCommonHttpSchemas } from './common'

export const comfortRunSchema = z.enum(['cold', 'neutral', 'warm'])
export const windToleranceSchema = z.enum(['low', 'medium', 'high'])
export const precipPreparednessSchema = z.enum(['low', 'medium', 'high'])

export const comfortPreferencesSchema = z.object({
  runsColdWarm: comfortRunSchema,
  windTolerance: windToleranceSchema,
  precipPreparedness: precipPreparednessSchema,
})

export const comfortPreferencesResponseSchema = z.object({
  data: comfortPreferencesSchema,
})

export const updateComfortPreferencesInputSchema = comfortPreferencesSchema

export const updateComfortPreferencesResponseSchema = z.object({
  data: comfortPreferencesSchema,
})

export type ComfortRun = z.infer<typeof comfortRunSchema>
export type WindTolerance = z.infer<typeof windToleranceSchema>
export type PrecipPreparedness = z.infer<typeof precipPreparednessSchema>
export type ComfortPreferences = z.infer<typeof comfortPreferencesSchema>
export type ComfortPreferencesResponse = z.infer<typeof comfortPreferencesResponseSchema>
export type UpdateComfortPreferencesInput = z.infer<
  typeof updateComfortPreferencesInputSchema
>
export type UpdateComfortPreferencesResponse = z.infer<
  typeof updateComfortPreferencesResponseSchema
>

export function registerComfortContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('ComfortRun', comfortRunSchema)
  registry.register('WindTolerance', windToleranceSchema)
  registry.register('PrecipPreparedness', precipPreparednessSchema)

  registry.register('ComfortPreferences', comfortPreferencesSchema)
  const registeredComfortPreferencesResponseSchema = registry.register(
    'ComfortPreferencesResponse',
    comfortPreferencesResponseSchema
  )
  const registeredUpdateComfortPreferencesInputSchema = registry.register(
    'UpdateComfortPreferencesInput',
    updateComfortPreferencesInputSchema
  )
  const registeredUpdateComfortPreferencesResponseSchema = registry.register(
    'UpdateComfortPreferencesResponse',
    updateComfortPreferencesResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/personalization/comfort',
    tags: ['comfort'],
    summary: 'Get user comfort preferences',
    description:
      'Retrieves comfort settings for the authenticated user, returning defaults if not yet configured.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Comfort preferences retrieved successfully',
        content: {
          'application/json': {
            schema: registeredComfortPreferencesResponseSchema,
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
      500: {
        description: 'Internal server error occurred',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/personalization/comfort',
    tags: ['comfort'],
    summary: 'Update user comfort preferences',
    description:
      'Updates comfort settings for the authenticated user and invalidates relevant outfit caches.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredUpdateComfortPreferencesInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Comfort preferences updated successfully',
        content: {
          'application/json': {
            schema: registeredUpdateComfortPreferencesResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid input payload',
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
      500: {
        description: 'Internal server error occurred',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })
}
