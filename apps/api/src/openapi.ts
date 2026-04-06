import type { INestApplication } from '@nestjs/common'
import { generateHttpOpenApiDocument } from '@couture/api-client/contracts/http'
import type { OpenAPIObject } from '@nestjs/swagger'
import { SwaggerModule } from '@nestjs/swagger'

export const OPENAPI_DOCS_ROUTE = '/api/docs'
export const OPENAPI_JSON_ROUTE = '/api/v1/openapi.json'

// Step 13 evidence:
// this file is the API-boundary publication seam for the OpenAPI contract.
//
// Swagger remains only as the UI shell. The contract itself must come from the shared Zod-first
// builder so /api/docs and /api/v1/openapi.json stay on one canonical document.
export function isOpenApiEnabled(env: NodeJS.ProcessEnv): boolean {
  const override = env.OPENAPI_ENABLED?.trim().toLowerCase()

  if (
    override === 'true' ||
    override === '1' ||
    override === 'yes' ||
    override === 'on'
  ) {
    return true
  }

  if (
    override === 'false' ||
    override === '0' ||
    override === 'no' ||
    override === 'off'
  ) {
    return false
  }

  return env.NODE_ENV !== 'production'
}

function createCanonicalOpenApiDocument(): OpenAPIObject {
  // `zod-to-openapi` models `paths` as optional in its shared OpenAPI 3.1 type, while Nest's
  // Swagger UI helper expects the narrower Swagger `OpenAPIObject`. The generated document always
  // includes `paths`, so this cast is the publication boundary normalization.
  return generateHttpOpenApiDocument() as unknown as OpenAPIObject
}

export function configureOpenApi(app: INestApplication) {
  const document = createCanonicalOpenApiDocument()

  // Step 13 evidence:
  // these are the two API-facing views of the contract surface:
  // - raw machine-readable JSON
  // - human-friendly docs UI
  // Both now read from the same Zod-generated contract output. Existing Nest Swagger decorators
  // are migration scaffolding only and must not become the source of truth for new REST endpoints.
  SwaggerModule.setup(OPENAPI_DOCS_ROUTE, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_ROUTE,
  })
}
