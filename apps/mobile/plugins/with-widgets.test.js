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

    const swiftWidgetSource = fs.readFileSync(
      path.join(mobileRoot, 'targets/widgets/OutfitWidget.swift'),
      'utf8'
    )
    const kotlinWidgetSource = fs.readFileSync(
      path.join(mobileRoot, 'targets/widgets/android/java/OutfitWidgetProvider.kt'),
      'utf8'
    )
    for (const localeFile of fs.readdirSync(path.join(mobileRoot, 'assets/locales'))) {
      if (!localeFile.endsWith('.json')) continue
      const locale = JSON.parse(
        fs.readFileSync(path.join(mobileRoot, 'assets/locales', localeFile), 'utf8')
      )
      for (const value of Object.values(locale.widget)) {
        assert.ok(
          swiftWidgetSource.includes(value),
          `${localeFile} widget copy is missing from iOS fallback`
        )
        assert.ok(
          kotlinWidgetSource.includes(value),
          `${localeFile} widget copy is missing from Android fallback`
        )
      }
    }

    const xcodeProject = fs.readFileSync(
      path.join(fixtureRoot, 'ios/CoutureCast.xcodeproj/project.pbxproj'),
      'utf8'
    )
    assert.match(xcodeProject, /OutfitWidget\.appex in Copy Files/)
    assert.match(xcodeProject, /OutfitWidget\.swift in Sources/)
    assert.match(xcodeProject, /WidgetSharedModule\.m in Sources/)
    assert.match(xcodeProject, /WidgetSharedModule\.swift in Sources/)
    assert.match(xcodeProject, /SpaceGrotesk-Regular\.ttf in Resources/)
    const deploymentTargets = [
      ...xcodeProject.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g),
    ].map((match) => match[1])
    assert.ok(deploymentTargets.length > 0)
    assert.equal(new Set(deploymentTargets).size, 1)

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
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'ios/CoutureCast/WidgetBridge/WidgetSharedModule.m')
      )
    )
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'ios/CoutureCast/WidgetBridge/WidgetSharedModule.swift')
      )
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
        path.join(
          fixtureRoot,
          'android/app/src/main/java/com/anonymous/mobile/WidgetConstants.kt'
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
