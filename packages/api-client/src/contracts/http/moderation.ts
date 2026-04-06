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

// Story 0.9 Task 5 step 2 owner:
// define the moderation REST contract slice in the shared package so controller code stops owning
// these shapes directly.
//
// Why this step matters:
// moderation is an existing public REST surface in the API. If it stays controller-local, the live
// contract and generated SDK drift from the actual implementation again.
export const moderationActionInputSchema = z.object({
  moderatorId: nonEmptyStringSchema,
  targetId: nonEmptyStringSchema,
  action: nonEmptyStringSchema,
  reason: nonEmptyStringSchema,
  contentType: nonEmptyStringSchema.optional(),
  timestamp: isoTimestampSchema.optional(),
})

export type ModerationActionInput = z.infer<typeof moderationActionInputSchema>

export const moderationActionResponseSchema = trackedResponseSchema

export type ModerationActionResponse = z.infer<typeof moderationActionResponseSchema>

export function registerModerationContracts(registry: OpenAPIRegistry) {
  const registeredModerationActionInputSchema = registry.register(
    'ModerationActionInput',
    moderationActionInputSchema
  )
  const registeredModerationActionResponseSchema = registry.register(
    'ModerationActionResponse',
    moderationActionResponseSchema
  )

  registry.registerPath({
    method: 'post',
    path: '/api/v1/moderation/actions',
    tags: ['moderation'],
    summary: 'Record a moderation action',
    description:
      'Captures moderation actions for analytics, policy tracking, and downstream review workflows.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: registeredModerationActionInputSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Moderation action recorded successfully',
        content: {
          'application/json': {
            schema: registeredModerationActionResponseSchema,
          },
        },
      },
      400: {
        description: 'Moderation action payload failed validation',
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
        description: 'Authenticated moderator does not match moderatorId',
        content: {
          'application/json': {
            schema: forbiddenHttpErrorSchema,
          },
        },
      },
    },
  })
}
