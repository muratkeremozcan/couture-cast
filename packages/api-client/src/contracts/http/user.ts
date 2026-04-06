import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

// Story 0.9 Task 5 step 3 owner:
// define the first shared user REST contract here so future authenticated dashboards start from
// shared Zod-first shapes rather than controller-local DTOs.
//
// Why this step matters:
// Epic 0 already needs user/guardian state for upcoming auth-backed journeys, so the canonical
// contract layer must expose one real user slice before those flows land.
export const apiRoleSchema = z.enum(['guardian', 'teen', 'moderator', 'admin'])
export const guardianConsentStatusSchema = z.enum(['pending', 'granted', 'revoked'])

export const linkedGuardianSchema = z.object({
  guardianId: nonEmptyStringSchema,
  status: guardianConsentStatusSchema,
  consentGrantedAt: isoTimestampSchema.nullable(),
})

export const linkedTeenSchema = z.object({
  teenId: nonEmptyStringSchema,
  status: guardianConsentStatusSchema,
  consentGrantedAt: isoTimestampSchema.nullable(),
})

export const userProfileResponseSchema = z.object({
  user: z.object({
    id: nonEmptyStringSchema,
    email: z.string().email(),
    displayName: z.string().nullable(),
    birthdate: isoTimestampSchema.nullable(),
    role: apiRoleSchema,
  }),
  linkedGuardians: z.array(linkedGuardianSchema),
  linkedTeens: z.array(linkedTeenSchema),
})

export type ApiRole = z.infer<typeof apiRoleSchema>
export type GuardianConsentStatus = z.infer<typeof guardianConsentStatusSchema>
export type LinkedGuardian = z.infer<typeof linkedGuardianSchema>
export type LinkedTeen = z.infer<typeof linkedTeenSchema>
export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>

export function registerUserContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('LinkedGuardian', linkedGuardianSchema)
  registry.register('LinkedTeen', linkedTeenSchema)
  const registeredUserProfileResponseSchema = registry.register(
    'UserProfileResponse',
    userProfileResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/user/profile',
    tags: ['user'],
    summary: 'Get the authenticated user profile',
    description:
      'Returns profile metadata plus guardian/teen consent links for authenticated dashboards.',
    responses: {
      200: {
        description: 'Authenticated user profile returned successfully',
        content: {
          'application/json': {
            schema: registeredUserProfileResponseSchema,
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
      404: {
        description: 'Authenticated user could not be found',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
    },
  })
}
