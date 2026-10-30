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

test(
  'generated and officially merged Android permissions keep add-only export and image-picker needs',
  { timeout: 180000 },
  async (t) => {
    const {
      generateAndroidPermissionProof,
    } = require('./share-card-android-permissions-proof')
    const { generated, manifest } = await generateAndroidPermissionProof(t)
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
