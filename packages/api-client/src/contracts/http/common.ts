import {
  extendZodWithOpenApi,
  type OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

// Story 0.9 Task 2 step 1 owner:
// define reusable HTTP primitives here before endpoint-specific contracts exist.
//
// Why this step matters:
// every later contract module reuses these building blocks, so shared shapes like timestamps,
// "ok" statuses, tracked responses, and error envelopes stay consistent across validation,
// OpenAPI, and generated SDKs.
export const isoTimestampSchema = z.string().datetime()
export const nonEmptyStringSchema = z.string().min(1)
export const okStatusSchema = z.literal('ok')
export const unknownObjectSchema = z.record(z.string(), z.unknown())
export const trackedResponseSchema = z.object({
  tracked: z.literal(true),
})

export const apiErrorSchema = z.object({
  error: nonEmptyStringSchema,
})

export const badRequestHttpErrorSchema = z.object({
  statusCode: z.literal(400),
  message: nonEmptyStringSchema,
  error: z.literal('Bad Request'),
})

export const unauthorizedHttpErrorSchema = z.object({
  statusCode: z.literal(401),
  message: nonEmptyStringSchema,
  error: z.literal('Unauthorized'),
})

export const forbiddenHttpErrorSchema = z.object({
  statusCode: z.literal(403),
  message: nonEmptyStringSchema,
  error: z.literal('Forbidden'),
})

export const notFoundHttpErrorSchema = z.object({
  statusCode: z.literal(404),
  message: nonEmptyStringSchema,
  error: z.literal('Not Found'),
})

export function registerCommonHttpSchemas(registry: OpenAPIRegistry) {
  registry.register('ApiError', apiErrorSchema)
  registry.register('TrackedResponse', trackedResponseSchema)
  registry.register('BadRequestHttpError', badRequestHttpErrorSchema)
  registry.register('UnauthorizedHttpError', unauthorizedHttpErrorSchema)
  registry.register('ForbiddenHttpError', forbiddenHttpErrorSchema)
  registry.register('NotFoundHttpError', notFoundHttpErrorSchema)
}
