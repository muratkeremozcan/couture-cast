import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { generateHttpOpenApiDocument } from '@couture/api-client/contracts/http'
import { Test } from '@nestjs/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { ApiHealthController } from './controllers/api-health.controller'
import { HealthController } from './controllers/health.controller'
import {
  configureOpenApi,
  isOpenApiEnabled,
  OPENAPI_DOCS_ROUTE,
  OPENAPI_JSON_ROUTE,
} from './openapi'

type OpenApiSpec = ReturnType<typeof generateHttpOpenApiDocument>

// Step 13 evidence:
// this file verifies the API-published contract surface itself, not just the package-level
// canonical builder.
// Story 0.9 Task 1 step 5 owner:
// prove /api/docs and /api/v1/openapi.json through an in-process integration test in this file.
//
// This is an in-process integration test:
// - we create a real Nest application from a testing module
// - we initialize Swagger against that app
// - we make HTTP requests with supertest against Nest's in-memory HTTP server
// - we close the app after each test
//
// It is not a full end-to-end test because we do not start a separate process or bind
// a real external port with `npm run start:api`.
describe('OpenAPI integration', () => {
  let app: INestApplication | undefined

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ApiHealthController, HealthController],
    }).compile()

    // createNestApplication() gives us a real Nest app instance for routing/middleware/docs.
    app = moduleFixture.createNestApplication()
    configureOpenApi(app)
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      // Close the Nest app so each test gets a clean application lifecycle.
      await app.close()
      app = undefined
    }
  })

  it('serves the canonical contract-derived document', async () => {
    // supertest talks to Nest's HTTP server directly, so this is a real HTTP request path.
    const server = app!.getHttpServer() as Parameters<typeof request>[0]
    const response = await request(server).get(OPENAPI_JSON_ROUTE)
    const spec = response.body as OpenApiSpec
    const canonicalSpec = generateHttpOpenApiDocument()
    const livePaths = spec.paths
    const canonicalPaths = canonicalSpec.paths

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(spec).toEqual(canonicalSpec)
    expect(livePaths).toBeDefined()
    expect(canonicalPaths).toBeDefined()

    if (!livePaths || !canonicalPaths) {
      throw new Error('Expected both live and canonical specs to define paths')
    }

    expect(livePaths['/api/health']).toEqual(canonicalPaths['/api/health'])
    expect(livePaths['/api/v1/health/queues']).toEqual(
      canonicalPaths['/api/v1/health/queues']
    )
    expect(livePaths['/api/v1/events/poll']).toEqual(
      canonicalPaths['/api/v1/events/poll']
    )
  })

  it('serves the Swagger UI', async () => {
    const server = app!.getHttpServer() as Parameters<typeof request>[0]
    const response = await request(server).get(OPENAPI_DOCS_ROUTE)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('Swagger UI')
  })

  it('disables OpenAPI by default in production unless explicitly enabled', () => {
    expect(isOpenApiEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(isOpenApiEnabled({ NODE_ENV: 'production', OPENAPI_ENABLED: 'true' })).toBe(
      true
    )
    expect(isOpenApiEnabled({ NODE_ENV: 'development', OPENAPI_ENABLED: 'false' })).toBe(
      false
    )
    expect(isOpenApiEnabled({ NODE_ENV: 'development' })).toBe(true)
  })
})
