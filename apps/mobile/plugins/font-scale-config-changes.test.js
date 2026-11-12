// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// F-12 (TEA-15, Codex R2-03): with the plugin, the prebuilt manifest differs from the one
// without it by exactly one token: `fontScale` appended to MainActivity's configChanges. Every
// existing token and every other attribute and Activity stay as they were, so locale and
// density changes still recreate the Activity and uiMode is still handled in place.
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

const PLUGIN = './plugins/with-font-scale-config-changes'

function prebuiltManifest(t, { withPlugin }) {
  const root = createExpoPrebuildFixture(t, {
    prefix: `couture-font-scale-${withPlugin ? 'on' : 'off'}-`,
  })
  const appJson = path.join(root, 'app.json')
  const app = JSON.parse(fs.readFileSync(appJson, 'utf8'))
  app.expo.plugins = app.expo.plugins.filter((plugin) => plugin !== PLUGIN)
  // Listed first, its manifest mod runs after the other plugins' mods, so the token is appended.
  if (withPlugin) app.expo.plugins.unshift(PLUGIN)
  fs.writeFileSync(appJson, JSON.stringify(app, null, 2))
  assertCommand(runExpoPrebuild(root, { platform: 'android' }), 'Android prebuild failed')
  return fs.readFileSync(
    path.join(root, 'android/app/src/main/AndroidManifest.xml'),
    'utf8'
  )
}

const MAIN =
  /(<activity[^>]*android:name="\.MainActivity"[^>]*android:configChanges=")([^"]*)(")/

/**
 * Throws unless `candidate` is `control` with `fontScale` appended to MainActivity's
 * configChanges and nothing else in the document changed: every other token, attribute and
 * Activity is byte-identical (Codex R3-06).
 */
function assertFontScaleDelta(control, candidate) {
  const before = MAIN.exec(control)
  assert.ok(before, 'control MainActivity declares configChanges')
  const tokens = before[2].split('|')
  assert.ok(!tokens.includes('fontScale'), 'control already handles fontScale')
  const expected = control.replace(MAIN, `$1${[...tokens, 'fontScale'].join('|')}$3`)
  assert.equal(candidate, expected)
}

test(
  'the plugin adds exactly fontScale to MainActivity and nothing else',
  { timeout: 180000 },
  (t) => {
    const control = prebuiltManifest(t, { withPlugin: false })
    const candidate = prebuiltManifest(t, { withPlugin: true })
    assertFontScaleDelta(control, candidate)
    for (const kept of ['uiMode', 'locale', 'orientation', 'screenSize'])
      assert.match(candidate, new RegExp(`android:configChanges="[^"]*\\b${kept}\\b`))
    for (const absent of ['density'])
      assert.doesNotMatch(
        candidate,
        new RegExp(`android:configChanges="[^"]*\\b${absent}\\b`)
      )
  }
)

// The mutants Codex named (R2-03, R3-06); each must fail the exact-delta check.
const CONTROL = [
  '<manifest>',
  '<application>',
  '<activity android:name=".MainActivity" android:configChanges="keyboard|orientation|uiMode|locale" android:exported="true"/>',
  '<activity android:name=".Other" android:configChanges="keyboard"/>',
  '</application>',
  '</manifest>',
].join('\n')
const MUTANTS = {
  'fontScale removed': CONTROL,
  'original tokens replaced': CONTROL.replace(
    'keyboard|orientation|uiMode|locale" android:exported',
    'fontScale" android:exported'
  ),
  'density added': CONTROL.replace(
    'uiMode|locale" android:exported',
    'uiMode|locale|fontScale|density" android:exported'
  ),
  'every other Activity set to fontScale': CONTROL.replace(
    'uiMode|locale" android:exported',
    'uiMode|locale|fontScale" android:exported'
  ).replace(
    'android:name=".Other" android:configChanges="keyboard"',
    'android:name=".Other" android:configChanges="fontScale"'
  ),
  'token on another Activity': CONTROL.replace(
    'android:name=".Other" android:configChanges="keyboard"',
    'android:name=".Other" android:configChanges="keyboard|fontScale"'
  ),
}

test('the exact-delta check accepts the right change and refuses each mutant', () => {
  assertFontScaleDelta(
    CONTROL,
    CONTROL.replace(
      'uiMode|locale" android:exported',
      'uiMode|locale|fontScale" android:exported'
    )
  )
  for (const [name, mutant] of Object.entries(MUTANTS))
    assert.throws(
      () => assertFontScaleDelta(CONTROL, mutant),
      assert.AssertionError,
      name
    )
})

function manifestWith(configChanges) {
  return {
    modResults: {
      manifest: {
        application: [
          {
            activity: [
              {
                $: {
                  'android:name': '.SomethingElse',
                  'android:configChanges': 'keyboard',
                },
              },
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

test('the plugin is idempotent, keeps order, leaves other Activities and handles a missing attribute', async () => {
  const value = (result, name) =>
    result.modResults.manifest.application[0].activity.find(
      (entry) => entry.$['android:name'] === name
    ).$['android:configChanges']
  const once = await applyMod(manifestWith('keyboard|orientation|uiMode'))
  assert.equal(value(once, '.MainActivity'), 'keyboard|orientation|uiMode|fontScale')
  assert.equal(value(once, '.SomethingElse'), 'keyboard')
  const twice = await applyMod(manifestWith('keyboard|fontScale|uiMode'))
  assert.equal(value(twice, '.MainActivity'), 'keyboard|fontScale|uiMode')
  const missing = await applyMod(manifestWith(undefined))
  assert.equal(value(missing, '.MainActivity'), 'fontScale')
})
