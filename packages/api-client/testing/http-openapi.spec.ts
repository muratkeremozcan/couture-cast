// Step 15 step 5 owner: searchable owner anchor
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SwaggerParser from '@apidevtools/swagger-parser'
import { expect, test } from 'vitest'
import {
  generateHttpOpenApiDocument,
  HTTP_OPENAPI_OUTPUT_FILENAME,
} from '../src/contracts/http/openapi'

// Story 0.9 Task 2 step 6 owner:
// prove here that the generated document is valid OpenAPI and contains the initial migrated slice.
//
// Why this step matters:
// SDK generation should depend on a validated contract, not on hope. This test is the quality gate
// that catches broken registration or invalid schema output before the spec is reused elsewhere.
test('writes a valid HTTP OpenAPI document for the initial contract slice', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'couture-http-openapi-'))

  try {
    const spec = generateHttpOpenApiDocument()
    const outputPath = join(outputDir, HTTP_OPENAPI_OUTPUT_FILENAME)
    writeFileSync(outputPath, JSON.stringify(spec, null, 2))

    const savedSpec = JSON.parse(readFileSync(outputPath, 'utf8')) as typeof spec

    await SwaggerParser.validate(
      savedSpec as unknown as Parameters<typeof SwaggerParser.validate>[0]
    )

    expect(savedSpec.openapi).toBe('3.1.0')
    expect(savedSpec.paths).toBeDefined()

    const paths = savedSpec.paths
    if (!paths) {
      throw new Error('Expected generated OpenAPI spec to contain paths')
    }

    expect(paths['/api/health']).toBeDefined()
    expect(paths['/api/v1/auth/signup']).toBeDefined()
    expect(paths['/api/v1/auth/signup']?.post).toBeDefined()
    expect(paths['/api/v1/auth/signup']?.post?.summary).toBe(
      'Create an account with age verification'
    )
    expect(paths['/api/v1/auth/signup']?.post?.responses?.['201']).toBeDefined()
    expect(paths['/api/v1/auth/guardian-consent']).toBeDefined()
    expect(paths['/api/v1/health/queues']).toBeDefined()
    expect(paths['/api/v1/events/poll']).toBeDefined()
    expect(paths['/api/v1/moderation/actions']).toBeDefined()
    expect(paths['/api/v1/user/profile']).toBeDefined()
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('keeps the checked-in canonical HTTP OpenAPI document in sync with the builder output', () => {
  const spec = generateHttpOpenApiDocument()
  const checkedInSpec = JSON.parse(
    readFileSync(join(process.cwd(), 'docs', HTTP_OPENAPI_OUTPUT_FILENAME), 'utf8')
  ) as typeof spec

  expect(checkedInSpec).toEqual(spec)
})
