// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-12: MainActivity declares `fontScale` in configChanges, so a system font change reaches the
// running Activity instead of recreating it, and the template's own values keep their order.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  assertCommand,
  createExpoPrebuildFixture,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')
const withFontScaleConfigChanges = require('./with-font-scale-config-changes')

function mainActivityConfigChanges(manifest) {
  const activity = /<activity[^>]*android:name="\.MainActivity"[^>]*>/.exec(manifest)
  assert.ok(activity, 'MainActivity is missing from the manifest')
  return /android:configChanges="([^"]*)"/.exec(activity[0])?.[1].split('|') ?? []
}

test(
  'the prebuilt MainActivity handles fontScale and keeps the template values',
  { timeout: 120000 },
  (t) => {
    const root = createExpoPrebuildFixture(t, { prefix: 'couture-font-scale-config-' })
    const appJson = path.join(root, 'app.json')
    const app = JSON.parse(fs.readFileSync(appJson, 'utf8'))
    if (!app.expo.plugins.includes('./plugins/with-font-scale-config-changes'))
      app.expo.plugins.push('./plugins/with-font-scale-config-changes')
    fs.writeFileSync(appJson, JSON.stringify(app, null, 2))
    assertCommand(
      runExpoPrebuild(root, { platform: 'android' }),
      'Font-scale configChanges prebuild failed'
    )
    const values = mainActivityConfigChanges(
      fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
    )
    assert.equal(values.filter((value) => value === 'fontScale').length, 1)
    // The template's values and expo-localization's locale handling stay, in their order.
    const kept = values.filter((value) => value !== 'fontScale')
    const template = [
      'keyboard',
      'keyboardHidden',
      'orientation',
      'screenSize',
      'uiMode',
      'locale',
    ]
    assert.deepEqual(
      kept.filter((value) => template.includes(value)),
      template,
      values.join('|')
    )
  }
)

function manifestWith(configChanges) {
  return {
    modResults: {
      manifest: {
        application: [
          {
            activity: [
              { $: { 'android:name': '.SomethingElse' } },
              {
                $: {
                  'android:name': '.MainActivity',
                  ...(configChanges === undefined
                    ? {}
                    : { 'android:configChanges': configChanges }),
                },
              },
            ],
          },
        ],
      },
    },
  }
}

/** Runs the plugin's manifest mod directly, without a prebuild. */
function applyMod(config) {
  const withMods = withFontScaleConfigChanges({ name: 'x', slug: 'x', ...config })
  return withMods.mods.android.manifest(config)
}

test('the plugin is idempotent, keeps order and handles a missing attribute', async () => {
  const once = await applyMod(manifestWith('keyboard|orientation|uiMode'))
  const activity = (result) =>
    result.modResults.manifest.application[0].activity.find(
      (entry) => entry.$['android:name'] === '.MainActivity'
    ).$['android:configChanges']
  assert.equal(activity(once), 'keyboard|orientation|uiMode|fontScale')
  const twice = await applyMod(manifestWith('keyboard|fontScale|uiMode'))
  assert.equal(activity(twice), 'keyboard|fontScale|uiMode')
  const missing = await applyMod(manifestWith(undefined))
  assert.equal(activity(missing), 'fontScale')
})
