import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  badRequestHttpErrorSchema,
  forbiddenHttpErrorSchema,
  isoTimestampSchema,
  nonEmptyStringSchema,
  trackedResponseSchema,
  unauthorizedHttpErrorSchema,
} from './common'

// Story 0.9 Task 5 step 1 owner:
// define the shared auth REST contracts here before controller code parses or returns them.
//
// Why this step matters:
// guardian consent is part of the public auth surface planned for Epic 0, so its request shape,
// success payload, and documented error cases must live in the canonical contract layer.
export const guardianConsentInputSchema = z.object({
  guardianId: nonEmptyStringSchema,
  teenId: nonEmptyStringSchema,
  consentLevel: nonEmptyStringSchema,
  timestamp: isoTimestampSchema.optional(),
})

export type GuardianConsentInput = z.infer<typeof guardianConsentInputSchema>

export const guardianConsentResponseSchema = trackedResponseSchema

export type GuardianConsentResponse = z.infer<typeof guardianConsentResponseSchema>

export function registerAuthContracts(registry: OpenAPIRegistry) {
  const registeredGuardianConsentInputSchema = registry.register(
    'GuardianConsentInput',
    guardianConsentInputSchema
  )
  const registeredGuardianConsentResponseSchema = registry.register(
    'GuardianConsentResponse',
    guardianConsentResponseSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/guardian-consent',
    tags: ['auth'],
    summary: 'Record guardian consent for a teen account',
    description:
      'Captures guardian consent for compliance workflows and downstream audit/analytics handling.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredGuardianConsentInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Guardian consent recorded successfully',
        content: {
          'application/json': {
            schema: registeredGuardianConsentResponseSchema,
          },
        },
      },
      400: {
        description: 'Guardian consent payload failed validation',
        content: {
          'application/json': {
            schema: badRequestHttpErrorSchema,
          },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': {
            schema: unauthorizedHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Authenticated guardian does not match guardianId',
        content: {
          'application/json': {
            schema: forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })
}
