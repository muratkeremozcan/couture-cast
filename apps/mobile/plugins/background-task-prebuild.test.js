// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// P0-06: the ritual task moved from expo-background-fetch to expo-background-task. Expo applies
// the fetch plugin on its own; the task plugin runs only when app.json lists it, and without it
// iOS refuses to schedule the task because its identifier is not permitted.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const plist = require('@expo/plist').default
const {
  assertCommand,
  createExpoPrebuildFixture,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')

const TASK_IDENTIFIER = 'com.expo.modules.backgroundtask.processing'

test(
  'iOS permits the background task identifier, runs it as processing and no longer asks for fetch',
  { timeout: 90000 },
  (t) => {
    const root = createExpoPrebuildFixture(t, { prefix: 'couture-background-task-ios-' })
    assertCommand(runExpoPrebuild(root), 'Background task iOS prebuild failed')
    const info = plist.parse(
      fs.readFileSync(path.join(root, 'ios/CoutureCast/Info.plist'), 'utf8')
    )
    assert.ok(
      info.UIBackgroundModes.includes('processing'),
      `UIBackgroundModes: ${info.UIBackgroundModes}`
    )
    assert.ok(
      !info.UIBackgroundModes.includes('fetch'),
      `UIBackgroundModes: ${info.UIBackgroundModes}`
    )
    assert.deepEqual(info.BGTaskSchedulerPermittedIdentifiers, [TASK_IDENTIFIER])
  }
)

test(
  'Android carries no background fetch component or package',
  { timeout: 90000 },
  (t) => {
    const root = createExpoPrebuildFixture(t, {
      prefix: 'couture-background-task-android-',
    })
    assertCommand(
      runExpoPrebuild(root, { platform: 'android' }),
      'Background task Android prebuild failed'
    )
    const manifest = fs.readFileSync(
      path.join(root, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    )
    assert.doesNotMatch(manifest, /backgroundfetch/i)
    const settings = fs.readFileSync(path.join(root, 'android/settings.gradle'), 'utf8')
    assert.doesNotMatch(settings, /expo-background-fetch/)
  }
)
