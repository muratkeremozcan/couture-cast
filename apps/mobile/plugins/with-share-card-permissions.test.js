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
    for (const name of fs.readdirSync(path.join(root, 'locales'))) {
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
