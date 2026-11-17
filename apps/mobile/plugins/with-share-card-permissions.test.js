// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
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
const supportedLocaleConfig = require('../../../packages/api-client/src/contracts/http/supported-locales.json')

test(
  'generated iOS permissions preserve image-picker read access and share-card add-only purposes in every locale',
  { timeout: 90000 },
  (t) => {
    const root = createExpoPrebuildFixture(t, {
      prefix: 'couture-share-card-permissions-',
      entries: ['app.json', 'package.json', 'plugins', 'targets', 'assets', 'locales'],
    })
    assertCommand(runExpoPrebuild(root), 'Share-card permission prebuild failed')
    const info = plist.parse(
      fs.readFileSync(path.join(root, 'ios/CoutureCast/Info.plist'), 'utf8')
    )
    assert.equal(
      info.NSPhotoLibraryUsageDescription,
      'Allow CoutureCast to choose wardrobe photos.'
    )
    assert.equal(
      info.NSPhotoLibraryAddUsageDescription,
      'Allow CoutureCast to save the card you approve to your photos.'
    )
    // U-PLUGIN-MANIFEST: native sharing hands a file to the share sheet and asks for nothing.
    assert.deepEqual(
      Object.keys(info)
        .filter((key) => key.endsWith('UsageDescription'))
        .sort(),
      [
        'NSCameraUsageDescription',
        'NSFaceIDUsageDescription',
        'NSPhotoLibraryAddUsageDescription',
        'NSPhotoLibraryUsageDescription',
      ]
    )
    const catalogs = fs.readdirSync(path.join(root, 'locales')).sort()
    assert.deepEqual(
      catalogs,
      Object.keys(supportedLocaleConfig)
        .sort()
        .map((locale) => `${locale}.json`)
    )
    assert.equal(catalogs.length, 10)
    for (const name of catalogs) {
      const expected = JSON.parse(
        fs.readFileSync(path.join(root, 'locales', name), 'utf8')
      ).ios
      const localized = fs.readFileSync(
        path.join(
          root,
          'ios/CoutureCast/Supporting',
          name.replace('.json', '.lproj'),
          'InfoPlist.strings'
        ),
        'utf8'
      )
      for (const key of [
        'NSPhotoLibraryUsageDescription',
        'NSPhotoLibraryAddUsageDescription',
      ]) {
        assert.ok(expected[key].trim())
        assert.ok(
          localized.includes(key + ' = ' + JSON.stringify(expected[key])),
          name + ': ' + key
        )
      }
    }
  }
)

test('a failed command names its spawn error, so a command killed at its timeout says so', () => {
  const timedOut = Object.assign(new Error('spawnSync android/gradlew ETIMEDOUT'), {
    code: 'ETIMEDOUT',
  })
  assert.throws(
    () =>
      assertCommand(
        { status: 143, signal: null, error: timedOut, stdout: '> Task :x', stderr: '' },
        'Official Android manifest merger failed'
      ),
    (error) => {
      assert.equal(
        error.message.split('\n')[0],
        'Official Android manifest merger failed (spawnSync android/gradlew ETIMEDOUT)'
      )
      return true
    }
  )
})

test('the Android merger proof retries a rate-limited or dropped download and nothing else', () => {
  const {
    isTransientResolutionFailure,
    runWithResolutionRetry,
  } = require('./share-card-android-permissions-proof')
  const tooMany = {
    status: 1,
    stdout: '',
    stderr:
      "Could not GET 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.11.0/gson-2.11.0.pom'. Received status code 429 from server: Too Many Requests",
  }
  const conflict = {
    status: 1,
    stdout: 'Error: Attribute application@allowBackup value=(false) is also present',
    stderr: '',
  }
  const passed = { status: 0, stdout: 'BUILD SUCCESSFUL', stderr: '' }
  assert.equal(isTransientResolutionFailure(tooMany), true)
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stderr: 'Received status code 503 from server',
    }),
    true
  )
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stderr:
        'java.io.IOException: Server returned HTTP response code: 504 for URL: https://services.gradle.org/distributions/gradle-8.14.3-bin.zip',
    }),
    true
  )
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stderr: 'java.net.SocketTimeoutException: Connect timed out',
    }),
    true
  )
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stderr:
        'Server returned HTTP response code: 404 for URL: https://example.test/x.zip',
    }),
    false
  )
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stderr:
        'Could not find com.android.tools.build:manifest-merger:99.0.0. Searched in the following locations',
    }),
    false
  )
  assert.equal(isTransientResolutionFailure(conflict), false)
  assert.equal(
    isTransientResolutionFailure({ ...passed, stdout: 'status code 429' }),
    false
  )

  const waits = []
  const sequence = [tooMany, tooMany, passed]
  assert.deepEqual(
    runWithResolutionRetry(() => sequence.shift(), { wait: (ms) => waits.push(ms) }),
    passed
  )
  assert.deepEqual(waits, [20000, 40000])

  const conflictWaits = []
  let conflictRuns = 0
  const result = runWithResolutionRetry(
    () => {
      conflictRuns += 1
      return conflict
    },
    { wait: (ms) => conflictWaits.push(ms) }
  )
  assert.equal(result, conflict)
  assert.equal(conflictRuns, 1)
  assert.deepEqual(conflictWaits, [])

  let limitedRuns = 0
  const exhausted = runWithResolutionRetry(
    () => {
      limitedRuns += 1
      return tooMany
    },
    { wait: () => undefined }
  )
  assert.equal(exhausted, tooMany)
  assert.equal(limitedRuns, 3)
})

// PR 253 run 44169550859 and main run 44160668534: the merge printed `> Task :processMainManifest`
// and then nothing until its 120 s cap killed Gradle (status 143), so the retry above never saw an
// error. A stalled repository reproduces it: Gradle 8.14.3 sends the stalled GET three times and
// waits out its 30 s socket timeout each time, 96 s before it prints "Read timed out".
test('the Android merger proof ends a stalled download inside its merge cap, as a retried error', () => {
  const {
    GRADLE_HTTP_TIMEOUT_MS,
    MERGE_TIMEOUT_MS,
    isTransientResolutionFailure,
    mergerGradleProperties,
  } = require('./share-card-android-permissions-proof')
  assert.equal(
    mergerGradleProperties(),
    'systemProp.org.gradle.internal.http.connectionTimeout=10000\n' +
      'systemProp.org.gradle.internal.http.socketTimeout=10000\n'
  )
  assert.equal(MERGE_TIMEOUT_MS, 120000)
  // Two stalled resources, three GETs each, still leave half the cap for the wrapper and startup.
  assert.equal(2 * 3 * GRADLE_HTTP_TIMEOUT_MS <= MERGE_TIMEOUT_MS / 2, true)
  assert.equal(
    isTransientResolutionFailure({
      status: 1,
      stdout:
        "> Could not GET 'https://dl.google.com/dl/android/maven2/com/android/tools/build/manifest-merger/31.11.0/manifest-merger-31.11.0.pom'.\n   > Read timed out",
      stderr: '',
    }),
    true
  )
})

test(
  'generated and officially merged Android permissions keep add-only export and image-picker needs',
  // Prebuild (50 s cap) plus up to three merges (120 s cap each) and 60 s of waits: 470 s.
  { timeout: 480000 },
  async (t) => {
    const {
      generateAndroidPermissionProof,
    } = require('./share-card-android-permissions-proof')
    const { generated, gradleProperties, manifest } =
      await generateAndroidPermissionProof(t)
    assert.equal(
      gradleProperties,
      'systemProp.org.gradle.internal.http.connectionTimeout=10000\n' +
        'systemProp.org.gradle.internal.http.socketTimeout=10000\n'
    )
    const declarations = new Map(
      generated.manifest['uses-permission'].map((item) => [
        item.$['android:name'],
        item.$,
      ])
    )
    const permissions = new Set(
      manifest.manifest['uses-permission'].map((item) => item.$['android:name'])
    )
    for (const permission of [
      'READ_MEDIA_VISUAL_USER_SELECTED',
      'READ_MEDIA_AUDIO',
      'READ_MEDIA_VIDEO',
      'ACCESS_MEDIA_LOCATION',
    ]) {
      const name = `android.permission.${permission}`
      assert.equal(
        permissions.has(name),
        false,
        `${name} must be absent after actual library merge`
      )
      assert.equal(
        declarations.get(name)?.['tools:node'],
        'remove',
        `${name} must be removed by generated application policy`
      )
    }
    for (const permission of [
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ]) {
      assert.ok(
        permissions.has(`android.permission.${permission}`),
        `${permission} remains available to the legacy image picker and add-only save`
      )
    }
    for (const permission of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
      const declaration = manifest.manifest['uses-permission'].find(
        (item) => item.$['android:name'] === `android.permission.${permission}`
      ).$
      const maximum = declaration['android:maxSdkVersion']
      assert.ok(
        maximum === undefined || Number(maximum) >= 32,
        `${permission} must remain available through API32 for existing picker/save paths`
      )
    }
    assert.equal(permissions.has('android.permission.READ_MEDIA_IMAGES'), false)
    assert.equal(permissions.has('android.permission.QUERY_ALL_PACKAGES'), false)
  }
)

test('U-PLUGIN-MANIFEST: the share module merges one unexported provider and no permission, query or plugin', async () => {
  const { AndroidConfig } = require('@expo/config-plugins')
  const { mobileRoot } = require('./prebuild-test-helpers')
  const moduleRoot = path.join(mobileRoot, 'modules/share-card-native-share')
  const { manifest } = await AndroidConfig.Manifest.readAndroidManifestAsync(
    path.join(moduleRoot, 'android/src/main/AndroidManifest.xml')
  )
  // No uses-permission, permission, queries or other component reaches the merged app manifest.
  assert.deepEqual(
    Object.keys(manifest).filter((key) => key !== '$'),
    ['application']
  )
  assert.equal(manifest.application.length, 1)
  const application = manifest.application[0]
  assert.deepEqual(
    Object.keys(application).filter((key) => key !== '$'),
    ['provider']
  )
  assert.equal(application.provider.length, 1)
  const provider = application.provider[0]
  assert.deepEqual(provider.$, {
    'android:name': 'expo.modules.sharecardnativeshare.ShareCardFileProvider',
    'android:authorities': '${applicationId}.sharecardnativeshare.fileprovider',
    'android:exported': 'false',
    'android:grantUriPermissions': 'true',
  })
  assert.deepEqual(
    provider['meta-data'].map((item) => item.$),
    [
      {
        'android:name': 'android.support.FILE_PROVIDER_PATHS',
        'android:resource': '@xml/share_card_native_share_paths',
      },
    ]
  )
  const paths = fs.readFileSync(
    path.join(moduleRoot, 'android/src/main/res/xml/share_card_native_share_paths.xml'),
    'utf8'
  )
  assert.deepEqual(
    [...paths.matchAll(/<([a-z-]+-path)\b[^>]*>/g)].map((match) => match[0]),
    ['<cache-path name="share_cards" path="share-cards/" />']
  )
  // The module carries no config plugin, so it cannot add a permission or an Info.plist string.
  assert.equal(fs.existsSync(path.join(moduleRoot, 'app.plugin.js')), false)
  const config = JSON.parse(
    fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8')
  )
  assert.deepEqual(Object.keys(config).sort(), ['android', 'apple', 'platforms'])
  const podspec = fs.readFileSync(
    path.join(moduleRoot, 'ios/ShareCardNativeShare.podspec'),
    'utf8'
  )
  assert.match(podspec, /s\.frameworks = 'UIKit', 'CryptoKit'/)
})
