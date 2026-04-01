import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { apiHealthResponseSchema } from '../contracts/http'
import { resolveGitMetadata } from '../git-metadata'

/**
 * Machine-readable API health endpoint used by preview waiters and smoke tests.
 *
 * Why this file exists:
 * - The root API route returns a human string ("Hello World!"), which is useful
 *   for basic smoke checks but not for proving which deployment is live.
 * - Preview workflows need a JSON endpoint that reports status plus git
 *   metadata so they can wait for the exact PR commit before running E2E.
 */
@Controller('api')
// Story 0.9 Task 1 step 4 owner:
// attach Swagger metadata to this health endpoint so it appears in the generated OpenAPI doc.
//
// Swagger decorators do not change runtime behavior; they attach documentation metadata
// that SwaggerModule.createDocument() reads later when building the OpenAPI spec.
@ApiTags('health')
export class ApiHealthController {
  @Get('health')
  @ApiOperation({ summary: 'API health metadata for smoke tests and preview waiters' })
  @ApiOkResponse({ description: 'API deployment metadata returned successfully' })
  getHealth() {
    // Return enough deployment metadata for CI to answer:
    // "Is this API healthy?" and "Is it the commit we just pushed?"
    const { gitSha, gitBranch } = resolveGitMetadata()
    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
    const deployUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined

    return apiHealthResponseSchema.parse({
      status: 'ok',
      service: 'couturecast-api',
      environment,
      gitSha,
      gitBranch,
      deployUrl,
      timestamp: new Date().toISOString(),
    })
  }
}
