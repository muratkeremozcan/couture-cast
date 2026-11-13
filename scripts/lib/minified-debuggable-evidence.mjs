#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S4-15 (TEA-17, R3-03): every D15 journey run on the Android `minifiedDebuggable` build records
// three facts separately. This script proves two of them from the build's own outputs:
//
// 1. The native build is debuggable: the APK manifest declares `android:debuggable`
//    (`aapt2 dump badging` prints `application-debuggable`), and, when a device serial is given,
//    the installed package carries ApplicationInfo.FLAG_DEBUGGABLE (`dumpsys package` flags).
// 2. R8 ran: the variant's `mapping.txt` exists and the probe class is renamed or removed.
//    AGP turns obfuscation off for a debuggable variant, so here R8 shrinks without renaming:
//    the first build (2026-11-13, SDK 54) mapped 21,297 classes, renamed none, and removed 17,896
//    (`usage.txt` lists a removed class on its own line; `mapping.txt` maps some to
//    `R8$$REMOVED$$CLASS$$n`). The default probe is the app's `R$drawable`, which R8 removes once
//    it inlines the resource ids. RevenueCat's own consumer rule keeps `com.revenuecat.**`, so no
//    RevenueCat class can serve as the probe.
//
// The third fact, JS `__DEV__` true, is a property of the bundle Metro serves at runtime, so the
// journey asserts it on the device; no build output can show it.
//
// Two more facts go with every record:
//
// - RevenueCat survives shrinking. `purchases` ships `-keep class com.revenuecat.** { *; }` in its
//   AAR's proguard.txt, so this build gives no targeted R8 evidence for RevenueCat (spec D4); what
//   it can show is that no RevenueCat class or member was removed, so a later SDK that drops the
//   blanket rule turns this red instead of shipping a stripped billing client.
// - Whether Release runs R8. On SDK 54 the app config leaves `android.enableMinifyInReleaseBuilds`
//   unset, so Release is not minified and the record states that as a baseline fact. Once the
//   config turns it on (expo-build-properties in app.json, or the prebuilt gradle.properties), a
//   Release build with no `mapping.txt` fails.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const VARIANT = 'minifiedDebuggable'
const REMOVED_PLACEHOLDER = /^R8\$\$REMOVED\$\$CLASS\$\$\d+$/

/** The package name `aapt2 dump badging` reports. */
export function badgingPackage(badging) {
  const match = /^package: name='([^']+)'/m.exec(badging)
  if (!match) throw new Error('minified_debuggable_badging_unreadable')
  return match[1]
}

/** `aapt2 dump badging` output declares the application debuggable. */
export function badgingDebuggable(badging) {
  badgingPackage(badging)
  return /^application-debuggable$/m.test(badging)
}

/** The default probe: the app's drawable R class, removed by R8 in every minified build. */
export const defaultProbeClass = (packageName) => `${packageName}.R$drawable`

/**
 * `adb shell dumpsys package <name>` output shows FLAG_DEBUGGABLE on the installed package.
 * Only the `flags=[ ... ]` line of the package's own section counts, never `pkgFlags` of another.
 */
export function dumpsysDebuggable(dumpsys, packageName) {
  const start = dumpsys.indexOf(`Package [${packageName}]`)
  if (start < 0) throw new Error(`minified_debuggable_package_missing: ${packageName}`)
  const rest = dumpsys.slice(start + 1)
  const next = rest.search(/\n {2}Package \[/)
  const section = next < 0 ? rest : rest.slice(0, next)
  const flags = /^\s+flags=\[([^\]]*)\]/m.exec(section)
  if (!flags) throw new Error('minified_debuggable_flags_missing')
  return flags[1].trim().split(/\s+/).includes('DEBUGGABLE')
}

/** Class mappings from an R8 `mapping.txt`, original name to obfuscated name. */
export function parseMappingClasses(mapping) {
  const classes = new Map()
  for (const line of mapping.split('\n')) {
    const match = /^([^\s#][^ ]*) -> ([^ ]+):$/.exec(line)
    if (match) classes.set(match[1], match[2])
  }
  return classes
}

/** Classes R8 removed entirely: bare class lines in `usage.txt`, with no member list. */
export function parseRemovedClasses(usage) {
  const removed = new Set()
  for (const line of usage.split('\n'))
    if (/^[^\s#:]+$/.test(line)) removed.add(line.trim())
  return removed
}

/**
 * Throws unless R8 processed the build: the mapping is not empty and the probe class is renamed
 * or removed. Returns the counts and the probe's fate for the evidence record; `obfuscated` is
 * false when no class was renamed, which is expected for a debuggable variant.
 */
export function r8Evidence({ mapping, usage = '', probeClass }) {
  if (!probeClass) throw new Error('minified_debuggable_probe_required')
  const classes = parseMappingClasses(mapping)
  if (classes.size === 0) throw new Error('minified_debuggable_mapping_empty')
  const removed = parseRemovedClasses(usage)
  let renamed = 0
  for (const [original, obfuscated] of classes) {
    if (REMOVED_PLACEHOLDER.test(obfuscated)) removed.add(original)
    else if (original !== obfuscated) renamed += 1
  }
  let probe
  if (removed.has(probeClass)) probe = { class: probeClass, fate: 'removed' }
  else if (classes.has(probeClass)) {
    const obfuscated = classes.get(probeClass)
    if (obfuscated === probeClass)
      throw new Error(`minified_debuggable_probe_kept: ${probeClass}`)
    probe = { class: probeClass, fate: 'renamed', to: obfuscated }
  } else throw new Error(`minified_debuggable_probe_unaccounted: ${probeClass}`)
  return {
    mappedClasses: classes.size,
    renamedClasses: renamed,
    removedClasses: removed.size,
    obfuscated: renamed > 0,
    probe,
  }
}

// RevenueCat classes the React Native bridge reaches; each must survive with its own name.
export const REVENUECAT_REQUIRED_CLASSES = Object.freeze([
  'com.revenuecat.purchases.Purchases',
  'com.revenuecat.purchases.hybridcommon.CommonKt',
])

/**
 * Throws unless R8 left RevenueCat whole: the mapping (every class in the dex) holds RevenueCat
 * classes, the required ones keep their names, and `usage.txt` lists no RevenueCat class or member
 * as removed.
 */
export function revenueCatSurvival({
  mapping,
  usage = '',
  required = REVENUECAT_REQUIRED_CLASSES,
  classes = parseMappingClasses(mapping),
}) {
  const kept = [...classes.keys()].filter((name) => name.startsWith('com.revenuecat.'))
  if (kept.length === 0) throw new Error('minified_debuggable_revenuecat_absent')
  for (const name of required)
    if (classes.get(name) !== name)
      throw new Error(`minified_debuggable_revenuecat_class_missing: ${name}`)
  const shrunk = usage.split('\n').find((line) => line.startsWith('com.revenuecat.'))
  if (shrunk) throw new Error(`minified_debuggable_revenuecat_shrunk: ${shrunk}`)
  return { keptClasses: kept.length, required: [...required] }
}

const MINIFY_PROPERTY = 'android.enableMinifyInReleaseBuilds'

/**
 * Whether the app config turns R8 on for Release: expo-build-properties in app.json
 * (`android.enableMinifyInReleaseBuilds`, or its older name `enableProguardInReleaseBuilds`) or
 * the prebuilt `gradle.properties` the template's build.gradle reads. The two must agree when both
 * are given, or the native project is stale.
 */
export function releaseMinifyConfig({ appJson, gradleProperties }) {
  const plugin = (appJson?.expo?.plugins ?? []).find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-build-properties'
  )
  const android = plugin?.[1]?.android ?? {}
  const fromApp =
    android.enableMinifyInReleaseBuilds === true ||
    android.enableProguardInReleaseBuilds === true
  if (gradleProperties === undefined) return { enabled: fromApp, source: 'app.json' }
  const line = gradleProperties
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${MINIFY_PROPERTY}=`))
  const fromGradle = line?.slice(MINIFY_PROPERTY.length + 1).trim() === 'true'
  if (fromApp && !fromGradle)
    throw new Error('minified_debuggable_release_minify_config_stale')
  return {
    enabled: fromGradle,
    source: fromGradle && !fromApp ? 'gradle.properties' : 'app.json',
  }
}

/**
 * The Release R8 fact. Without minify it is the recorded baseline, never a failure; with minify a
 * missing Release `mapping.txt` fails.
 */
export function releaseR8Status({ minifyEnabled, mappingExists }) {
  if (!minifyEnabled)
    return { r8: false, fact: 'Release runs no R8', mappingPresent: mappingExists }
  if (!mappingExists) throw new Error('minified_debuggable_release_mapping_missing')
  return { r8: true, fact: 'Release ran R8', mappingPresent: true }
}

/** Newest build-tools aapt2 under ANDROID_HOME (or ANDROID_SDK_ROOT). */
export function findAapt2(env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
  if (!sdk) throw new Error('minified_debuggable_android_sdk_unset')
  const tools = path.join(sdk, 'build-tools')
  const versions = fs
    .readdirSync(tools)
    .filter((name) => fs.existsSync(path.join(tools, name, 'aapt2')))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (!versions.length) throw new Error('minified_debuggable_aapt2_missing')
  return path.join(tools, versions.at(-1), 'aapt2')
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} ${args[0]} failed: ${result.stderr || result.error?.message}`
    )
  return result.stdout
}

/** Paths AGP writes for the variant under an Android project root. */
export function variantOutputs(androidRoot) {
  const outputs = path.join(androidRoot, 'app/build/outputs')
  return {
    apk: path.join(outputs, `apk/${VARIANT}/app-${VARIANT}.apk`),
    mapping: path.join(outputs, `mapping/${VARIANT}/mapping.txt`),
    usage: path.join(outputs, `mapping/${VARIANT}/usage.txt`),
    releaseMapping: path.join(outputs, 'mapping/release/mapping.txt'),
    gradleProperties: path.join(androidRoot, 'gradle.properties'),
  }
}

/** The Release R8 record from the app config and the Release build's outputs. */
export function collectReleaseR8({ appJsonPath, gradlePropertiesPath, releaseMapping }) {
  const config = releaseMinifyConfig({
    appJson: JSON.parse(fs.readFileSync(appJsonPath, 'utf8')),
    gradleProperties:
      gradlePropertiesPath && fs.existsSync(gradlePropertiesPath)
        ? fs.readFileSync(gradlePropertiesPath, 'utf8')
        : undefined,
  })
  return {
    configSource: config.source,
    ...releaseR8Status({
      minifyEnabled: config.enabled,
      mappingExists: fs.existsSync(releaseMapping),
    }),
  }
}

/**
 * The evidence record for one build: the APK manifest's debuggable flag, the installed package's
 * FLAG_DEBUGGABLE when `serial` is given (the APK's package unless `packageName` names one), and
 * the R8 facts.
 */
export function collectEvidence({
  apk,
  mapping,
  usage,
  probeClass,
  serial,
  packageName,
  aapt2 = findAapt2(),
  adb = 'adb',
}) {
  for (const file of [apk, mapping])
    if (!fs.existsSync(file))
      throw new Error(`minified_debuggable_output_missing: ${file}`)
  const badging = run(aapt2, ['dump', 'badging', apk])
  if (!badgingDebuggable(badging))
    throw new Error('minified_debuggable_apk_not_debuggable')
  const apkPackage = badgingPackage(badging)
  packageName ??= apkPackage
  let installed = null
  if (serial) {
    const dumpsys = run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', packageName])
    if (!dumpsysDebuggable(dumpsys, packageName))
      throw new Error('minified_debuggable_installed_not_debuggable')
    installed = { serial, packageName, flagDebuggable: true }
  }
  const mappingText = fs.readFileSync(mapping, 'utf8')
  const usageText = usage && fs.existsSync(usage) ? fs.readFileSync(usage, 'utf8') : ''
  return {
    variant: VARIANT,
    nativeDebuggable: { apkManifest: true, installed },
    r8: r8Evidence({
      mapping: mappingText,
      usage: usageText,
      probeClass: probeClass ?? defaultProbeClass(apkPackage),
    }),
    revenueCat: revenueCatSurvival({ mapping: mappingText, usage: usageText }),
    jsDev: 'asserted at runtime by the D15 journey',
  }
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`minified_debuggable_bad_argument: ${flag}`)
    options[flag.slice(2)] = value
  }
  return options
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const defaults = variantOutputs(options.android ?? 'apps/mobile/android')
    const evidence = collectEvidence({
      apk: options.apk ?? defaults.apk,
      mapping: options.mapping ?? defaults.mapping,
      usage: options.usage ?? defaults.usage,
      probeClass: options.probe,
      serial: options.serial,
      packageName: options.package,
    })
    evidence.release = collectReleaseR8({
      appJsonPath: options['app-json'] ?? 'apps/mobile/app.json',
      gradlePropertiesPath: defaults.gradleProperties,
      releaseMapping: options['release-mapping'] ?? defaults.releaseMapping,
    })
    console.log(JSON.stringify(evidence, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
