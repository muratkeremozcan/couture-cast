const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const mobileRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(mobileRoot, '../..')
const expoCli = require.resolve('expo/bin/cli', { paths: [repositoryRoot] })

function copyFixtureEntry(fixtureRoot, entry) {
  fs.cpSync(path.join(mobileRoot, entry), path.join(fixtureRoot, entry), {
    recursive: true,
  })
}

test(
  'clean Expo prebuild generates both widget integrations',
  { timeout: 60_000 },
  (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-widget-prebuild-'))
    t.after(() => {
      assert.match(fixtureRoot, /couture-widget-prebuild-/)
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    })

    for (const entry of ['app.json', 'package.json', 'plugins', 'targets', 'assets']) {
      copyFixtureEntry(fixtureRoot, entry)
    }
    fs.symlinkSync(
      path.join(repositoryRoot, 'node_modules'),
      path.join(fixtureRoot, 'node_modules')
    )

    const appJsonPath = path.join(fixtureRoot, 'app.json')
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    appJson.expo.ios.entitlements = {
      'com.apple.security.application-groups': ['group.existing.integration'],
    }
    fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

    const result = spawnSync(
      process.execPath,
      [expoCli, 'prebuild', '--platform', 'all', '--no-install'],
      {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: { ...process.env, CI: '1' },
        timeout: 50_000,
      }
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

    const xcodeProject = fs.readFileSync(
      path.join(fixtureRoot, 'ios/CoutureCast.xcodeproj/project.pbxproj'),
      'utf8'
    )
    assert.match(xcodeProject, /OutfitWidget\.appex in Copy Files/)
    assert.match(xcodeProject, /OutfitWidget\.swift in Sources/)
    assert.match(xcodeProject, /SpaceGrotesk-Regular\.ttf in Resources/)

    const mainEntitlements = fs.readFileSync(
      path.join(fixtureRoot, 'ios/CoutureCast/CoutureCast.entitlements'),
      'utf8'
    )
    assert.match(mainEntitlements, /group\.existing\.integration/)
    assert.match(mainEntitlements, /group\.com\.anonymous\.mobile/)
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/OutfitWidget/OutfitWidget.swift'))
    )
    assert.ok(
      fs.existsSync(path.join(fixtureRoot, 'ios/OutfitWidget/OutfitWidget.entitlements'))
    )

    const androidMain = fs.readFileSync(
      path.join(
        fixtureRoot,
        'android/app/src/main/java/com/anonymous/mobile/MainApplication.kt'
      ),
      'utf8'
    )
    const androidManifest = fs.readFileSync(
      path.join(fixtureRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    )
    assert.match(androidMain, /add\(WidgetSharedPackage\(\)\)/)
    assert.match(androidManifest, /OutfitWidgetProviderSmall/)
    assert.match(androidManifest, /OutfitWidgetProviderMedium/)
    assert.ok(
      fs.existsSync(
        path.join(
          fixtureRoot,
          'android/app/src/main/java/com/anonymous/mobile/WidgetSharedModule.kt'
        )
      )
    )
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'android/app/src/main/res/layout/widget_medium.xml')
      )
    )
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'android/app/src/main/res/font/space_grotesk.ttf')
      )
    )
  }
)
