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
// "ok" statuses, and error envelopes stay consistent across validation, OpenAPI, and generated SDKs.
export const isoTimestampSchema = z.string().datetime()
export const nonEmptyStringSchema = z.string().min(1)
export const okStatusSchema = z.literal('ok')
export const unknownObjectSchema = z.record(z.string(), z.unknown())

export const apiErrorSchema = z.object({
  error: nonEmptyStringSchema,
})

export function registerCommonHttpSchemas(registry: OpenAPIRegistry) {
  registry.register('ApiError', apiErrorSchema)
}
