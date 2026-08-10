// Step 13 step 3 owner: searchable owner anchor
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { registerAlertsContracts } from './alerts'
import { registerAuthContracts } from './auth'
import { registerCommonHttpSchemas } from './common'
import { registerEventsContracts } from './events'
import { registerGuardianContracts } from './guardian'
import { registerHealthContracts } from './health'
import { registerLocationsContracts } from './locations'
import { registerModerationContracts } from './moderation'
import { registerUserContracts } from './user'
import { registerWeatherContracts } from './weather'
import { registerRitualContracts } from './ritual'
import { registerComfortContracts } from './comfort'
import { registerWardrobeContracts } from './wardrobe'

export const HTTP_OPENAPI_OUTPUT_FILENAME = 'http.openapi.json'

function preserveNullableEnumValues(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) preserveNullableEnumValues(item)
    return
  }
  if (!value || typeof value !== 'object') return

  const schema = value as Record<string, unknown>
  if (
    Array.isArray(schema.type) &&
    schema.type.includes('null') &&
    Array.isArray(schema.enum) &&
    !schema.enum.includes(null)
  ) {
    schema.enum.push(null)
  }
  for (const child of Object.values(schema)) preserveNullableEnumValues(child)
}

// Story 0.9 Task 2 step 4 owner:
// compose every contract slice into one canonical OpenAPI registry and document here.
//
// Why this step matters:
// this is the bridge from many local Zod schemas to one published API contract file that SDKs,
// CI checks, and documentation tools can all consume consistently.
extendZodWithOpenApi(z)

export function createHttpOpenApiRegistry() {
  const registry = new OpenAPIRegistry()

  const commonSchemas = registerCommonHttpSchemas(registry)
  registerAlertsContracts(registry, commonSchemas)
  registerAuthContracts(registry, commonSchemas)
  registerHealthContracts(registry)
  registerEventsContracts(registry, commonSchemas)
  registerGuardianContracts(registry, commonSchemas)
  registerLocationsContracts(registry, commonSchemas)
  registerModerationContracts(registry, commonSchemas)
  registerUserContracts(registry, commonSchemas)
  registerWeatherContracts(registry, commonSchemas)
  registerRitualContracts(registry, commonSchemas)
  registerComfortContracts(registry, commonSchemas)
  registerWardrobeContracts(registry, commonSchemas)

  return registry
}

export function generateHttpOpenApiDocument() {
  const registry = createHttpOpenApiRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CoutureCast HTTP API',
      // 1.0.0 marks the point where the published contract is treated as stable
      // and gated accordingly. The major bump is also what lets Optic accept the
      // one-time response-schema narrowing in this change: `breaking-changes`
      // defaults to `skip_when_major_version_changes`, which is the mechanism
      // intended for exactly this, rather than an operation-level exemption.
      version: '1.0.0',
      description: 'Canonical HTTP contracts shared across API, web, mobile, and tests.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development server',
      },
    ],
  })
  preserveNullableEnumValues(document)
  return document
}
