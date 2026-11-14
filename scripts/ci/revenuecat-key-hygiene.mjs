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
import { getEnvFiles, loadEnvFiles, LOADED_ENV_NAME } from '@expo/env'
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
 * Every assignment of one dotenv file as `[name, value]`: dotenv parses it, so `NAME: value`,
 * `export NAME=value` and quoted or multi-line values count as they would at build time, and
 * dotenv-expand resolves `${NAME}` references within the file. The caller's process environment
 * is never read. The hygiene check judges whole builds through {@link resolveBuildEnv}; this
 * reads one value out of one file.
 */
export function readEnvEntries(file) {
  return Object.entries(expand({ parsed: parseEnvFile(file), processEnv: {} }).parsed)
}

/** The release modes a build exports in, with the root env file each loads beside `.env.local`. */
export const RELEASE_MODES = { production: '.env.prod', preview: '.env.preview' }

/**
 * The environment a release export resolves from the env files alone, computed by running the
 * build's own loaders against a clean object (story 6.15 r40 P2), so precedence and expansion
 * match the build exactly:
 * - app.config.ts: dotenv loads the root files in its source order with `override: false`, so
 *   the first file to set a variable wins and nothing is expanded;
 * - Expo CLI: `@expo/env` loads apps/mobile's files for the mode, expands them against the
 *   environment already present, and never overwrites a variable that is already set.
 * Which loader runs first depends on the entry point (Expo CLI loads its env before it reads the
 * config; a config evaluated first fills the environment before `@expo/env` expands), so
 * `order` picks one and the check runs both. `seed` is the environment the build starts with,
 * an EAS profile's env on EAS Build (story 6.15 r42): both loaders keep it and expand against it.
 */
export function resolveBuildEnv(root, { mode, order, rootFiles, seed = {} }) {
  const env = { ...seed }
  const mobile = path.join(root, 'apps/mobile')
  const loadRoot = () => {
    for (const name of rootFiles)
      dotenv.config({
        path: path.join(root, name),
        override: false,
        quiet: true,
        processEnv: env,
      })
  }
  const loadMobile = () => {
    const files = getEnvFiles({ mode, silent: true }).map((name) =>
      path.join(mobile, name)
    )
    loadEnvFiles(files, { force: true, silent: true, systemEnv: env })
    delete env[LOADED_ENV_NAME]
  }
  if (order === 'app-config-first') {
    loadRoot()
    loadMobile()
  } else {
    loadMobile()
    loadRoot()
  }
  return env
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
 * One env file as written: the must-not-name rule for a release-only file, a `test_` key typed
 * into a variable, and a reference to the Test Store variable itself.
 */
function envFileProblems(file, label, scope) {
  if (!scope || scope === 'debug' || !fs.existsSync(file)) return []
  return envProblems(label, Object.entries(parseEnvFile(file)), {
    allowTestStoreVariable: scope === 'shared',
  })
}

/** The loader orders {@link resolveBuildEnv} runs; the check judges every one. */
export const LOADER_ORDERS = ['app-config-first', 'expo-cli-first']

/** The root env files app.config.ts loads under a NODE_ENV, in its source order. */
function rootFilesFor(loaded, nodeEnv) {
  // app.config.ts picks `.env.prod` only for NODE_ENV production, `.env.preview` otherwise.
  const modeFile =
    nodeEnv === 'production' ? RELEASE_MODES.production : RELEASE_MODES.preview
  const otherModeFiles = Object.values(RELEASE_MODES).filter((file) => file !== modeFile)
  return loaded.filter((name) => !otherModeFiles.includes(name))
}

/**
 * The starting environments a release export can resolve from: a clean one for each release
 * mode (a laptop export), and on EAS Build each non-development profile's env for each platform,
 * `extends` applied and the platform block over the shared one. A profile that sets NODE_ENV
 * builds in that mode only; one that does not is judged in every release mode.
 */
function buildContexts(eas) {
  const contexts = Object.keys(RELEASE_MODES).map((mode) => ({
    label: `the resolved ${mode} build env`,
    mode,
    seed: {},
  }))
  for (const name of Object.keys(eas.build ?? {})) {
    if (name === DEVELOPMENT_PROFILE) continue
    const profile = resolveBuildProfile(eas, name)
    for (const platform of ['android', 'ios']) {
      const seed = Object.fromEntries(
        Object.entries({ ...profile.env, ...profile[platform]?.env }).map(
          ([key, value]) => [key, String(value)]
        )
      )
      // A profile with no env resolves exactly as the clean build does.
      if (Object.keys(seed).length === 0) continue
      const modes = seed.NODE_ENV ? [seed.NODE_ENV] : Object.keys(RELEASE_MODES)
      for (const mode of modes)
        contexts.push({
          label: `the resolved ${mode} build env of eas.json build profile ${name} on ${platform}`,
          mode,
          seed,
        })
    }
  }
  return contexts
}

/**
 * Every variable a release export resolves to a Test Store key, by starting environment and
 * loader order. A value the profile itself sets is judged by {@link profileProblems}; only what
 * the env files resolve is judged here. The Test Store variable itself may resolve from a shared
 * file: revenueCatKeyEnv reads it only under `__DEV__`, and revenuecat-bundle-scan.mjs proves
 * release exports drop it.
 */
function resolvedEnvProblems(root, loaded, eas, orders = LOADER_ORDERS) {
  const problems = new Set()
  const clean = new Map()
  const cleanEnv = (mode, order) => {
    const key = `${mode}\n${order}`
    if (!clean.has(key))
      clean.set(
        key,
        resolveBuildEnv(root, { mode, order, rootFiles: rootFilesFor(loaded, mode) })
      )
    return clean.get(key)
  }
  for (const { label, mode, seed } of buildContexts(eas)) {
    const seeded = Object.keys(seed).length > 0
    for (const order of orders) {
      const resolved = seeded
        ? resolveBuildEnv(root, {
            mode,
            order,
            rootFiles: rootFilesFor(loaded, mode),
            seed,
          })
        : cleanEnv(mode, order)
      // Under a profile, only what its env changes is new: a value the profile sets itself is
      // judged by profileProblems, and one the clean build of a release mode resolves the same way
      // is judged there. A profile mode with no clean context (NODE_ENV staging) judges it all.
      const cleanJudged = Object.hasOwn(RELEASE_MODES, mode)
      const judged = Object.entries(resolved).filter(
        ([name, value]) =>
          !seeded ||
          (seed[name] !== value &&
            !(cleanJudged && cleanEnv(mode, order)[name] === value))
      )
      for (const problem of envProblems(label, judged, { allowTestStoreVariable: true }))
        problems.add(problem)
    }
  }
  return [...problems]
}

/**
 * Every way a release, preview or non-development EAS build would resolve a Test Store key.
 * `orders` narrows the loader orders only so a test can show each order is needed.
 */
export function keyHygieneProblems(root, { orders = LOADER_ORDERS } = {}) {
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
  for (const [name, scope] of Object.entries(ROOT_ENV_FILES))
    if (loaded.includes(name))
      problems.push(...envFileProblems(path.join(root, name), name, scope))
  problems.push(
    ...envFileProblems(path.join(root, '.env.example'), '.env.example', 'shared')
  )
  for (const name of fs.readdirSync(mobile).filter((entry) => entry.startsWith('.env')))
    problems.push(
      ...envFileProblems(
        path.join(mobile, name),
        `apps/mobile/${name}`,
        mobileEnvFileScope(name)
      )
    )
  problems.push(...resolvedEnvProblems(root, loaded, eas, orders))
  return problems
}
