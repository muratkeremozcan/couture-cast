const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  assertCommand,
  createExpoPrebuildFixture,
  mobileRoot,
  runExpoPrebuild,
} = require('./prebuild-test-helpers')

test(
  'clean Expo prebuild generates both widget integrations',
  { timeout: 60_000 },
  (t) => {
    const fixtureRoot = createExpoPrebuildFixture(t, {
      prefix: 'couture-widget-prebuild-',
    })

    const appJsonPath = path.join(fixtureRoot, 'app.json')
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
    appJson.expo.ios.entitlements = {
      'com.apple.security.application-groups': ['group.existing.integration'],
    }
    fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

    assertCommand(
      runExpoPrebuild(fixtureRoot, { platform: 'all' }),
      'Expo widget prebuild failed'
    )

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
    assert.match(xcodeProject, /WatchSyncSupport\.swift in Sources/)
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
    assert.ok(
      fs.existsSync(
        path.join(fixtureRoot, 'ios/CoutureCast/WidgetBridge/WatchSyncSupport.swift')
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
