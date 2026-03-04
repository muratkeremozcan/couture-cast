#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const WEB_TSCONFIG_PATH = path.join(repoRoot, 'apps/web/tsconfig.json')
const WEB_PACKAGE_JSON_PATH = path.join(repoRoot, 'apps/web/package.json')
const API_CLIENT_PACKAGE_JSON_PATH = path.join(
  repoRoot,
  'packages/api-client/package.json'
)
const WEB_SRC_ROOT = path.join(repoRoot, 'apps/web/src')

const API_CLIENT_ALIAS = '@couture/api-client'
const REQUIRED_RUNTIME_DEPS = ['zod']
const EXPECTED_PATH_ALIAS = '../../packages/api-client/src/index.ts'
const EXPECTED_GLOB_ALIAS = '../../packages/api-client/src/*'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function collectSourceFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return []

  const files = []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath))
      continue
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

function findAliasImports(filePaths, aliasName) {
  const importRegex = new RegExp(
    String.raw`['"]${aliasName.replace('/', '\\/')}(?:\/[^'"]*)?['"]`,
    'g'
  )

  const matches = []
  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, 'utf8')
    if (importRegex.test(content)) {
      matches.push(path.relative(repoRoot, filePath))
    }
  }

  return matches
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function main() {
  const failures = []
  const warnings = []

  const webTsConfig = readJson(WEB_TSCONFIG_PATH)
  const webPackageJson = readJson(WEB_PACKAGE_JSON_PATH)
  const apiClientPackageJson = readJson(API_CLIENT_PACKAGE_JSON_PATH)

  const tsPaths = webTsConfig?.compilerOptions?.paths ?? {}
  const mainAliasTargets = toArray(tsPaths[API_CLIENT_ALIAS])
  const globAliasTargets = toArray(tsPaths[`${API_CLIENT_ALIAS}/*`])

  if (!mainAliasTargets.includes(EXPECTED_PATH_ALIAS)) {
    failures.push(
      [
        `Missing or invalid tsconfig path alias for "${API_CLIENT_ALIAS}".`,
        `Expected target: "${EXPECTED_PATH_ALIAS}"`,
        `Found targets: ${
          mainAliasTargets.length > 0 ? mainAliasTargets.join(', ') : '(none)'
        }`,
      ].join('\n')
    )
  }

  if (!globAliasTargets.includes(EXPECTED_GLOB_ALIAS)) {
    failures.push(
      [
        `Missing or invalid tsconfig glob alias for "${API_CLIENT_ALIAS}/*".`,
        `Expected target: "${EXPECTED_GLOB_ALIAS}"`,
        `Found targets: ${
          globAliasTargets.length > 0 ? globAliasTargets.join(', ') : '(none)'
        }`,
      ].join('\n')
    )
  }

  const sourceFiles = collectSourceFiles(WEB_SRC_ROOT)
  const aliasImportFiles = findAliasImports(sourceFiles, API_CLIENT_ALIAS)

  if (aliasImportFiles.length > 0) {
    const webRuntimeDeps = webPackageJson.dependencies ?? {}
    const apiClientDeps = apiClientPackageJson.dependencies ?? {}

    for (const dependencyName of REQUIRED_RUNTIME_DEPS) {
      if (!apiClientDeps[dependencyName]) {
        warnings.push(
          [
            `Required dependency "${dependencyName}" is not declared in packages/api-client/package.json.`,
            'The guard list may need to be updated if api-client internals changed.',
          ].join('\n')
        )
      }

      if (!webRuntimeDeps[dependencyName]) {
        failures.push(
          [
            `apps/web imports "${API_CLIENT_ALIAS}" but is missing runtime dependency "${dependencyName}".`,
            `Add "${dependencyName}" to apps/web/package.json dependencies.`,
            `Importing files (${aliasImportFiles.length}):`,
            ...aliasImportFiles.map((filePath) => `- ${filePath}`),
          ].join('\n')
        )
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(
      ['[dependency-boundary] warnings:', ...warnings.map((w) => `\n${w}`)].join('\n')
    )
  }

  if (failures.length > 0) {
    console.error(
      ['[dependency-boundary] failed checks:', ...failures.map((f) => `\n${f}`)].join(
        '\n'
      )
    )
    process.exit(1)
  }

  if (aliasImportFiles.length === 0) {
    console.log(
      `[dependency-boundary] no "${API_CLIENT_ALIAS}" imports found under apps/web/src; checks passed`
    )
    return
  }

  console.log(
    [
      '[dependency-boundary] checks passed',
      `- alias: ${API_CLIENT_ALIAS}`,
      `- importing files: ${aliasImportFiles.length}`,
      `- enforced runtime deps: ${REQUIRED_RUNTIME_DEPS.join(', ')}`,
    ].join('\n')
  )
}

main()
