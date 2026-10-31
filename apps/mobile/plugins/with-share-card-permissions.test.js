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
  }
)
