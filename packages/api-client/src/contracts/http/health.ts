import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  isoTimestampSchema,
  nonEmptyStringSchema,
  okStatusSchema,
  unknownObjectSchema,
} from './common'

// Story 0.9 Task 2 step 2 owner:
// model the first health endpoints here so the pattern is proven on a small real API slice.
//
// Why this step matters:
// health endpoints are simple enough to teach the contract flow clearly, but still real enough
// to prove that shared Zod schemas can drive both runtime validation and OpenAPI path registration.
export const apiHealthResponseSchema = z.object({
  status: okStatusSchema,
  service: z.literal('couturecast-api'),
  environment: nonEmptyStringSchema,
  gitSha: nonEmptyStringSchema,
  gitBranch: nonEmptyStringSchema,
  deployUrl: z.string().url().optional(),
  timestamp: isoTimestampSchema,
})

export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>

export const queueHealthResponseSchema = z.object({
  status: okStatusSchema,
  queues: z.array(nonEmptyStringSchema),
  metrics: unknownObjectSchema,
})

export type QueueHealthResponse = z.infer<typeof queueHealthResponseSchema>

export function registerHealthContracts(registry: OpenAPIRegistry) {
  registry.register('ApiHealthResponse', apiHealthResponseSchema)
  registry.register('QueueHealthResponse', queueHealthResponseSchema)

  registry.registerPath({
    method: 'get',
    path: '/api/health',
    tags: ['health'],
    summary: 'API health metadata for smoke tests and preview waiters',
    responses: {
      200: {
        description: 'API deployment metadata returned successfully',
        content: {
          'application/json': {
            schema: apiHealthResponseSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/health/queues',
    tags: ['health'],
    summary: 'Queue health snapshot',
    responses: {
      200: {
        description: 'Configured queue names returned successfully',
        content: {
          'application/json': {
            schema: queueHealthResponseSchema,
          },
        },
      },
    },
  })
}
