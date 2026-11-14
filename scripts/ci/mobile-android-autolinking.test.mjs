// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 P0-07 (TEA T3): the Android autolinking of apps/mobile's local modules. Expo
// autolinking finds an Android Package only by a file name ending Package.kt (or .java) that
// imports expo.modules.core.interfaces.Package, and a Module only through its
// expo-module.config.json. The Robolectric spec calls the migration listener directly, so a
// rename that unlinks the persisted task cleanup would leave it green. This spec generates the
// package list the Android build compiles and requires both P0-07 modules in it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const mobile = fileURLToPath(new URL('../../apps/mobile/', import.meta.url))

/** The generated ExpoModulesPackageList.java for apps/mobile, as the Android build makes it. */
function androidPackageList() {
  const cli = createRequire(path.join(mobile, 'package.json')).resolve(
    'expo-modules-autolinking/bin/expo-modules-autolinking.js'
  )
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc615-autolinking-'))
  try {
    const target = path.join(dir, 'ExpoModulesPackageList.java')
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'generate-package-list',
        '--platform',
        'android',
        '--namespace',
        'expo.modules',
        '--target',
        target,
      ],
      { cwd: mobile, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' }
    )
    assert.equal(
      result.status,
      0,
      `autolinking exited ${result.status}: ${result.stderr}`
    )
    return fs.readFileSync(target, 'utf8')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('the Android build links the P0-07 persisted task cleanup and the headless timers module', () => {
  const list = androidPackageList()
  assert.match(
    list,
    /^\s*new expo\.modules\.taskmanagermigration\.TaskManagerMigrationPackage\(\),?$/m
  )
  assert.match(
    list,
    /^\s*expo\.modules\.headlessjstimers\.HeadlessJsTimersModule\.class,?$/m
  )
})
