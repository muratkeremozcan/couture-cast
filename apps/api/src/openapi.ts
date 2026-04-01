import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export const OPENAPI_DOCS_ROUTE = '/api/docs'
export const OPENAPI_JSON_ROUTE = '/api/v1/openapi.json'

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

function buildOpenApiConfig() {
  // Story 0.9 Task 1 step 2 owner:
  // build the shared Swagger/OpenAPI assembly helper in this file.
  //
  // OpenAPI generation happens after Nest has created the application object.
  //
  // Full Task 1 flow:
  // 1) Controller/handler decorators such as @Controller, @Get, @ApiTags, and @ApiOkResponse
  //    attach metadata to classes and methods when the modules are loaded.
  // 2) NestFactory.create(AppModule) builds the route graph from that metadata.
  // 3) SwaggerModule.createDocument(app, config) walks the registered routes and the
  //    Swagger-specific metadata to produce one OpenAPI document for the whole app.
  //
  // This file is the "assemble and expose the docs" step; it does not define endpoints.
  const config = new DocumentBuilder()
    // DocumentBuilder sets top-level API metadata that appears in the generated spec and UI.
    .setTitle('CoutureCast API')
    .setDescription('Weather-intelligent outfit recommendation API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  return config
}

function createOpenApiDocument(app: INestApplication) {
  const config = buildOpenApiConfig()

  // 3) SwaggerModule.createDocument(app, config) walks the registered routes and the
  //    Swagger-specific metadata to produce one OpenAPI document for the whole app.
  return SwaggerModule.createDocument(app, config)
}

export function configureOpenApi(app: INestApplication) {
  const document = createOpenApiDocument(app)

  // Expose both human and machine entry points:
  // - /api/docs renders Swagger UI for developers
  // - /api/v1/openapi.json returns the raw spec for SDK generation and CI checks
  SwaggerModule.setup(OPENAPI_DOCS_ROUTE, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_ROUTE,
  })
}
