#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Story 0.9 Task 3 step 3 owner:
// this file exists because the generator gets us close, but not all the way to the package shape
// the repo actually wants to publish.
//
// Problem solved here:
// 1. keep one stable generated index instead of whatever file layout the generator emits
// 2. add a DefaultApi compatibility wrapper so app code has a predictable surface
// 3. normalize OpenAPI 3.1 null typing that the generator does not currently handle cleanly
// 4. remove generator noise we do not want to check in or export
//
// Without this step, consumers would depend on unstable generator internals and the checked-in SDK
// would churn more than the underlying contract really changed.
const packageRoot = resolve(__dirname, '..')
const generatedRoot = resolve(packageRoot, 'src/generated')
const apisRoot = resolve(generatedRoot, 'apis')
const generatedIndexPath = resolve(generatedRoot, 'index.ts')
const defaultApiPath = resolve(generatedRoot, 'default-api.ts')
const generatedModelsIndexPath = resolve(generatedRoot, 'models/index.ts')

function readGeneratedApiClassNames() {
  return readdirSync(apisRoot)
    .filter((fileName) => fileName.endsWith('Api.ts'))
    .map((fileName) => fileName.replace(/\.ts$/, ''))
    .sort()
}

function createGeneratedIndexSource() {
  return `/* tslint:disable */
/* eslint-disable */
export * from './runtime';
export * from './apis/index';
export * from './models/index';
export * from './default-api';
`
}

function createDefaultApiSource(apiClassNames: string[]) {
  const imports = apiClassNames.map((name) => `  ${name},`).join('\n')
  const publicApiMixins = apiClassNames.map((name) => `PublicApi<${name}>`).join(', ')
  const constructors = apiClassNames.join(', ')

  return `/* tslint:disable */
/* eslint-disable */
import { BaseAPI, type Configuration } from './runtime';
import {
${imports}
} from './apis';

type PublicApi<T> = Pick<T, keyof T>;

function applyApiMixins(derivedCtor: typeof DefaultApi, baseCtors: Array<typeof BaseAPI>) {
  for (const baseCtor of baseCtors) {
    for (const propertyName of Object.getOwnPropertyNames(baseCtor.prototype)) {
      if (propertyName === 'constructor') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(baseCtor.prototype, propertyName);
      if (descriptor) {
        Object.defineProperty(derivedCtor.prototype, propertyName, descriptor);
      }
    }
  }
}

export interface DefaultApi extends ${publicApiMixins} {}

export class DefaultApi extends BaseAPI {
  constructor(configuration?: Configuration) {
    super(configuration);
  }
}

applyApiMixins(DefaultApi, [${constructors}]);
`
}

function normalizeGeneratedModelsIndex() {
  const source = readFileSync(generatedModelsIndexPath, 'utf8')
  const normalizedSource = source.replace(/\bNull\b/g, 'null')

  writeFileSync(generatedModelsIndexPath, normalizedSource)
}

function walkGeneratedTypeScriptFiles(currentDir: string): string[] {
  return readdirSync(currentDir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(currentDir, entry.name)

    if (entry.isDirectory()) {
      return walkGeneratedTypeScriptFiles(entryPath)
    }

    return entry.name.endsWith('.ts') ? [entryPath] : []
  })
}

function stripGeneratedTslintComments() {
  for (const filePath of walkGeneratedTypeScriptFiles(generatedRoot)) {
    const source = readFileSync(filePath, 'utf8')
    const normalizedSource = source.replace(/^\/\* tslint:disable \*\/\n/, '')

    writeFileSync(filePath, normalizedSource)
  }
}

function removeGeneratorNoise() {
  rmSync(resolve(generatedRoot, 'docs'), { recursive: true, force: true })
  rmSync(resolve(generatedRoot, '.openapi-generator'), {
    recursive: true,
    force: true,
  })
  rmSync(resolve(generatedRoot, '.openapi-generator-ignore'), { force: true })
}

const apiClassNames = readGeneratedApiClassNames()

if (apiClassNames.length === 0) {
  throw new Error(`No generated API classes found in ${apisRoot}`)
}

writeFileSync(generatedIndexPath, createGeneratedIndexSource())
writeFileSync(defaultApiPath, createDefaultApiSource(apiClassNames))
normalizeGeneratedModelsIndex()
stripGeneratedTslintComments()
removeGeneratorNoise()

console.log(`✅ Added DefaultApi compatibility wrapper for ${apiClassNames.join(', ')}`)
