// Step 13 step 3 owner: searchable owner anchor
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { registerCommonHttpSchemas } from './common'
import { registerEventsContracts } from './events'
import { registerHealthContracts } from './health'

export const HTTP_OPENAPI_OUTPUT_FILENAME = 'http.openapi.json'

// Story 0.9 Task 2 step 4 owner:
// compose every contract slice into one canonical OpenAPI registry and document here.
//
// Why this step matters:
// this is the bridge from many local Zod schemas to one published API contract file that SDKs,
// CI checks, and documentation tools can all consume consistently.
extendZodWithOpenApi(z)

export function createHttpOpenApiRegistry() {
  const registry = new OpenAPIRegistry()

  registerCommonHttpSchemas(registry)
  registerHealthContracts(registry)
  registerEventsContracts(registry)

  return registry
}

export function generateHttpOpenApiDocument() {
  const registry = createHttpOpenApiRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CoutureCast HTTP API',
      version: '0.1.0',
      description: 'Canonical HTTP contracts shared across API, web, mobile, and tests.',
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development server',
      },
    ],
  })
}
