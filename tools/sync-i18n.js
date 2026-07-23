#!/usr/bin/env node

/**
 * Validates the mobile catalogs against the canonical supported-locale manifest and
 * verifies that every catalog has the same translation-key structure as en-US.
 */

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '..')
const localesDirectory = path.join(projectRoot, 'apps/mobile/assets/locales')
const localeManifestPath = path.join(
  projectRoot,
  'packages/api-client/src/contracts/http/supported-locales.json'
)
const sourceLocale = 'en-US'

function getDeepKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child)
      ? getDeepKeys(child, childPath)
      : [childPath]
  })
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listLocaleNames() {
  return fs
    .readdirSync(localesDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => path.basename(fileName, '.json'))
    .sort()
}

function printList(label, values) {
  if (values.length === 0) {
    return
  }
  console.error(`${label}:`)
  for (const value of values) {
    console.error(`  - ${value}`)
  }
}

function runSyncCheck() {
  const manifest = readJson(localeManifestPath)
  const expectedLocales = Object.keys(manifest).sort()
  const discoveredLocales = listLocaleNames()
  const missingLocales = expectedLocales.filter(
    (locale) => !discoveredLocales.includes(locale)
  )
  const extraLocales = discoveredLocales.filter(
    (locale) => !expectedLocales.includes(locale)
  )

  printList('Missing locale catalogs', missingLocales)
  printList('Unexpected locale catalogs', extraLocales)

  const sourceData = readJson(path.join(localesDirectory, `${sourceLocale}.json`))
  const sourceKeys = getDeepKeys(sourceData).sort()
  let hasErrors = missingLocales.length > 0 || extraLocales.length > 0

  for (const locale of expectedLocales) {
    if (locale === sourceLocale || missingLocales.includes(locale)) {
      continue
    }

    const targetData = readJson(path.join(localesDirectory, `${locale}.json`))
    const targetKeys = getDeepKeys(targetData).sort()
    const missingKeys = sourceKeys.filter((key) => !targetKeys.includes(key))
    const extraKeys = targetKeys.filter((key) => !sourceKeys.includes(key))

    if (missingKeys.length === 0 && extraKeys.length === 0) {
      console.log(`[PASS] ${locale}: catalog structure matches ${sourceLocale}`)
      continue
    }

    hasErrors = true
    console.error(`[FAIL] ${locale}: catalog structure differs from ${sourceLocale}`)
    printList('  Missing keys', missingKeys)
    printList('  Extra keys', extraKeys)
  }

  if (hasErrors) {
    console.error('Locale catalog validation failed.')
    process.exitCode = 1
    return
  }

  console.log(
    `Locale catalog validation passed for ${expectedLocales.length} supported locales.`
  )
}

try {
  runSyncCheck()
} catch (error) {
  console.error(
    'Locale catalog validation failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
}
