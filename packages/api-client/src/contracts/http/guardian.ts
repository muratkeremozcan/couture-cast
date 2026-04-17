import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
} from './common'

export const consentLevelSchema = z.enum(['read_only', 'full_access'])

export const guardianInvitationInputSchema = z.object({
  teenId: nonEmptyStringSchema,
  guardianEmail: z.string().email(),
  consentLevel: consentLevelSchema.default('read_only'),
})

export const guardianInvitationResponseSchema = z.object({
  invitationId: nonEmptyStringSchema,
  teenId: nonEmptyStringSchema,
  guardianEmail: z.string().email(),
  consentLevel: consentLevelSchema,
  expiresAt: isoTimestampSchema,
  invitationLink: z.string().url(),
  deliveryQueued: z.boolean(),
})

export const guardianInvitationAcceptInputSchema = z.object({
  token: nonEmptyStringSchema,
})

export const guardianInvitationAcceptResponseSchema = z.object({
  teenId: nonEmptyStringSchema,
  teenEmail: z.string().email(),
  guardianId: nonEmptyStringSchema,
  guardianEmail: z.string().email(),
  consentLevel: consentLevelSchema,
  grantedAt: isoTimestampSchema,
})

export type ConsentLevel = z.infer<typeof consentLevelSchema>
export type GuardianInvitationInput = z.infer<typeof guardianInvitationInputSchema>
export type GuardianInvitationResponse = z.infer<typeof guardianInvitationResponseSchema>
export type GuardianInvitationAcceptInput = z.infer<
  typeof guardianInvitationAcceptInputSchema
>
export type GuardianInvitationAcceptResponse = z.infer<
  typeof guardianInvitationAcceptResponseSchema
>

export function registerGuardianContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredGuardianInvitationInputSchema = registry.register(
    'GuardianInvitationInput',
    guardianInvitationInputSchema
  )
  const registeredGuardianInvitationResponseSchema = registry.register(
    'GuardianInvitationResponse',
    guardianInvitationResponseSchema
  )
  const registeredGuardianInvitationAcceptInputSchema = registry.register(
    'GuardianInvitationAcceptInput',
    guardianInvitationAcceptInputSchema
  )
  const registeredGuardianInvitationAcceptResponseSchema = registry.register(
    'GuardianInvitationAcceptResponse',
    guardianInvitationAcceptResponseSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/guardian/invitations',
    tags: ['guardian'],
    summary: 'Invite a guardian for a teen account',
    description:
      'Creates a signed seven-day invitation token, queues an invitation email, and stores the invitation for later acceptance.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredGuardianInvitationInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Guardian invitation created successfully',
        content: {
          'application/json': {
            schema: registeredGuardianInvitationResponseSchema,
          },
        },
      },
      400: {
        description:
          'Guardian invitation payload failed validation or the teen is not eligible',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Teen account was not found',
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
    path: '/api/v1/guardian/accept',
    tags: ['guardian'],
    summary: 'Accept a guardian invitation',
    description:
      'Validates the signed invitation token, links or creates the guardian account, records consent, and queues confirmation emails.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredGuardianInvitationAcceptInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Guardian invitation accepted successfully',
        content: {
          'application/json': {
            schema: registeredGuardianInvitationAcceptResponseSchema,
          },
        },
      },
      400: {
        description: 'Guardian invitation token is invalid, expired, or already used',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      404: {
        description: 'Guardian invitation could not be found',
        content: {
          'application/json': {
            schema: commonSchemas.notFoundHttpErrorSchema,
          },
        },
      },
    },
  })
}
