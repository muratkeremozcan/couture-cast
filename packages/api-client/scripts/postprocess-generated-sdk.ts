#!/usr/bin/env node
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format, resolveConfig } from 'prettier'

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
// The same document `openapitools.json` hands the generator as `inputSpec`. Reading it back is
// what keeps the nullability pass below driven by the contract instead of by a list of field
// names that silently stops covering the spec the day someone adds a field to it.
const openApiSpecPath = resolve(packageRoot, 'docs/http.openapi.json')

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

function strengthenWeatherHourlyArrayTypes() {
  const source = readFileSync(generatedModelsIndexPath, 'utf8')
  const helper = [
    'export type FixedLengthArray<T, L extends number, Acc extends T[] = []> =',
    `  Acc[${JSON.stringify('length')}] extends L ? Acc : FixedLengthArray<T, L, [...Acc, T]>;`,
    '',
    '',
  ].join('\n')
  const helperAlreadyExists = source.includes('export type FixedLengthArray')
  const withHelper = helperAlreadyExists
    ? source
    : source.replace(/(\/\* eslint-disable \*\/\n)/u, `$1${helper}`)
  if (!helperAlreadyExists && withHelper === source) {
    throw new Error(
      `Unable to insert FixedLengthArray helper into ${generatedModelsIndexPath}`
    )
  }
  const normalizedSource = withHelper.replace(
    /hourly: Array<WeatherSnapshotHourlyInner>/gu,
    'hourly: FixedLengthArray<WeatherSnapshotHourlyInner, 48>'
  )

  writeFileSync(generatedModelsIndexPath, normalizedSource)
}

type JsonRecord = Record<string, unknown>

type NullableObjectProperty = {
  nullable: boolean
  specPath: string
}

type GeneratedProperty = {
  indent: string
  name: string
  optional: boolean
  declaredType: string
  terminator: string
  lineIndex: number
}

type GeneratedInterface = {
  name: string
  properties: GeneratedProperty[]
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSchemaTypeNames(node: unknown): string[] {
  if (!isJsonRecord(node)) {
    return []
  }

  const { type } = node
  if (typeof type === 'string') {
    return [type]
  }

  return Array.isArray(type)
    ? type.filter((name): name is string => typeof name === 'string')
    : []
}

// The join key between an OpenAPI object schema and the interface the generator emitted for it.
// Model names cannot be used: the generator invents them for inline schemas and then dedupes
// structurally identical ones, so `CommunityFeed.authorStates[]` and the identical array under
// `CommunityFeedResponse.data` collapse onto one name that neither path predicts. The property
// list does survive generation intact, names, order and optionality alike.
function readPropertyShapeKey(propertyNames: string[], optionalNames: Set<string>) {
  return JSON.stringify(
    propertyNames.map((name) => (optionalNames.has(name) ? `${name}?` : name))
  )
}

function collectNullableObjectPropertiesFromSpec() {
  const spec = JSON.parse(readFileSync(openApiSpecPath, 'utf8')) as unknown
  const byShapeKey = new Map<string, Map<string, NullableObjectProperty>>()

  function visit(node: unknown, specPath: string) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        visit(entry, `${specPath}[${index}]`)
      })
      return
    }

    if (!isJsonRecord(node)) {
      return
    }

    const { properties } = node
    if (isJsonRecord(properties)) {
      const requiredNames = new Set(
        Array.isArray(node.required)
          ? node.required.filter((name): name is string => typeof name === 'string')
          : []
      )
      const propertyNames = Object.keys(properties)
      const optionalNames = new Set(
        propertyNames.filter((name) => !requiredNames.has(name))
      )
      const shapeKey = readPropertyShapeKey(propertyNames, optionalNames)
      const shape = byShapeKey.get(shapeKey) ?? new Map<string, NullableObjectProperty>()
      byShapeKey.set(shapeKey, shape)

      for (const name of propertyNames) {
        const typeNames = readSchemaTypeNames(properties[name])

        // Only object-typed unions are collected. The generator renders a scalar
        // `["string", "null"]` correctly, so scalars need no repair, and leaving them out keeps a
        // scalar `material` in one schema from being compared against an object `material` in an
        // unrelated schema that happens to share a property shape.
        if (!typeNames.includes('object')) {
          continue
        }

        const nullable = typeNames.includes('null')
        const propertyPath = `${specPath}.properties.${name}`
        const known = shape.get(name)

        if (known && known.nullable !== nullable) {
          throw new Error(
            `Cannot decide whether \`${name}\` is nullable: ${known.specPath} and ${propertyPath} ` +
              'have the same property shape but disagree, so both map onto one generated ' +
              'interface. Give one of the two schemas a distinguishing property.'
          )
        }

        if (!known) {
          shape.set(name, { nullable, specPath: propertyPath })
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      visit(value, `${specPath}.${key}`)
    }
  }

  visit(spec, '$')

  return byShapeKey
}

function readGeneratedModelInterfaces(lines: string[]) {
  const interfaces: GeneratedInterface[] = []
  let openInterface: GeneratedInterface | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    const interfaceMatch = /^export interface (\w+) \{$/u.exec(line)

    if (interfaceMatch) {
      openInterface = { name: interfaceMatch[1] ?? '', properties: [] }
      continue
    }

    if (openInterface === null) {
      continue
    }

    if (line === '}') {
      interfaces.push(openInterface)
      openInterface = null
      continue
    }

    // Property lines only. Doc-comment lines start with `*`, so they never match.
    const propertyMatch = /^(\s+)(\w+)(\??): (.*?)(;?)$/u.exec(line)
    if (propertyMatch) {
      openInterface.properties.push({
        indent: propertyMatch[1] ?? '',
        name: propertyMatch[2] ?? '',
        optional: propertyMatch[3] === '?',
        declaredType: propertyMatch[4] ?? '',
        terminator: propertyMatch[5] ?? '',
        lineIndex,
      })
    }
  }

  return interfaces
}

// openapi-generator-cli 7.21.0 drops the `null` member of an OpenAPI 3.1 `type: [..., "null"]`
// union whenever the node is an object, while handling the identical union correctly for scalars.
// The result compiles, so nothing downstream complains: a consumer reads
// `feed.activeChallenge.title` unchallenged by the compiler and crashes on the ordinary
// no-challenge response. This pass puts the `| null` back, reading the OpenAPI document to decide
// which properties get it, and throws rather than skipping when a nullable node cannot be located
// in the generated output.
function restoreNullableObjectPropertyTypes() {
  const nullableByShapeKey = collectNullableObjectPropertiesFromSpec()
  const lines = readFileSync(generatedModelsIndexPath, 'utf8').split('\n')
  const interfacesByShapeKey = new Map<string, GeneratedInterface[]>()

  for (const generatedInterface of readGeneratedModelInterfaces(lines)) {
    const propertyNames = generatedInterface.properties.map((property) => property.name)
    const optionalNames = new Set(
      generatedInterface.properties
        .filter((property) => property.optional)
        .map((property) => property.name)
    )
    const shapeKey = readPropertyShapeKey(propertyNames, optionalNames)
    const shared = interfacesByShapeKey.get(shapeKey) ?? []

    shared.push(generatedInterface)
    interfacesByShapeKey.set(shapeKey, shared)
  }

  const restored: string[] = []

  for (const [shapeKey, shape] of nullableByShapeKey) {
    for (const [propertyName, { nullable, specPath }] of shape) {
      if (!nullable) {
        continue
      }

      const matchingInterfaces = interfacesByShapeKey.get(shapeKey) ?? []
      if (matchingInterfaces.length === 0) {
        throw new Error(
          `${specPath} is a nullable object, but no generated interface carries its property ` +
            'shape, so its `| null` cannot be restored and the SDK would type the field as ' +
            `always present. The generator's model shape has changed; update ${__filename}.`
        )
      }

      for (const generatedInterface of matchingInterfaces) {
        const property = generatedInterface.properties.find(
          (entry) => entry.name === propertyName
        )

        if (!property) {
          throw new Error(
            `${generatedInterface.name} matched the property shape of ${specPath} but has no ` +
              `\`${propertyName}\` property.`
          )
        }

        // Scalars, and any object the generator one day gets right on its own, already say `null`.
        if (/\bnull\b/u.test(property.declaredType)) {
          continue
        }

        const optionalMarker = property.optional ? '?' : ''
        lines[property.lineIndex] =
          `${property.indent}${property.name}${optionalMarker}: ${property.declaredType} | null${property.terminator}`
        restored.push(`${generatedInterface.name}.${propertyName}`)
      }
    }
  }

  writeFileSync(generatedModelsIndexPath, lines.join('\n'))

  return restored.sort()
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function stripGeneratedTslintComments() {
  for (const filePath of walkGeneratedTypeScriptFiles(generatedRoot)) {
    const source = readFileSync(filePath, 'utf8')
    const normalizedSource = source.replace(/^\/\* tslint:disable \*\/\n/, '')

    writeFileSync(filePath, normalizedSource)
  }
}

function removeUnusedModelTypeImportsFromGeneratedApis() {
  const apiFilePaths = readdirSync(apisRoot)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => resolve(apisRoot, fileName))

  for (const filePath of apiFilePaths) {
    const source = readFileSync(filePath, 'utf8')
    const modelImportMatch = source.match(
      /import type {\n([\s\S]*?)\n} from '\.\.\/models\/index';\n/
    )

    if (!modelImportMatch) {
      continue
    }

    const importBlock = modelImportMatch[1] ?? ''
    const importedNames = importBlock
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean)

    const sourceWithoutModelImport = source.replace(modelImportMatch[0], '')
    const usedNames = importedNames.filter((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`, 'u').test(sourceWithoutModelImport)
    )

    if (usedNames.length === importedNames.length) {
      continue
    }

    const replacement =
      usedNames.length === 0
        ? ''
        : `import type {\n${usedNames
            .map((name) => `  ${name},`)
            .join('\n')}\n} from '../models/index';\n`

    writeFileSync(filePath, source.replace(modelImportMatch[0], replacement))
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

async function formatGeneratedTypeScript() {
  const prettierOptions = await resolveConfig(packageRoot)

  for (const filePath of walkGeneratedTypeScriptFiles(generatedRoot)) {
    const source = readFileSync(filePath, 'utf8')
    const formattedSource = await format(source, {
      ...prettierOptions,
      filepath: filePath,
    })

    writeFileSync(filePath, formattedSource)
  }
}

async function main() {
  const apiClassNames = readGeneratedApiClassNames()

  if (apiClassNames.length === 0) {
    throw new Error(`No generated API classes found in ${apisRoot}`)
  }

  writeFileSync(generatedIndexPath, createGeneratedIndexSource())
  writeFileSync(defaultApiPath, createDefaultApiSource(apiClassNames))
  normalizeGeneratedModelsIndex()
  strengthenWeatherHourlyArrayTypes()
  const restoredNullableProperties = restoreNullableObjectPropertyTypes()
  stripGeneratedTslintComments()
  removeUnusedModelTypeImportsFromGeneratedApis()
  removeGeneratorNoise()
  await formatGeneratedTypeScript()

  console.log(`✅ Added DefaultApi compatibility wrapper for ${apiClassNames.join(', ')}`)
  console.log(
    `✅ Restored \`| null\` on ${restoredNullableProperties.length} nullable object properties: ${restoredNullableProperties.join(', ')}`
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
