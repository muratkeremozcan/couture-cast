// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: the native build refuses a generated project whose probe mode differs from
// the requested one. The production texts come from the plugin itself, so the check follows
// what the plugin writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  IOS_POD_FILES,
  PROBE_MODE_FILES,
  assertNativeProbeMode,
  generatedProbeMode,
  podfileExclusions,
  podfileLockPods,
  podsProbeModeProblem,
  podsProjectTargets,
  probeModeProblem,
  requestedProbeMode,
  settingsGradleExclusions,
} from './text-layout-probe-mode.mjs'

const plugin = createRequire(import.meta.url)(
  fileURLToPath(
    new URL('../../apps/mobile/plugins/with-text-layout-probe.js', import.meta.url)
  )
)

// The generated files' anchors as the Expo SDK 54 template writes them.
const probeProjects = {
  android: 'plugins {}\nexpoAutolinking.useExpoModules()\nrootProject.name = "app"\n',
  ios: "target 'App' do\n  use_expo_modules!\n\n  config = use_native_modules!\nend\n",
}
const productionProjects = {
  android: plugin.excludeFromSettingsGradle(probeProjects.android),
  ios: plugin.excludeFromPodfile(probeProjects.ios),
}
const probeEnv = { COUTURE_TEXT_LAYOUT_PROBE: '1' }
const productionEnv = {}

// What pod install leaves, in the shape CocoaPods 1.17 writes (Podfile.lock PODS section, a
// PBXNativeTarget per pod in Pods.xcodeproj).
const lockWith = (...pods) =>
  [
    'PODS:',
    ...pods.flatMap((pod) => [`  - ${pod} (1.0.0):`, '    - ExpoModulesCore']),
    '  - ExpoModulesCore (3.0.0)',
    '',
    'DEPENDENCIES:',
    ...pods.map((pod) => `  - ${pod} (from \`../modules/${pod}/ios\`)`),
    '',
    'COCOAPODS: 1.17.0',
    '',
  ].join('\n')
const projectWith = (...targets) =>
  [
    '// !$*UTF8*$!',
    '{',
    '\tobjects = {',
    ...targets.flatMap((target, index) => [
      `\t\t7F${index} /* ${target} */ = {`,
      '\t\t\tisa = PBXNativeTarget;',
      `\t\t\tbuildConfigurationList = 46${index} /* Build configuration list for PBXNativeTarget "${target}" */;`,
      '\t\t\tbuildPhases = (',
      '\t\t\t);',
      `\t\t\tname = ${target};`,
      `\t\t\tproductName = ${target};`,
      '\t\t};',
    ]),
    '\t};',
    '}',
    '',
  ].join('\n')
const installed = {
  probe: {
    lock: lockWith('AccessibilityFocus', 'TextLayoutProbe'),
    project: projectWith('AccessibilityFocus', 'TextLayoutProbe'),
  },
  production: {
    lock: lockWith('AccessibilityFocus'),
    project: projectWith('AccessibilityFocus'),
  },
}

/** Writes a generated project under a fresh apps/mobile stand-in. */
function mobileWith(t, files) {
  const mobile = fs.mkdtempSync(path.join(os.tmpdir(), 'cc615-probe-mode-'))
  t.after(() => fs.rmSync(mobile, { recursive: true, force: true }))
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.join(mobile, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(mobile, file), contents)
  }
  return mobile
}

const iosProject = (podfile, pods) => ({
  [PROBE_MODE_FILES.ios]: podfile,
  ...(pods
    ? { [IOS_POD_FILES.lock]: pods.lock, [IOS_POD_FILES.project]: pods.project }
    : {}),
})

describe('text layout probe build mode', () => {
  test('only COUTURE_TEXT_LAYOUT_PROBE=1 requests the probe', () => {
    assert.equal(requestedProbeMode(probeEnv), 'probe')
    for (const value of [undefined, '', '0', 'true', 'yes'])
      assert.equal(requestedProbeMode({ COUTURE_TEXT_LAYOUT_PROBE: value }), 'production')
  })

  test('the plugin output reads as production and the template as probe', () => {
    for (const platform of ['android', 'ios']) {
      assert.equal(
        generatedProbeMode(platform, productionProjects[platform]),
        'production'
      )
      assert.equal(generatedProbeMode(platform, probeProjects[platform]), 'probe')
    }
  })

  test('a production project under a probe request is refused', () => {
    for (const platform of ['android', 'ios'])
      assert.equal(
        probeModeProblem({
          platform,
          contents: productionProjects[platform],
          env: probeEnv,
        }),
        `native_probe_mode_mismatch:${platform}:production_project:probe_requested`
      )
  })

  test('a probe project under a production request is refused', () => {
    for (const platform of ['android', 'ios'])
      assert.equal(
        probeModeProblem({
          platform,
          contents: probeProjects[platform],
          env: productionEnv,
        }),
        `native_probe_mode_mismatch:${platform}:probe_project:production_requested`
      )
  })

  test('a project in the requested mode builds', () => {
    for (const platform of ['android', 'ios']) {
      assert.equal(
        probeModeProblem({ platform, contents: probeProjects[platform], env: probeEnv }),
        null
      )
      assert.equal(
        probeModeProblem({
          platform,
          contents: productionProjects[platform],
          env: productionEnv,
        }),
        null
      )
    }
  })

  test('the build reads the generated files and refuses a missing project', (t) => {
    const mobile = fs.mkdtempSync(path.join(os.tmpdir(), 'cc615-probe-mode-'))
    t.after(() => fs.rmSync(mobile, { recursive: true, force: true }))
    for (const platform of ['android', 'ios'])
      assert.throws(
        () => assertNativeProbeMode({ platform, mobileDirectory: mobile, env: probeEnv }),
        new RegExp(`^Error: native_probe_mode_project_missing:${platform}$`)
      )
    const files = {
      [PROBE_MODE_FILES.android]: productionProjects.android,
      ...iosProject(productionProjects.ios, installed.production),
    }
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.join(mobile, path.dirname(file)), { recursive: true })
      fs.writeFileSync(path.join(mobile, file), contents)
    }
    for (const platform of ['android', 'ios']) {
      assert.throws(
        () => assertNativeProbeMode({ platform, mobileDirectory: mobile, env: probeEnv }),
        /native_probe_mode_mismatch/
      )
      assertNativeProbeMode({ platform, mobileDirectory: mobile, env: productionEnv })
    }
  })

  // Antigravity r43 P2: the generated files are parsed, so quotes, comments and layout do not
  // decide the mode.

  test('a Podfile exclusion reads with either quotes, a trailing comment or over several lines', () => {
    const inApp = (body) => `target 'App' do\n${body}\nend\n`
    const production = [
      inApp('  use_expo_modules!(exclude: ["text-layout-probe"])'),
      inApp("  use_expo_modules!(exclude: ['text-layout-probe']) # proof builds only"),
      inApp(
        '  use_expo_modules!(\n    exclude: [\n      \'other\', # kept\n      "text-layout-probe",\n    ]\n  )'
      ),
      inApp("  use_expo_modules! exclude: ['text-layout-probe']"),
      inApp("  use_expo_modules!({ :exclude => ['text-layout-probe'] })"),
    ]
    for (const podfile of production)
      assert.equal(generatedProbeMode('ios', podfile), 'production', podfile)
    const probe = [
      inApp("  # use_expo_modules!(exclude: ['text-layout-probe'])\n  use_expo_modules!"),
      inApp("  use_expo_modules!(exclude: ['other']) # not 'text-layout-probe'"),
      inApp("  use_expo_modules!(exclude: ['text-layout-probe-extra'])"),
      "# 'text-layout-probe'\ntarget 'App' do\nend\n",
    ]
    for (const podfile of probe)
      assert.equal(generatedProbeMode('ios', podfile), 'probe', podfile)
    assert.deepEqual(podfileExclusions(production[2]), [['other', 'text-layout-probe']])
  })

  test('a settings.gradle exclusion reads with either quotes, comments and later assignments', () => {
    const anchor = 'expoAutolinking.useExpoModules()\n'
    const production = [
      `expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ["text-layout-probe"]\n${anchor}`,
      `expoAutolinking.exclude = ['text-layout-probe'] // proof builds only\n${anchor}`,
      `expoAutolinking.exclude = [\n  'other', // kept\n  'text-layout-probe'\n]\n${anchor}`,
      `expoAutolinking.exclude = ['other']\nexpoAutolinking.exclude += ['text-layout-probe']\n${anchor}`,
    ]
    for (const settings of production)
      assert.equal(generatedProbeMode('android', settings), 'production', settings)
    const probe = [
      `// expoAutolinking.exclude = ['text-layout-probe']\n${anchor}`,
      `/* expoAutolinking.exclude = ['text-layout-probe'] */\n${anchor}`,
      `expoAutolinking.exclude = ['text-layout-probe']\nexpoAutolinking.exclude = ['other']\n${anchor}`,
      `expoAutolinking.exclude = ['other'] // not 'text-layout-probe'\n${anchor}`,
    ]
    for (const settings of probe)
      assert.equal(generatedProbeMode('android', settings), 'probe', settings)
    assert.deepEqual(settingsGradleExclusions(production[2]), [
      'other',
      'text-layout-probe',
    ])
  })

  test('Podfile.lock and the Pods project list the probe pod only when it is installed', () => {
    assert.deepEqual(podfileLockPods(installed.probe.lock), [
      'AccessibilityFocus',
      'TextLayoutProbe',
      'ExpoModulesCore',
    ])
    assert.deepEqual(podfileLockPods(installed.production.lock), [
      'AccessibilityFocus',
      'ExpoModulesCore',
    ])
    // Subspecs and quoted names fold into their pod.
    assert.deepEqual(
      podfileLockPods(
        'PODS:\n  - "TextLayoutProbe/Core (1.0.0)"\n  - React-Core/Default (0.81.5):\n    - React-Core\n'
      ),
      ['TextLayoutProbe', 'React-Core']
    )
    assert.deepEqual(podsProjectTargets(installed.probe.project), [
      'AccessibilityFocus',
      'TextLayoutProbe',
    ])
    assert.deepEqual(podsProjectTargets(installed.production.project), [
      'AccessibilityFocus',
    ])
  })

  test('the installed pods must agree with the requested mode', () => {
    assert.equal(podsProbeModeProblem({ ...installed.probe, env: probeEnv }), null)
    assert.equal(
      podsProbeModeProblem({ ...installed.production, env: productionEnv }),
      null
    )
    assert.equal(
      podsProbeModeProblem({ ...installed.probe, env: productionEnv }),
      'native_probe_mode_mismatch:ios:Podfile.lock:probe_project:production_requested'
    )
    assert.equal(
      podsProbeModeProblem({ ...installed.production, env: probeEnv }),
      'native_probe_mode_mismatch:ios:Podfile.lock:production_project:probe_requested'
    )
    assert.equal(
      podsProbeModeProblem({
        lock: installed.production.lock,
        project: installed.probe.project,
        env: productionEnv,
      }),
      'native_probe_mode_mismatch:ios:Pods.xcodeproj:probe_project:production_requested'
    )
    assert.equal(
      podsProbeModeProblem({
        lock: undefined,
        project: installed.production.project,
        env: productionEnv,
      }),
      'native_probe_mode_project_missing:ios:Podfile.lock'
    )
    assert.equal(
      podsProbeModeProblem({
        lock: installed.production.lock,
        project: null,
        env: productionEnv,
      }),
      'native_probe_mode_project_missing:ios:Pods.xcodeproj'
    )
  })

  test('a production Podfile over stale probe pods is refused before an iOS build', (t) => {
    // The r43 reproduction: the Podfile was switched without a pod install.
    const stale = mobileWith(t, iosProject(productionProjects.ios, installed.probe))
    assert.throws(
      () =>
        assertNativeProbeMode({
          platform: 'ios',
          mobileDirectory: stale,
          env: productionEnv,
        }),
      /^Error: native_probe_mode_mismatch:ios:Podfile\.lock:probe_project:production_requested$/
    )
    // Right before pod install only the Podfile is read.
    assertNativeProbeMode({
      platform: 'ios',
      mobileDirectory: stale,
      env: productionEnv,
      pods: false,
    })
    const missing = mobileWith(t, iosProject(productionProjects.ios, null))
    assert.throws(
      () =>
        assertNativeProbeMode({
          platform: 'ios',
          mobileDirectory: missing,
          env: productionEnv,
        }),
      /^Error: native_probe_mode_project_missing:ios:Podfile\.lock$/
    )
    const fresh = mobileWith(t, iosProject(probeProjects.ios, installed.probe))
    assertNativeProbeMode({ platform: 'ios', mobileDirectory: fresh, env: probeEnv })
    // Android has no pods: its settings.gradle alone decides.
    const android = mobileWith(t, { [PROBE_MODE_FILES.android]: probeProjects.android })
    assertNativeProbeMode({
      platform: 'android',
      mobileDirectory: android,
      env: probeEnv,
    })
  })

  test('the runner checks the mode after prebuild, after pod install and before every build', () => {
    const runner = fs.readFileSync(
      fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
      'utf8'
    )
    const prebuild = runner.indexOf("if (command === 'prebuild') {")
    const build = runner.indexOf("} else if (command === 'build') {")
    const podInstall = runner.indexOf('IOS_POD_INSTALL.binary', prebuild)
    const staging = runner.indexOf('prepareWorkletsStaging({', build)
    const spawnBuild = runner.indexOf('const result = spawnSync(binary, args, {', build)
    const checks = [
      ...runner.matchAll(/assertNativeProbeMode\((\{[\s\S]*?\}|[^)]*)\)/g),
    ].map((m) => ({
      at: m.index,
      podsSkipped: /pods:\s*false/.test(m[1]),
    }))
    assert.ok(prebuild >= 0 && podInstall > prebuild && build > podInstall)
    assert.ok(staging > build && spawnBuild > staging)
    assert.ok(
      checks.some(({ at }) => at > prebuild && at < podInstall),
      'checked after prebuild'
    )
    assert.ok(
      checks.some(({ at, podsSkipped }) => at > podInstall && at < build && !podsSkipped),
      'the Pods checked after pod install'
    )
    // Before anything is staged into the project (Android worklets), so before the build too.
    const buildChecks = checks.filter(({ at }) => at > build && at < spawnBuild)
    assert.ok(
      buildChecks.some(({ at }) => at < staging),
      'checked before staging'
    )
    assert.ok(
      buildChecks.every(({ podsSkipped }) => !podsSkipped),
      'every build check covers the Pods'
    )
  })
})
