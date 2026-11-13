#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// CX-06 (S4-06, S4-15): the targeted R8 reflection mutant for `minifiedDebuggable`. RevenueCat
// keeps itself (`-keep class com.revenuecat.** { *; }`), so the mutant targets one of our local
// modules instead.
//
// `ModalSystemBarsModule` (apps/mobile/modules/modal-system-bars) is reached only by reflection:
// the generated ExpoModulesPackageList names the class with a class literal, and
// expo-modules-core's ModuleRegistry.register(provider) builds every module with
// `type.getDeclaredConstructor().newInstance()` when the app's AppContext starts. No code calls
// the constructor directly, so expo-modules-core's consumer rule
// `-keep,allowoptimization,allowobfuscation class * extends expo.modules.kotlin.modules.Module {
// public <init>(); ... }` is the only thing that keeps it (`-whyareyoukeeping` names that rule).
//
// The mutant narrows that rule to every Module but this one, in a prebuild copy only: it writes a
// narrowed copy of the rules next to the copy's android/ project and points expo-modules-core's
// consumer rules at it from the copy's root build.gradle. node_modules is never written. R8 then
// strips the constructor, ModuleRegistry throws NoSuchMethodException at startup, and the S4-15
// journey on that build must fail at launch.
//
//   node scripts/lib/cx06-reflection-mutant.mjs apply --android <prebuild copy>/android
//   node scripts/lib/cx06-reflection-mutant.mjs check --apk <app-minifiedDebuggable.apk>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TARGET_CLASS = 'expo.modules.modalsystembars.ModalSystemBarsModule'
export const MODULE_RULE =
  '-keep,allowoptimization,allowobfuscation class * extends expo.modules.kotlin.modules.Module {'
export const RULES_FILE = 'cx06-expo-modules-core-rules.pro'
const MARKER = '// CX-06 reflection mutant'

/** expo-modules-core's rules with the Module rule narrowed to every Module but `target`. */
export function narrowModuleKeepRule(rules, target = TARGET_CLASS) {
  const count = rules.split(MODULE_RULE).length - 1
  if (count !== 1) throw new Error(`cx06_module_rule_count: ${count}`)
  return rules.replace(
    MODULE_RULE,
    MODULE_RULE.replace('class * extends', `class !${target},** extends`)
  )
}

/** The root build.gradle block that swaps expo-modules-core's consumer rules for the copy. */
export function gradleBlock(rulesPath) {
  return `
${MARKER}: expo-modules-core consumes the narrowed rules instead of its own.
project(':expo-modules-core') { p ->
  p.plugins.withId('com.android.library') {
    p.extensions.getByName('androidComponents').finalizeDsl { ext ->
      ext.defaultConfig.consumerProguardFiles.clear()
      ext.defaultConfig.consumerProguardFiles(new File(${JSON.stringify(rulesPath)}))
    }
  }
}
`
}

/**
 * expo-modules-core's shipped consumer rules, resolved from the app root that holds the copied
 * android/ directory. A copy of android/ alone has no package.json or node_modules to resolve
 * from, so that layout fails with a named error.
 */
export function expoModulesCoreRules(appRoot) {
  if (!fs.existsSync(path.join(appRoot, 'package.json')))
    throw new Error(`cx06_app_root_missing: ${appRoot} has no package.json`)
  let pkg
  try {
    pkg = createRequire(path.join(appRoot, 'package.json')).resolve(
      'expo-modules-core/package.json'
    )
  } catch {
    throw new Error(
      `cx06_app_root_missing: no node_modules above ${appRoot} has expo-modules-core`
    )
  }
  const rules = path.join(path.dirname(pkg), 'android/proguard-rules.pro')
  if (!fs.existsSync(rules)) throw new Error(`cx06_rules_missing: ${rules}`)
  return rules
}

/** Applies the mutant to a prebuilt android/ directory that is not part of a git checkout. */
export function applyMutant({ androidRoot, rulesSource, target = TARGET_CLASS }) {
  const real = fs.realpathSync(androidRoot)
  const git = spawnSync('git', ['-C', real, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  })
  if (git.stdout.trim() === 'true') throw new Error('cx06_refuses_a_git_checkout')
  const buildGradle = path.join(real, 'build.gradle')
  const current = fs.readFileSync(buildGradle, 'utf8')
  if (current.includes(MARKER)) throw new Error('cx06_already_applied')
  const rulesPath = path.join(real, RULES_FILE)
  fs.writeFileSync(
    rulesPath,
    narrowModuleKeepRule(fs.readFileSync(rulesSource, 'utf8'), target)
  )
  fs.writeFileSync(buildGradle, current + gradleBlock(rulesPath))
  return { rulesPath, buildGradle, target }
}

/**
 * Whether `dexdump` output holds the class and its no-argument constructor. The class can stay
 * (the class literal keeps it) while R8 strips the constructor reflection needs.
 */
export function dexState(dexdump, className = TARGET_CLASS) {
  const descriptor = `'L${className.replaceAll('.', '/')};'`
  const start = dexdump.indexOf(`Class descriptor  : ${descriptor}`)
  if (start < 0) return { class: false, constructor: false }
  const next = dexdump.indexOf('Class descriptor  :', start + 1)
  const section = dexdump.slice(start, next < 0 ? undefined : next)
  const constructor = /name\s+: '<init>'\n\s+type\s+: '\(\)V'/.test(section)
  return { class: true, constructor }
}

/** Newest build-tools dexdump under ANDROID_HOME (or ANDROID_SDK_ROOT). */
export function findDexdump(env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
  if (!sdk) throw new Error('cx06_android_sdk_unset')
  const tools = path.join(sdk, 'build-tools')
  const version = fs
    .readdirSync(tools)
    .filter((name) => fs.existsSync(path.join(tools, name, 'dexdump')))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .at(-1)
  if (!version) throw new Error('cx06_dexdump_missing')
  return path.join(tools, version, 'dexdump')
}

/** Runs dexdump on every dex in the APK and reports the target's state. */
export function checkApk({ apk, dexdump = findDexdump(), className = TARGET_CLASS }) {
  const result = spawnSync(dexdump, [apk], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw new Error(`cx06_dexdump_failed: ${result.stderr || result.error?.message}`)
  return { className, ...dexState(result.stdout, className) }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, flag, value] = process.argv.slice(2)
    if (command === 'apply' && flag === '--android' && value) {
      const appRoot = path.dirname(path.resolve(value))
      console.log(
        JSON.stringify(
          applyMutant({ androidRoot: value, rulesSource: expoModulesCoreRules(appRoot) }),
          null,
          2
        )
      )
    } else if (command === 'check' && flag === '--apk' && value) {
      console.log(JSON.stringify(checkApk({ apk: value }), null, 2))
    } else
      throw new Error(
        'usage: cx06-reflection-mutant.mjs apply --android <dir> | check --apk <apk>'
      )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
