import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import type { ParameterObject } from 'openapi3-ts/oas31'
import { z } from 'zod'
import { apiErrorSchema, isoTimestampSchema, nonEmptyStringSchema } from './common'

// Story 0.9 Task 2 step 3 owner:
// model the first non-trivial feature contract here, not just a health-check shape.
//
// Why this step matters:
// this file proves the pattern can handle real query params, unions, arrays, and graceful
// error payloads, which is what turns the Zod-first approach from a demo into an architecture.
export const eventsPollQuerySchema = z.object({
  since: isoTimestampSchema.optional(),
})

export type EventsPollQuery = z.infer<typeof eventsPollQuerySchema>

export const polledEventSchema = z.object({
  id: nonEmptyStringSchema,
  channel: nonEmptyStringSchema,
  payload: z.unknown(),
  userId: nonEmptyStringSchema.nullable(),
  createdAt: isoTimestampSchema,
})

export type PolledEvent = z.infer<typeof polledEventSchema>

export const eventsPollResponseSchema = z.object({
  events: z.array(polledEventSchema),
  nextSince: isoTimestampSchema.nullable(),
})

export type EventsPollResponse = z.infer<typeof eventsPollResponseSchema>

export const eventsPollInvalidSinceResponseSchema = z.object({
  events: z.array(polledEventSchema),
  nextSince: z.null(),
  error: apiErrorSchema.shape.error,
})

export type EventsPollInvalidSinceResponse = z.infer<
  typeof eventsPollInvalidSinceResponseSchema
>

export const eventsPollResultSchema = z.union([
  eventsPollResponseSchema,
  eventsPollInvalidSinceResponseSchema,
])

const sinceQueryParameter: ParameterObject = {
  name: 'since',
  in: 'query',
  required: false,
  schema: {
    type: 'string',
    format: 'date-time',
  },
  description: 'Fetch only events created after this ISO timestamp.',
}

export function registerEventsContracts(registry: OpenAPIRegistry) {
  registry.register('PolledEvent', polledEventSchema)
  registry.register('EventsPollQuery', eventsPollQuerySchema)
  registry.register('EventsPollResponse', eventsPollResponseSchema)
  registry.register(
    'EventsPollInvalidSinceResponse',
    eventsPollInvalidSinceResponseSchema
  )
  registry.register('EventsPollResult', eventsPollResultSchema)

  registry.registerPath({
    method: 'get',
    path: '/api/v1/events/poll',
    tags: ['events'],
    summary: 'Poll incremental realtime fallback events',
    description:
      'Returns unseen events plus the next cursor for polling fallback clients.',
    parameters: [sinceQueryParameter],
    responses: {
      200: {
        description:
          'Incremental polling result. Invalid query timestamps currently return a graceful payload instead of a 4xx.',
        content: {
          'application/json': {
            schema: eventsPollResultSchema,
          },
        },
      },
    },
  })
}
