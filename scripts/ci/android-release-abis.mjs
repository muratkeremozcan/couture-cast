#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Checks a built Android release artifact for every shipped ABI and the React Native it bundles
// (story 6.15 TEA-11, AC1). CI builds one ABI (`-PreactNativeArchitectures=x86_64` or the host
// ABI), so each step runs one all-ABI `bundleRelease` and this script reads its output:
// - `lib/<abi>/` exists for arm64-v8a, armeabi-v7a, x86 and x86_64, each with libreactnative.so,
//   libhermes.so or libhermesvm.so and libworklets.so, and every ABI carries the same libraries,
//   so no device class loses a library the others load.
// - `ReactNativeVersion` is read from the dex code itself (the static initializer of
//   com.facebook.react.modules.systeminfo.ReactNativeVersion, which React Native generates from
//   its package version), because the binary is what runs and package.json can drift from it. It
//   must equal the installed `react-native` and be a stable release (F-00q).
// The app ships the four ABIs because the Expo prebuild template sets them and nothing in the app
// config narrows them; `configuredAbiProblems` checks that so the expectation follows the app. It
// resolves the app config as Expo does (`expo config --type introspect`, app.json through
// app.config.ts with every plugin applied, under the production NODE_ENV of a release build), so
// a narrowing from either file, a plugin's options or a gradle property a plugin writes is caught.
// That resolve (scripts/lib/resolved-app-config.mjs) runs in a minimal environment with no env
// files, so a developer's shell or .env.local cannot change the verdict.
//
// Usage: node scripts/ci/android-release-abis.mjs <app-release.aab | app-release.apk>...
import fs, { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'
import { resolvedAppConfig } from '../lib/resolved-app-config.mjs'

export const SHIPPED_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']
export const REQUIRED_LIBRARIES = [
  { name: 'libreactnative.so', test: (lib) => lib === 'libreactnative.so' },
  {
    name: 'libhermes.so or libhermesvm.so',
    test: (lib) => lib === 'libhermes.so' || lib === 'libhermesvm.so',
  },
  { name: 'libworklets.so', test: (lib) => lib === 'libworklets.so' },
]
const VERSION_CLASS = 'Lcom/facebook/react/modules/systeminfo/ReactNativeVersion;'
const VERSION_KEYS = ['major', 'minor', 'patch', 'prerelease']

/** Entry names of an APK or AAB, with the dex files decompressed. */
export function readArtifact(buffer) {
  const names = []
  const files = unzipSync(new Uint8Array(buffer), {
    filter(file) {
      names.push(file.name)
      return /(^|\/)classes\d*\.dex$/.test(file.name)
    },
  })
  const bundle = names.includes('BundleConfig.pb')
  const dexPattern = bundle ? /^[^/]+\/dex\/classes\d*\.dex$/ : /^classes\d*\.dex$/
  return {
    kind: bundle ? 'aab' : 'apk',
    names,
    dexes: Object.entries(files)
      .filter(([name]) => dexPattern.test(name))
      .map(([name, bytes]) => ({ name, bytes: Buffer.from(bytes) })),
  }
}

/** ABI name to the set of native libraries packaged for it. */
export function librariesByAbi({ kind, names }) {
  const pattern =
    kind === 'aab' ? /^[^/]+\/lib\/([^/]+)\/([^/]+\.so)$/ : /^lib\/([^/]+)\/([^/]+\.so)$/
  const abis = new Map()
  for (const name of names) {
    const match = pattern.exec(name)
    if (!match) continue
    if (!abis.has(match[1])) abis.set(match[1], new Set())
    abis.get(match[1]).add(match[2])
  }
  return abis
}

export function abiProblems(abis) {
  const problems = []
  for (const abi of SHIPPED_ABIS)
    if (!abis.has(abi)) problems.push(`missing ABI ${abi}: no native libraries under it`)
  for (const [abi, libraries] of abis)
    for (const required of REQUIRED_LIBRARIES)
      if (![...libraries].some(required.test))
        problems.push(`ABI ${abi} lacks ${required.name}`)
  const every = new Set([...abis.values()].flatMap((libraries) => [...libraries]))
  for (const [abi, libraries] of abis) {
    const absent = [...every].filter((library) => !libraries.has(library)).sort()
    if (absent.length)
      problems.push(`ABI ${abi} lacks ${absent.join(', ')}, packaged for another ABI`)
  }
  return problems
}

// ---- dex reading -----------------------------------------------------------------------------

function uleb128(buffer, offset) {
  let value = 0
  let shift = 0
  for (;;) {
    const byte = buffer[offset++]
    value |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) return [value >>> 0, offset]
    shift += 7
  }
}

function dexTables(dex) {
  if (dex.toString('latin1', 0, 4) !== 'dex\n') throw new Error('not a dex file')
  const u32 = (offset) => dex.readUInt32LE(offset)
  const string = (index) => {
    const [, start] = uleb128(dex, u32(u32(0x3c) + 4 * index))
    return dex.toString('utf8', start, dex.indexOf(0, start))
  }
  const type = (index) => string(u32(u32(0x44) + 4 * index))
  const method = (index) => {
    const at = u32(0x5c) + 8 * index
    return `${type(dex.readUInt16LE(at))}.${string(u32(at + 4))}`
  }
  return { u32, string, type, method, classDefs: u32(0x60), classDefsOff: u32(0x64) }
}

/** Offset of the static initializer's code item of the given class, or undefined. */
function staticInitializer(dex, tables, descriptor) {
  for (let index = 0; index < tables.classDefs; index++) {
    const at = tables.classDefsOff + 32 * index
    if (tables.type(tables.u32(at)) !== descriptor) continue
    const classData = tables.u32(at + 24)
    if (!classData) return undefined
    let offset = classData
    const sizes = []
    for (let i = 0; i < 4; i++) [sizes[i], offset] = uleb128(dex, offset)
    for (let field = 0; field < sizes[0] + sizes[1]; field++) {
      ;[, offset] = uleb128(dex, offset)
      ;[, offset] = uleb128(dex, offset)
    }
    let methodIndex = 0
    for (let m = 0; m < sizes[2]; m++) {
      let diff, code
      ;[diff, offset] = uleb128(dex, offset)
      ;[, offset] = uleb128(dex, offset)
      ;[code, offset] = uleb128(dex, offset)
      methodIndex += diff
      if (tables.method(methodIndex).endsWith('.<clinit>') && code) return code
    }
    return undefined
  }
  return undefined
}

/** Fills `table[op]` with `value` for each opcode or inclusive [low, high] range. */
function opcodeTable(fill, entries) {
  const table = new Array(256).fill(fill)
  for (const [value, ...ops] of entries)
    for (const op of ops)
      for (
        let code = Array.isArray(op) ? op[0] : op;
        code <= (Array.isArray(op) ? op[1] : op);
        code++
      )
        table[code] = value
  return table
}

/** Code units per instruction, from the Dalvik formats; unused opcodes are one unit. */
const INSTRUCTION_UNITS = opcodeTable(1, [
  [5, 0x18],
  [4, 0xfa, 0xfb],
  [3, 0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, [0x24, 0x26], 0x2a, 0x2b, 0x2c],
  [3, [0x6e, 0x72], [0x74, 0x78], 0xfc, 0xfd],
  [2, 0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29],
  [2, [0x2d, 0x3d], [0x44, 0x6d], [0x90, 0xaf], [0xd0, 0xe2], 0xfe, 0xff],
])

/** Payload pseudo-instructions (switch tables and array data) by their identifying word. */
const PAYLOAD_UNITS = {
  0x0100: (units, pc) => 4 + units[pc + 1] * 2,
  0x0200: (units, pc) => 2 + units[pc + 1] * 4,
  0x0300: (units, pc) =>
    4 + Math.ceil((units[pc + 1] * (units[pc + 2] | (units[pc + 3] << 16))) / 2),
}

/** Length in 16-bit code units of the instruction at `pc`, payload pseudo-instructions included. */
function instructionUnits(units, pc) {
  const payload = PAYLOAD_UNITS[units[pc]]
  return payload ? payload(units, pc) : INSTRUCTION_UNITS[units[pc] & 0xff]
}

/**
 * Where an unmodeled instruction writes its result: the high byte, the low nibble of the high
 * byte, or the first operand unit. A wide result takes the next register too, so both go.
 */
const DESTINATIONS = opcodeTable(undefined, [
  ['byte', 0x05, [0x16, 0x19], 0x0b, 0x1c, 0x1f, 0x22, [0x2d, 0x31], [0x44, 0x4a]],
  ['byte', [0x60, 0x66], [0x90, 0xaf], [0xd8, 0xe2]],
  ['nibble', 0x04, 0x20, 0x21, 0x23, [0x52, 0x58], [0x7b, 0x8f], [0xb0, 0xd7]],
  ['unit', 0x06],
])
const DESTINATION_REGISTER = {
  byte: (units, pc) => units[pc] >> 8,
  nibble: (units, pc) => (units[pc] >> 8) & 0xf,
  unit: (units, pc) => units[pc + 1],
}

function overwrittenRegisters(units, pc) {
  const kind = DESTINATIONS[units[pc] & 0xff]
  if (!kind) return []
  const register = DESTINATION_REGISTER[kind](units, pc)
  return [register, register + 1]
}

const isInvoke = (op) => (op >= 0x6e && op <= 0x72) || (op >= 0x74 && op <= 0x78)

/** The registers an invoke passes, in order, for the 35c and 3rc formats. */
function invokeArguments(units, pc) {
  const word = units[pc]
  if ((word & 0xff) >= 0x74)
    return Array.from({ length: word >> 8 }, (_, i) => units[pc + 2] + i)
  const operands = units[pc + 2]
  return [
    operands & 0xf,
    (operands >> 4) & 0xf,
    (operands >> 8) & 0xf,
    operands >> 12,
    (word >> 8) & 0xf,
  ].slice(0, word >> 12)
}

/** The register value each modeled load or move writes, keyed by opcode. */
const LOADS = {
  0x12: (units, pc) => [(units[pc] >> 8) & 0xf, { int: (units[pc] << 16) >> 28 }],
  0x13: (units, pc) => [units[pc] >> 8, { int: (units[pc + 1] << 16) >> 16 }],
  0x14: (units, pc) => [units[pc] >> 8, { int: units[pc + 1] | (units[pc + 2] << 16) }],
  0x15: (units, pc) => [units[pc] >> 8, { int: units[pc + 1] << 16 }],
  0x1a: (units, pc, tables) => [units[pc] >> 8, { string: tables.string(units[pc + 1]) }],
  0x1b: (units, pc, tables) => [
    units[pc] >> 8,
    { string: tables.string(units[pc + 1] | (units[pc + 2] << 16)) },
  ],
}
const MOVES = {
  0x01: (units, pc) => [(units[pc] >> 8) & 0xf, units[pc] >> 12],
  0x02: (units, pc) => [units[pc] >> 8, units[pc + 1]],
  0x03: (units, pc) => [units[pc + 1], units[pc + 2]],
}
MOVES[0x07] = MOVES[0x01]
MOVES[0x08] = MOVES[0x02]
MOVES[0x09] = MOVES[0x03]

/** The version value a key is passed with, or an error when it is not a constant. */
function versionValue(key, value) {
  if (key === 'prerelease' && value?.int === 0) return null
  if (key === 'prerelease' && value?.string !== undefined) return value.string
  if (key !== 'prerelease' && value?.boxed !== undefined) return value.boxed
  throw new Error(`ReactNativeVersion ${key} is not a constant`)
}

/**
 * The version pairs the static initializer builds: each `"major"`/`"minor"`/`"patch"` key passed
 * next to an `Integer.valueOf` result, and `"prerelease"` next to null or a string. The method is
 * straight-line code, so a linear walk with register tracking reads it whatever order the
 * compiler chose for loading each key and its number.
 */
function versionPairs(dex, tables, code) {
  const count = dex.readUInt32LE(code + 12)
  const units = new Uint16Array(count)
  for (let i = 0; i < count; i++) units[i] = dex.readUInt16LE(code + 16 + 2 * i)
  const registers = new Map()
  const pairs = new Map()
  let result
  const invoke = (pc) => {
    const args = invokeArguments(units, pc).map((register) => registers.get(register))
    if (tables.method(units[pc + 1]) === 'Ljava/lang/Integer;.valueOf')
      return args[0]?.int === undefined ? undefined : { boxed: args[0].int }
    for (let i = 0; i + 1 < args.length; i++) {
      const key = args[i]?.string
      if (!VERSION_KEYS.includes(key)) continue
      const value = versionValue(key, args[i + 1])
      if (pairs.has(key) && pairs.get(key) !== value)
        throw new Error(`ReactNativeVersion sets ${key} twice`)
      pairs.set(key, value)
    }
    return undefined
  }
  for (let pc = 0; pc < count; pc += instructionUnits(units, pc)) {
    const op = units[pc] & 0xff
    if (LOADS[op]) registers.set(...LOADS[op](units, pc, tables))
    else if (MOVES[op]) {
      const [to, from] = MOVES[op](units, pc)
      registers.set(to, registers.get(from))
    } else if (op === 0x0a || op === 0x0c) {
      registers.set(units[pc] >> 8, result)
      result = undefined
    } else if (isInvoke(op)) result = invoke(pc)
    else
      for (const register of overwrittenRegisters(units, pc)) registers.delete(register)
  }
  return pairs
}

/** The ReactNativeVersion compiled into the dex files, as `{ major, minor, patch, prerelease, version }`. */
export function readReactNativeVersion(dexes) {
  const found = []
  for (const { name, bytes } of dexes) {
    const tables = dexTables(bytes)
    const code = staticInitializer(bytes, tables, VERSION_CLASS)
    if (code !== undefined) found.push({ name, pairs: versionPairs(bytes, tables, code) })
  }
  if (found.length === 0)
    throw new Error('no dex file defines ReactNativeVersion with a static initializer')
  if (found.length > 1)
    throw new Error(
      `ReactNativeVersion is defined in ${found.map(({ name }) => name).join(', ')}`
    )
  const { pairs } = found[0]
  for (const key of VERSION_KEYS)
    if (!pairs.has(key)) throw new Error(`ReactNativeVersion has no ${key}`)
  const [major, minor, patch, prerelease] = VERSION_KEYS.map((key) => pairs.get(key))
  return {
    major,
    minor,
    patch,
    prerelease,
    version: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`,
  }
}

export function versionProblems(dexes, expectedVersion) {
  let bundled
  try {
    bundled = readReactNativeVersion(dexes)
  } catch (error) {
    return { problems: [`ReactNativeVersion unreadable: ${error.message}`] }
  }
  const problems = []
  if (bundled.version !== expectedVersion)
    problems.push(
      `ReactNativeVersion ${bundled.version} does not match the installed react-native ${expectedVersion}`
    )
  if (bundled.prerelease !== null)
    problems.push(
      `ReactNativeVersion ${bundled.version} is a prerelease; every step ships a stable React Native`
    )
  return { bundled, problems }
}

export function checkArtifact(buffer, expectedVersion) {
  const artifact = readArtifact(buffer)
  const abis = librariesByAbi(artifact)
  const version = versionProblems(artifact.dexes, expectedVersion)
  return {
    kind: artifact.kind,
    abis,
    bundled: version.bundled,
    problems: [...abiProblems(abis), ...version.problems],
  }
}

// ---- what the app ships -------------------------------------------------------------------------

const mobileRequire = (root) => createRequire(path.join(root, 'apps/mobile/package.json'))

export function installedReactNativeVersion(root) {
  return JSON.parse(
    fs.readFileSync(mobileRequire(root).resolve('react-native/package.json'), 'utf8')
  ).version
}

/** One file of a gzipped tarball, or undefined. */
export function readTarEntry(tgz, wanted) {
  const tar = zlib.gunzipSync(tgz)
  for (let at = 0; at + 512 <= tar.length; ) {
    const field = (start, length) =>
      tar.toString('utf8', at + start, at + start + length).replace(/\0.*$/s, '')
    const name = field(0, 100)
    if (!name) return undefined
    const prefix =
      tar.toString('latin1', at + 257, at + 262) === 'ustar' ? field(345, 155) : ''
    const size = parseInt(field(124, 12).trim() || '0', 8)
    if ((prefix ? `${prefix}/${name}` : name) === wanted)
      return tar.toString('utf8', at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
  }
  return undefined
}

export function gradleArchitectures(properties) {
  const match = /^\s*reactNativeArchitectures\s*=\s*(.*)$/m.exec(properties ?? '')
  return match
    ? match[1]
        .split(',')
        .map((abi) => abi.trim())
        .filter(Boolean)
    : undefined
}

const sameAbis = (abis) =>
  Array.isArray(abis) && [...abis].sort().join(',') === [...SHIPPED_ABIS].sort().join(',')

function findKeys(value, keys, trail = []) {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => [
    ...(keys.includes(key) ? [{ path: [...trail, key].join('.'), value: child }] : []),
    ...findKeys(child, keys, [...trail, key]),
  ])
}

const NARROWING_KEYS = ['buildArchs', 'reactNativeArchitectures', 'abiFilters']

/** Narrowings in the resolved app config: plugin options, fields and plugin-written gradle properties. */
function resolvedConfigProblems(root) {
  const problems = []
  const resolved = resolvedAppConfig(root)
  if (resolved.error)
    problems.push(`the app config could not be resolved: ${resolved.error}`)
  else {
    const { _internal: internal, ...config } = resolved.config
    for (const found of findKeys(config, NARROWING_KEYS))
      problems.push(`the resolved app config ${found.path} narrows the shipped ABIs`)
    const properties = internal?.modResults?.android?.gradleProperties ?? []
    for (const property of properties)
      if (property.type === 'property' && property.key === 'reactNativeArchitectures') {
        const abis = gradleArchitectures(`reactNativeArchitectures=${property.value}`)
        if (!sameAbis(abis))
          problems.push(
            `the resolved gradle properties set reactNativeArchitectures=${abis}`
          )
      }
  }
  return problems
}

/** Ways the app config would ship an ABI set other than SHIPPED_ABIS. */
export function configuredAbiProblems(root) {
  const problems = []
  const template = path.join(
    path.dirname(mobileRequire(root).resolve('expo/package.json')),
    'template.tgz'
  )
  const templateAbis = gradleArchitectures(
    readTarEntry(fs.readFileSync(template), 'package/android/gradle.properties')
  )
  if (!sameAbis(templateAbis))
    problems.push(
      `the Expo prebuild template sets reactNativeArchitectures=${templateAbis ?? '(none)'}`
    )
  const generated = path.join(root, 'apps/mobile/android/gradle.properties')
  if (fs.existsSync(generated)) {
    const generatedAbis = gradleArchitectures(fs.readFileSync(generated, 'utf8'))
    if (!sameAbis(generatedAbis))
      problems.push(
        `apps/mobile/android/gradle.properties sets reactNativeArchitectures=${generatedAbis ?? '(none)'}`
      )
  }
  problems.push(...resolvedConfigProblems(root))
  // An app/build.gradle edit (abiFilters) is a dangerous mod that only a prebuild applies, so the
  // sources that can carry one are read instead.
  if (
    /abiFilters/.test(
      fs.readFileSync(path.join(root, 'apps/mobile/app.config.ts'), 'utf8')
    )
  )
    problems.push('apps/mobile/app.config.ts sets abiFilters')
  const plugins = path.join(root, 'apps/mobile/plugins')
  for (const file of fs.readdirSync(plugins).filter((name) => /\.[cm]?js$/.test(name))) {
    if (/\.test\.[cm]?js$/.test(file)) continue
    if (
      /reactNativeArchitectures|abiFilters|buildArchs/.test(
        fs.readFileSync(path.join(plugins, file), 'utf8')
      )
    )
      problems.push(`apps/mobile/plugins/${file} sets the shipped ABIs`)
  }
  return problems
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = process.argv.slice(2)
  if (artifacts.length === 0) {
    console.error(
      'usage: node scripts/ci/android-release-abis.mjs <app-release.aab|apk>...'
    )
    process.exit(2)
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const expected = installedReactNativeVersion(root)
  let failed = false
  for (const problem of configuredAbiProblems(root)) {
    console.error(`android-release-abis: app config: ${problem}`)
    failed = true
  }
  for (const file of artifacts) {
    const report = checkArtifact(fs.readFileSync(file), expected)
    const label = path.basename(file)
    for (const problem of report.problems)
      console.error(`android-release-abis: ${label}: ${problem}`)
    if (report.problems.length) failed = true
    else
      console.log(
        `android-release-abis: ${label} (${report.kind}): ${[...report.abis.keys()].sort().join(', ')} ` +
          `with ${report.abis.get(SHIPPED_ABIS[0]).size} libraries each; ReactNativeVersion ` +
          `${report.bundled.version} matches the installed react-native`
      )
  }
  process.exit(failed ? 1 : 0)
}
