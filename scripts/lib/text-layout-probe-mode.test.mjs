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
  PROBE_MODE_FILES,
  assertNativeProbeMode,
  generatedProbeMode,
  probeModeProblem,
  requestedProbeMode,
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
    for (const [platform, file] of Object.entries(PROBE_MODE_FILES)) {
      fs.mkdirSync(path.join(mobile, path.dirname(file)), { recursive: true })
      fs.writeFileSync(path.join(mobile, file), productionProjects[platform])
      assert.throws(
        () => assertNativeProbeMode({ platform, mobileDirectory: mobile, env: probeEnv }),
        /native_probe_mode_mismatch/
      )
      assertNativeProbeMode({ platform, mobileDirectory: mobile, env: productionEnv })
    }
  })

  test('the runner checks the mode after prebuild and before every build', () => {
    const runner = fs.readFileSync(
      fileURLToPath(new URL('../run-story68-native.mjs', import.meta.url)),
      'utf8'
    )
    const prebuild = runner.indexOf("if (command === 'prebuild') {")
    const build = runner.indexOf("} else if (command === 'build') {")
    const spawnBuild = runner.indexOf('const result = spawnSync(binary, args, {', build)
    const checks = [...runner.matchAll(/assertNativeProbeMode\(\{/g)].map((m) => m.index)
    assert.ok(prebuild >= 0 && build > prebuild && spawnBuild > build)
    assert.ok(
      checks.some((at) => at > prebuild && at < build),
      'checked after prebuild'
    )
    assert.ok(
      checks.some((at) => at > build && at < spawnBuild),
      'checked before the build runs'
    )
  })
})
