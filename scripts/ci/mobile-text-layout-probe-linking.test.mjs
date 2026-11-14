// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i (TEA change 1): the text layout probe has no production footprint. Each case
// runs a real `expo prebuild` of apps/mobile in a scratch copy, then reproduces what the native
// builds do with the generated files:
//   Android  the settings plugin passes expoAutolinking.exclude from the generated
//            settings.gradle to generate-package-list, which writes ExpoModulesPackageList.java
//   iOS      use_expo_modules!(exclude:) in the generated Podfile resolves the pods, and the
//            ExpoModulesProvider is generated from the resolved package names with the same
//            exclude (autolinking_manager.rb); the Podfile itself needs CocoaPods on macOS, so
//            the spec runs the same two autolinking commands it runs
// Production and preview prebuilds must lack the probe on both platforms, a probe build must
// carry it, and the probe must refuse any EAS profile.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const mobile = fileURLToPath(new URL('../../apps/mobile/', import.meta.url))
const resolveFromMobile = createRequire(path.join(mobile, 'package.json')).resolve
const expoCli = resolveFromMobile('expo/bin/cli')
const autolinkingCli = resolveFromMobile(
  'expo-modules-autolinking/bin/expo-modules-autolinking.js'
)
// The installed packages, wherever the checkout keeps them (a worktree resolves a parent's).
const nodeModules = path.dirname(path.dirname(resolveFromMobile('expo/package.json')))
const MODULE = 'text-layout-probe'

// Production (.env.prod side of app.config.ts) and preview (.env.preview side) never set the
// probe; the probe build is the isolated Story 6.8 test build the live font-scale proof runs.
const productionEnv = { NODE_ENV: 'production', EAS_BUILD_PROFILE: 'production' }
const previewEnv = { NODE_ENV: 'development', EAS_BUILD_PROFILE: 'development' }
const probeEnv = {
  STORY68_NATIVE_TEST_BUILD: '1',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:4088',
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:53068',
  COUTURE_TEXT_LAYOUT_PROBE: '1',
}

const skipped = new Set(['build', '.build', '.gradle', '.swiftpm', 'node_modules'])

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-text-layout-probe-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const entry of [
    'app.config.ts',
    'app.json',
    'package.json',
    'plugins',
    'modules',
    'targets',
    'assets',
    'locales',
  ])
    fs.cpSync(path.join(mobile, entry), path.join(root, entry), {
      recursive: true,
      filter: (source) => !skipped.has(path.basename(source)),
    })
  fs.symlinkSync(nodeModules, path.join(root, 'node_modules'))
  return root
}

function prebuild(root, env) {
  return spawnSync(process.execPath, [expoCli, 'prebuild', '--no-install', '--clean'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_NO_DOTENV: '1',
      COUTURE_CONFIG_NO_ENV_FILES: '1',
      STORY65_NATIVE_TEST_BUILD: '0',
      STORY68_NATIVE_TEST_BUILD: '0',
      CC68_RELEASE_PROOF_LOOPBACK: '0',
      COUTURE_TEXT_LAYOUT_PROBE: '0',
      EAS_BUILD_PROFILE: '',
      FIREBASE_GOOGLE_SERVICES_FILE: '',
      ...env,
    },
  })
}

function autolinking(root, args) {
  const result = spawnSync(process.execPath, [autolinkingCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  })
  assert.equal(
    result.status,
    0,
    `autolinking ${args[0]} exited ${result.status}: ${result.stderr}`
  )
  return result.stdout
}

const quoted = (list) =>
  [...list.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])

/** The names the generated settings.gradle excludes before it links the Expo modules. */
export function settingsGradleExcludes(contents) {
  const link = contents.indexOf('expoAutolinking.useExpoModules()')
  assert.ok(link >= 0, 'settings.gradle links the Expo modules')
  const names = []
  for (const match of contents.matchAll(/^expoAutolinking\.exclude\s*=(.*)$/gm)) {
    assert.ok(match.index < link, 'the exclude is set before useExpoModules()')
    names.push(...quoted(match[1]))
  }
  return names
}

/** The names the generated Podfile passes to use_expo_modules!. */
export function podfileExcludes(contents) {
  const calls = [...contents.matchAll(/^\s*use_expo_modules!(.*)$/gm)]
  assert.equal(calls.length, 1, 'the Podfile calls use_expo_modules! once')
  const options = calls[0][1].trim()
  if (options === '') return []
  const exclude = /^\(exclude: \[(.*)\]\)$/.exec(options)
  assert.ok(exclude, `use_expo_modules! options are only an exclude list: ${options}`)
  return quoted(exclude[1])
}

/** ExpoModulesPackageList.java as the Android build generates it from settings.gradle. */
function androidPackageList(root) {
  const exclude = settingsGradleExcludes(
    fs.readFileSync(path.join(root, 'android/settings.gradle'), 'utf8')
  )
  const target = path.join(root, 'ExpoModulesPackageList.java')
  autolinking(root, [
    'generate-package-list',
    '--platform',
    'android',
    '--namespace',
    'expo.modules',
    '--target',
    target,
    ...exclude.flatMap((name) => ['--exclude', name]),
  ])
  return fs.readFileSync(target, 'utf8')
}

/** The pods use_expo_modules! links and the ExpoModulesProvider.swift generated from them. */
function iosLinking(root) {
  const exclude = podfileExcludes(fs.readFileSync(path.join(root, 'ios/Podfile'), 'utf8'))
  const excludeArgs = exclude.flatMap((name) => ['--exclude', name])
  const resolved = JSON.parse(
    autolinking(root, ['resolve', '--platform', 'apple', '--json', ...excludeArgs])
  )
  const target = path.join(root, 'ExpoModulesProvider.swift')
  autolinking(root, [
    'generate-modules-provider',
    '--platform',
    'apple',
    '--target',
    target,
    ...excludeArgs,
    '--packages',
    ...resolved.modules.map((module) => module.packageName),
  ])
  return {
    pods: resolved.modules.flatMap((module) => module.pods.map((pod) => pod.podName)),
    provider: fs.readFileSync(target, 'utf8'),
  }
}

const androidLinked = (list) =>
  /^\s*new expo\.modules\.textlayoutprobe\.TextLayoutProbePackage\(\),?$/m.test(list)
const iosLinked = ({ pods, provider }) =>
  pods.includes('TextLayoutProbe') ||
  /^\s*TextLayoutProbeAppDelegateSubscriber\.self,?$/m.test(provider)

function assertProbeAbsent(root) {
  const list = androidPackageList(root)
  assert.equal(
    androidLinked(list),
    false,
    'the Android package list links the text layout probe'
  )
  // The list is the real one: the modules every build links are in it.
  assert.match(
    list,
    /new expo\.modules\.taskmanagermigration\.TaskManagerMigrationPackage\(\)/
  )
  const ios = iosLinking(root)
  assert.equal(iosLinked(ios), false, 'the iOS build links the text layout probe')
  assert.ok(ios.pods.includes('AccessibilityFocus'), 'the iOS pods are the real ones')
}

describe('text layout probe linking', () => {
  for (const [label, env] of [
    ['production', productionEnv],
    ['preview', previewEnv],
  ])
    test(
      `a ${label} prebuild links the probe on neither platform`,
      { timeout: 240_000 },
      (t) => {
        const root = workspace(t)
        const result = prebuild(root, env)
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
        assert.deepEqual(
          settingsGradleExcludes(
            fs.readFileSync(path.join(root, 'android/settings.gradle'), 'utf8')
          ),
          [MODULE]
        )
        assert.deepEqual(
          podfileExcludes(fs.readFileSync(path.join(root, 'ios/Podfile'), 'utf8')),
          [MODULE]
        )
        assertProbeAbsent(root)
      }
    )

  test(
    'a probe build links it on both platforms, over an earlier production prebuild too',
    { timeout: 300_000 },
    (t) => {
      const root = workspace(t)
      assert.equal(prebuild(root, productionEnv).status, 0)
      // Without --clean the probe prebuild runs its mods over the production files.
      const result = spawnSync(process.execPath, [expoCli, 'prebuild', '--no-install'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 180_000,
        killSignal: 'SIGKILL',
        env: {
          ...process.env,
          CI: '1',
          EXPO_NO_TELEMETRY: '1',
          EXPO_NO_DOTENV: '1',
          COUTURE_CONFIG_NO_ENV_FILES: '1',
          EAS_BUILD_PROFILE: '',
          ...probeEnv,
        },
      })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      const list = androidPackageList(root)
      assert.equal(androidLinked(list), true, 'the Android package list lacks the probe')
      const ios = iosLinking(root)
      assert.ok(
        ios.pods.includes('TextLayoutProbe'),
        'use_expo_modules! lacks the probe pod'
      )
      assert.match(ios.provider, /^\s*TextLayoutProbeAppDelegateSubscriber\.self,?$/m)
      // The red side of the absence check, on generated output.
      assert.throws(() => assertProbeAbsent(root), /links the text layout probe/)
    }
  )

  test(
    'the probe refuses an EAS profile and a build outside the isolated test identity',
    { timeout: 240_000 },
    (t) => {
      for (const env of [
        { ...probeEnv, ...productionEnv },
        { ...probeEnv, EAS_BUILD_PROFILE: 'development' },
        { ...probeEnv, STORY68_NATIVE_TEST_BUILD: '0' },
      ]) {
        const root = workspace(t)
        const result = prebuild(root, env)
        assert.notEqual(result.status, 0)
        assert.match(
          `${result.stdout}${result.stderr}`,
          /text_layout_probe_isolated_build_required/
        )
        assert.equal(fs.existsSync(path.join(root, 'android/settings.gradle')), false)
      }
    }
  )
})

/** EAS build profiles whose env would turn the probe or its fixture route on. */
export function probeProfiles(eas) {
  return Object.entries(eas.build ?? {})
    .filter(([, profile]) =>
      ['COUTURE_TEXT_LAYOUT_PROBE', 'EXPO_PUBLIC_TEXT_LAYOUT_PROBE'].some(
        (name) => profile.env?.[name] !== undefined
      )
    )
    .map(([name]) => name)
}

test('no EAS build profile sets the probe or its fixture flag', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(mobile, 'eas.json'), 'utf8'))
  assert.deepEqual(probeProfiles(eas), [])
  const enabled = structuredClone(eas)
  enabled.build.production.env = { COUTURE_TEXT_LAYOUT_PROBE: '1' }
  assert.deepEqual(probeProfiles(enabled), ['production'])
})

test('the exclude parsers read only the shapes the plugin writes', () => {
  const plugin = createRequire(import.meta.url)(
    path.join(mobile, 'plugins/with-text-layout-probe.js')
  )
  const settings = 'plugins {}\nexpoAutolinking.useExpoModules()\n'
  const podfile = "target 'App' do\n  use_expo_modules!\nend\n"
  assert.deepEqual(settingsGradleExcludes(settings), [])
  assert.deepEqual(podfileExcludes(podfile), [])
  const excludedSettings = plugin.excludeFromSettingsGradle(settings)
  const excludedPodfile = plugin.excludeFromPodfile(podfile)
  assert.deepEqual(settingsGradleExcludes(excludedSettings), [MODULE])
  assert.deepEqual(podfileExcludes(excludedPodfile), [MODULE])
  assert.equal(plugin.excludeFromPodfile(excludedPodfile), excludedPodfile)
  assert.equal(plugin.includeInSettingsGradle(excludedSettings), settings)
  assert.equal(plugin.includeInPodfile(excludedPodfile), podfile)
  assert.throws(
    () => podfileExcludes('  use_expo_modules!(flags: {})\n'),
    /only an exclude list/
  )
  assert.throws(
    () =>
      settingsGradleExcludes(
        "expoAutolinking.useExpoModules()\nexpoAutolinking.exclude = ['x']\n"
      ),
    /before useExpoModules/
  )
})
