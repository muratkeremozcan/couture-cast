import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  type RegisteredCommonHttpSchemas,
  trackedResponseSchema,
} from './common'

function isValidCalendarBirthdate(input: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(input)
  if (!match?.groups) {
    return false
  }

  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const candidate = new Date(Date.UTC(year, month - 1, day, 12))

  return (
    !Number.isNaN(candidate.getTime()) &&
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  )
}

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

const birthdateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isValidCalendarBirthdate, 'Birthdate must be a valid date')
  .openapi({
    description: [
      'Invariant enforced at runtime and NOT expressible in this schema: beyond the',
      'YYYY-MM-DD pattern, the value must be a real calendar date. The pattern alone',
      'accepts 2026-02-31 and 2026-13-01; both are rejected here.',
    ].join(' '),
  })
export const signupInputSchema = z.object({
  email: z.string().email(),
  birthdate: birthdateSchema,
})

const signupResponseFields = {
  userId: nonEmptyStringSchema,
  age: z.number().int().min(13),
}

export const signupResponseSchema = z
  .discriminatedUnion('accountStatus', [
    z
      .object({
        ...signupResponseFields,
        accountStatus: z.literal('active'),
        guardianConsentRequired: z.literal(false),
      })
      .strict(),
    z
      .object({
        ...signupResponseFields,
        accountStatus: z.literal('pending_guardian_consent'),
        guardianConsentRequired: z.literal(true),
      })
      .strict(),
  ])
  .openapi({
    description: [
      'guardianConsentRequired is a function of accountStatus, never independent of',
      'it, so each variant fixes both together. Treat accountStatus as the source of',
      'truth; a response where the two disagree is unrepresentable.',
    ].join(' '),
  })

export type SignupInput = z.infer<typeof signupInputSchema>
export type SignupResponse = z.infer<typeof signupResponseSchema>

export type GuardianConsentInput = z.infer<typeof guardianConsentInputSchema>

export const guardianConsentResponseSchema = trackedResponseSchema

export type GuardianConsentResponse = z.infer<typeof guardianConsentResponseSchema>

export function registerAuthContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  const registeredSignupInputSchema = registry.register('SignupInput', signupInputSchema)
  const registeredSignupResponseSchema = registry.register(
    'SignupResponse',
    signupResponseSchema
  )
  const registeredGuardianConsentInputSchema = registry.register(
    'GuardianConsentInput',
    guardianConsentInputSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/signup',
    tags: ['auth'],
    summary: 'Create an account with age verification',
    description:
      'Evaluates the submitted birthdate, blocks signups for children under 13, and flags 13-15 year olds for guardian consent.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredSignupInputSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Account created successfully',
        content: {
          'application/json': {
            schema: registeredSignupResponseSchema,
          },
        },
      },
      400: {
        description: 'Signup payload failed validation or email is already registered',
        content: {
          'application/json': {
            schema: commonSchemas.badRequestHttpErrorSchema,
          },
        },
      },
      403: {
        description: 'Birthdate indicates a child younger than thirteen',
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
            schema: commonSchemas.trackedResponseSchema,
          },
        },
      },
      400: {
        description: 'Guardian consent payload failed validation',
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
        description: 'Authenticated guardian does not match guardianId',
        content: {
          'application/json': {
            schema: commonSchemas.forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })
}
