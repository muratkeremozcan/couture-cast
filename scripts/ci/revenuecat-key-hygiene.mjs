// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Where a RevenueCat Test Store key may live (story 6.15 D15, TEA-20). The SDK crashes on purpose
// when a Test Store key runs in a release build, so the key belongs to local and test builds only:
// - Every EAS build profile other than `development`, today's and any added later (the spec names
//   `production-simulator` and preview), resolves no Test Store key: its env, `extends` chain
//   included, names neither the Test Store variable nor any `test_` RevenueCat key; it does not
//   pull the EAS `development` environment; and it is not a debug build (development client,
//   Debug Gradle command or Debug iOS configuration), where `__DEV__` would select the key.
// - The env files a release build loads hold no Test Store key. app.config.ts loads `.env.local`,
//   then `.env.prod` when NODE_ENV is production (every Release export, laptop Gradle builds
//   included) or `.env.preview` for every other NODE_ENV (development runs and the preview
//   export), then `.env` from the repository root; Expo loads `.env.<NODE_ENV>[.local]`,
//   `.env.local` and `.env` from apps/mobile. A file only a production or preview export loads
//   must not name the Test Store variable at all. A file development runs also load may hold it
//   in its own variable for local debug runs: revenueCatKeyEnv reads it only under `__DEV__`, and
//   revenuecat-bundle-scan.mjs proves the production and preview exports drop it. A RevenueCat
//   platform-key variable never holds a `test_` key anywhere, since those are inlined into every
//   bundle.
// Findings name the file or profile and the variable only; a key is never printed.
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { expand } from 'dotenv-expand'

export const TEST_STORE_KEY_VARIABLE = 'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY'
export const DEVELOPMENT_PROFILE = 'development'
const REVENUECAT_VARIABLE = /REVENUECAT/
/**
 * A RevenueCat Test Store key as it would appear inlined in a file. No boundary is required before
 * it: Hermes packs its string table without separators, so an inlined key can follow any
 * character. A clean export has no match (2026-11-13, SDK 54 production export, all platforms).
 */
export const TEST_KEY_PATTERN = /test_[A-Za-z0-9]{16,}/

/**
 * The env files app.config.ts loads from the repository root, by scope: `release` files load only
 * for a release export, `shared` files for development runs too.
 */
export const ROOT_ENV_FILES = {
  '.env.local': 'shared',
  '.env.prod': 'release',
  '.env.preview': 'shared',
  '.env': 'shared',
}

/** The scope of an env file Expo loads from apps/mobile, or undefined when Expo never loads it. */
export function mobileEnvFileScope(name) {
  if (name === '.env' || name === '.env.local') return 'shared'
  if (/^\.env\.(production|preview)(\.local)?$/.test(name)) return 'release'
  if (/^\.env\.(development|test)(\.local)?$/.test(name)) return 'debug'
  return undefined
}

function parseEnvFile(file) {
  return dotenv.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * Every assignment of a dotenv file as `[name, value]`, read the way Expo's `@expo/env` reads it:
 * dotenv parses the file, so `NAME: value`, `export NAME=value` and quoted or multi-line values
 * count exactly as they would at build time, and dotenv-expand then resolves `${NAME}` and `$NAME`
 * references (story 6.15 r38 P3-2), so a key assembled from shorter variables is seen whole.
 * `context` holds the variables of the other env files a build loads beside this one; Expo
 * expands across its loaded files, so a reference may resolve to one of them. The file's own
 * assignments win over `context`, and the caller's process environment is never read.
 */
export function readEnvEntries(file, context = {}) {
  const parsed = parseEnvFile(file)
  const processEnv = { ...context }
  for (const name of Object.keys(parsed)) delete processEnv[name]
  return Object.entries(expand({ parsed: { ...parsed }, processEnv }).parsed)
}

function mergeProfile(parent, child) {
  const merged = { ...parent }
  for (const [key, value] of Object.entries(child)) {
    if (key === 'extends') continue
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? mergeProfile(parent[key] ?? {}, value)
        : value
  }
  return merged
}

/** A build profile with its `extends` chain applied, as EAS merges it, or undefined. */
export function resolveBuildProfile(eas, name, trail = []) {
  const profile = eas.build?.[name]
  if (!profile) return undefined
  if (trail.includes(name))
    throw new Error(`eas.json build profile ${[...trail, name].join(' -> ')} is a cycle`)
  if (!profile.extends) return mergeProfile({}, profile)
  const parent = resolveBuildProfile(eas, profile.extends, [...trail, name])
  if (!parent)
    throw new Error(`eas.json build profile ${name} extends missing ${profile.extends}`)
  return mergeProfile(parent, profile)
}

/** Every env block of a resolved profile: the shared one and each platform's. */
export function profileEnvBlocks(profile) {
  return [
    ['env', profile.env],
    ['android.env', profile.android?.env],
    ['ios.env', profile.ios?.env],
  ].filter(([, env]) => env && typeof env === 'object')
}

function envProblems(where, entries, { allowTestStoreVariable }) {
  const problems = []
  for (const [name, value] of entries) {
    const text = String(value ?? '')
    if (name === TEST_STORE_KEY_VARIABLE) {
      if (!allowTestStoreVariable) problems.push(`${where} sets ${name}`)
    } else if (
      (REVENUECAT_VARIABLE.test(name) && text.startsWith('test_')) ||
      TEST_KEY_PATTERN.test(text) ||
      text.includes(TEST_STORE_KEY_VARIABLE)
    )
      problems.push(`${where} ${name} holds a RevenueCat Test Store key`)
  }
  return problems
}

/** Ways one non-development EAS build profile would resolve a Test Store key. */
export function profileProblems(eas, name) {
  const profile = resolveBuildProfile(eas, name)
  const where = `eas.json build profile ${name}`
  const problems = profileEnvBlocks(profile).flatMap(([block, env]) =>
    envProblems(`${where} ${block}`, Object.entries(env), {
      allowTestStoreVariable: false,
    })
  )
  if (profile.environment === DEVELOPMENT_PROFILE)
    problems.push(`${where} pulls the EAS development environment`)
  if (profile.developmentClient === true)
    problems.push(`${where} builds a development client, where __DEV__ selects the key`)
  if (/debug/i.test(profile.android?.gradleCommand ?? ''))
    problems.push(`${where} runs a Debug Gradle command, where __DEV__ selects the key`)
  if (/^debug$/i.test(profile.ios?.buildConfiguration ?? ''))
    problems.push(
      `${where} builds the Debug iOS configuration, where __DEV__ selects the key`
    )
  return problems
}

/** The `.env*` file names app.config.ts loads, read from its source. */
export function appConfigEnvFiles(source) {
  return [
    ...new Set([...source.matchAll(/['"](\.env(?:\.[\w.-]+)?)['"]/g)].map((m) => m[1])),
  ]
}

/**
 * Each assignment is checked as written and as expanded: the written text catches a reference to
 * the Test Store variable itself, the expanded value a key assembled from other variables.
 */
function envFileProblems(file, label, scope, context) {
  if (!scope || scope === 'debug' || !fs.existsSync(file)) return []
  const writtenValues = parseEnvFile(file)
  const written = Object.entries(writtenValues)
  const expanded = readEnvEntries(file, context).filter(
    ([name, value]) => value !== writtenValues[name]
  )
  return [
    ...new Set(
      envProblems(label, [...written, ...expanded], {
        allowTestStoreVariable: scope === 'shared',
      })
    ),
  ]
}

/** The written variables of every env file a release or preview build may load. */
function buildEnvContext(files) {
  const context = {}
  for (const [file, scope] of files)
    if ((scope === 'shared' || scope === 'release') && fs.existsSync(file))
      Object.assign(context, parseEnvFile(file))
  return context
}

/** Every way a release, preview or non-development EAS build would resolve a Test Store key. */
export function keyHygieneProblems(root) {
  const problems = []
  const mobile = path.join(root, 'apps/mobile')
  const eas = JSON.parse(fs.readFileSync(path.join(mobile, 'eas.json'), 'utf8'))
  for (const name of Object.keys(eas.build ?? {}))
    if (name !== DEVELOPMENT_PROFILE) problems.push(...profileProblems(eas, name))

  const loaded = appConfigEnvFiles(
    fs.readFileSync(path.join(mobile, 'app.config.ts'), 'utf8')
  )
  for (const name of loaded)
    if (!ROOT_ENV_FILES[name])
      problems.push(`app.config.ts loads ${name}, which this spec does not scope`)
  const rootFiles = Object.entries(ROOT_ENV_FILES)
    .filter(([name]) => loaded.includes(name))
    .map(([name, scope]) => [path.join(root, name), name, scope])
  const mobileFiles = fs
    .readdirSync(mobile)
    .filter((entry) => entry.startsWith('.env'))
    .map((name) => [
      path.join(mobile, name),
      `apps/mobile/${name}`,
      mobileEnvFileScope(name),
    ])
  const context = buildEnvContext(
    [...rootFiles, ...mobileFiles].map(([file, , scope]) => [file, scope])
  )

  for (const [file, label, scope] of rootFiles)
    problems.push(...envFileProblems(file, label, scope, context))
  problems.push(
    ...envFileProblems(path.join(root, '.env.example'), '.env.example', 'shared', {})
  )
  for (const [file, label, scope] of mobileFiles)
    problems.push(...envFileProblems(file, label, scope, context))
  return problems
}
