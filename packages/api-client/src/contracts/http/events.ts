import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { apiErrorSchema, isoTimestampSchema, nonEmptyStringSchema } from './common'

// Story 0.9 Task 2 step 3 owner:
// model the first non-trivial feature contract here, not just a health-check shape.
//
// Why this step matters:
// this file proves the pattern can handle real query params, unions, arrays, and graceful
// error payloads, which is what turns the Zod-first approach from a demo into an architecture.
const eventsSinceQuerySchema = isoTimestampSchema
  .optional()
  .describe('Fetch only events created after this ISO timestamp.')

export const eventsPollQuerySchema = z.object({
  since: eventsSinceQuerySchema,
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

function createEventsPollResponseSchema(eventSchema: typeof polledEventSchema) {
  return z.object({
    events: z.array(eventSchema),
    nextSince: isoTimestampSchema.nullable(),
  })
}

export const eventsPollResponseSchema = createEventsPollResponseSchema(polledEventSchema)

export type EventsPollResponse = z.infer<typeof eventsPollResponseSchema>

function createEventsPollInvalidSinceResponseSchema(
  eventSchema: typeof polledEventSchema
) {
  return z.object({
    events: z.array(eventSchema),
    nextSince: z.null(),
    error: apiErrorSchema.shape.error,
  })
}

export const eventsPollInvalidSinceResponseSchema =
  createEventsPollInvalidSinceResponseSchema(polledEventSchema)

export type EventsPollInvalidSinceResponse = z.infer<
  typeof eventsPollInvalidSinceResponseSchema
>

export const eventsPollResultSchema = z.union([
  eventsPollResponseSchema,
  eventsPollInvalidSinceResponseSchema,
])

export function registerEventsContracts(registry: OpenAPIRegistry) {
  const registeredPolledEventSchema = registry.register('PolledEvent', polledEventSchema)
  const registeredEventsPollQuerySchema = registry.register(
    'EventsPollQuery',
    eventsPollQuerySchema
  )
  const registeredEventsPollResponseSchema = registry.register(
    'EventsPollResponse',
    createEventsPollResponseSchema(registeredPolledEventSchema)
  )
  const registeredEventsPollInvalidSinceResponseSchema = registry.register(
    'EventsPollInvalidSinceResponse',
    createEventsPollInvalidSinceResponseSchema(registeredPolledEventSchema)
  )
  const registeredEventsPollResultSchema = registry.register(
    'EventsPollResult',
    z.union([
      registeredEventsPollResponseSchema,
      registeredEventsPollInvalidSinceResponseSchema,
    ])
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/events/poll',
    tags: ['events'],
    summary: 'Poll incremental realtime fallback events',
    description:
      'Returns unseen events plus the next cursor for polling fallback clients.',
    request: {
      query: registeredEventsPollQuerySchema,
    },
    responses: {
      200: {
        description:
          'Incremental polling result. Invalid query timestamps currently return a graceful payload instead of a 4xx.',
        content: {
          'application/json': {
            schema: registeredEventsPollResultSchema,
          },
        },
      },
    },
  })
}
