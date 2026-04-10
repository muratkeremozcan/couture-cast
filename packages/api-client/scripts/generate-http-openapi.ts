#!/usr/bin/env node
// Step 13 step 4 owner: searchable owner anchor
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  generateHttpOpenApiDocument,
  HTTP_OPENAPI_OUTPUT_FILENAME,
} from '../src/contracts/http/openapi'

// Story 0.9 Task 2 step 5 owner:
// write the canonical OpenAPI document to disk here, without needing a running Nest server.
//
// Why this step matters:
// the build/test pipeline can now regenerate the contract from code alone, which keeps SDK
// generation and CI drift checks independent from local server bootstrapping.
const packageRoot = resolve(__dirname, '..')

export function writeHttpOpenApiDocument(outputDir = resolve(packageRoot, 'docs')) {
  const document = generateHttpOpenApiDocument()
  mkdirSync(outputDir, { recursive: true })

  const outputPath = resolve(outputDir, HTTP_OPENAPI_OUTPUT_FILENAME)
  writeFileSync(outputPath, JSON.stringify(document, null, 2))

  return outputPath
}

if (require.main === module) {
  const outputPath = writeHttpOpenApiDocument()
  console.log(`✅ Wrote ${outputPath}`)
}
