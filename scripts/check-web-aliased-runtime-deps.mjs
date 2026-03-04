#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const webTsconfigPath = path.join(repoRoot, 'apps/web/tsconfig.json')
const webPackagePath = path.join(repoRoot, 'apps/web/package.json')
const apiClientSrcDir = path.join(repoRoot, 'packages/api-client/src')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function collectSourceFiles(dirPath) {
  const files = []
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function normalizePackageName(specifier) {
  if (!specifier) return null
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('@couture/')
  ) {
    return null
  }
  if (/^[a-zA-Z]+:/.test(specifier)) return null

  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    if (!scope || !name) return specifier
    return `${scope}/${name}`
  }

  const [name] = specifier.split('/')
  return name || null
}

function collectExternalRuntimeImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imports = new Set()

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.add(node.moduleSpecifier.text)
      }
    }

    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.add(node.moduleSpecifier.text)
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.add(node.arguments[0].text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

const webTsconfig = readJson(webTsconfigPath)
const aliasPaths = webTsconfig?.compilerOptions?.paths ?? {}
const aliasTargets = [
  ...(aliasPaths['@couture/api-client'] ?? []),
  ...(aliasPaths['@couture/api-client/*'] ?? []),
]

const usesAliasedApiClientSource = aliasTargets.some(
  (target) => typeof target === 'string' && target.includes('packages/api-client/src')
)

if (!usesAliasedApiClientSource) {
  console.log('web alias to packages/api-client/src is not active; dependency isolation check skipped.')
  process.exit(0)
}

const webPackageJson = readJson(webPackagePath)
const declaredRuntimeDeps = new Set([
  ...Object.keys(webPackageJson.dependencies ?? {}),
  ...Object.keys(webPackageJson.optionalDependencies ?? {}),
  ...Object.keys(webPackageJson.peerDependencies ?? {}),
])

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const externalImports = new Set()

for (const sourceFile of collectSourceFiles(apiClientSrcDir)) {
  for (const specifier of collectExternalRuntimeImports(sourceFile)) {
    const packageName = normalizePackageName(specifier)
    if (!packageName || builtins.has(packageName)) continue
    externalImports.add(packageName)
  }
}

const missingRuntimeDeps = [...externalImports].filter((dep) => !declaredRuntimeDeps.has(dep)).sort()

if (missingRuntimeDeps.length > 0) {
  console.error('apps/web is missing runtime dependencies required by aliased packages/api-client/src:')
  for (const dep of missingRuntimeDeps) {
    console.error(`- ${dep}`)
  }
  console.error('Add them to apps/web/package.json dependencies to keep deployment/runtime isolation explicit.')
  process.exit(1)
}

console.log('apps/web dependency isolation check passed for aliased packages/api-client/src imports.')
