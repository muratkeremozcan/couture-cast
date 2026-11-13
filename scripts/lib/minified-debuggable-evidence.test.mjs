// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S4-15 (R3-03): the native-debuggable and R8 facts are each judged on their own, from text in
// the shapes aapt2, dumpsys and R8 print. The fixtures copy lines from the first
// minifiedDebuggable build (2026-11-13) and from a Release-shaped build for the renamed case.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  badgingDebuggable,
  badgingPackage,
  collectEvidence,
  collectReleaseR8,
  releaseMinifyConfig,
  releaseR8Status,
  revenueCatSurvival,
  defaultProbeClass,
  dumpsysDebuggable,
  r8Evidence,
  variantOutputs,
} from './minified-debuggable-evidence.mjs'

const BADGING = `package: name='com.couturecast.app' versionCode='6' versionName='1.0.0' platformBuildVersionName='16'
sdkVersion:'24'
targetSdkVersion:'36'
application-label:'Couture Cast'
application-debuggable
launchable-activity: name='com.couturecast.app.MainActivity'
`
const RELEASE_BADGING = BADGING.replace('application-debuggable\n', '')

const DUMPSYS = `Packages:
  Package [com.couturecast.app] (8f1c2d):
    userId=10190
    pkg=Package{5d2 com.couturecast.app}
    flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE ]
  Package [com.other.app] (11aa):
    flags=[ DEBUGGABLE HAS_CODE ]
`
const RELEASE_DUMPSYS = DUMPSYS.replace(
  'flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA',
  'flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA'
)

// minifiedDebuggable: AGP turns obfuscation off, so classes keep their names and R8 only removes.
const SHRUNK_MAPPING = `# compiler: R8
# pg_map_id: 3c1f
com.revenuecat.purchases.common.Backend -> com.revenuecat.purchases.common.Backend:
# {"id":"sourceFile","fileName":"Backend.kt"}
    1:3:void <init>():10:12 -> <init>
androidx.collection.LongListKt -> R8$$REMOVED$$CLASS$$0:
com.couturecast.app.MainActivity -> com.couturecast.app.MainActivity:
com.revenuecat.purchases.Purchases -> com.revenuecat.purchases.Purchases:
com.revenuecat.purchases.hybridcommon.CommonKt -> com.revenuecat.purchases.hybridcommon.CommonKt:
`
const SHRUNK_USAGE = `com.couturecast.app.OutfitWidgetProviderKt
com.couturecast.app.R$drawable
com.couturecast.app.WidgetSharedPackage:
    public void unused()
`
const RENAMED_MAPPING = `com.couturecast.app.R$drawable -> a.b:
com.couturecast.app.MainActivity -> com.couturecast.app.MainActivity:
`
const PROBE = 'com.couturecast.app.R$drawable'

test('the APK manifest flag is read from badging, and a Release badging is not debuggable', () => {
  assert.equal(badgingPackage(BADGING), 'com.couturecast.app')
  assert.equal(badgingDebuggable(BADGING), true)
  assert.equal(badgingDebuggable(RELEASE_BADGING), false)
  assert.throws(() => badgingDebuggable('ERROR: dump failed'), /badging_unreadable/)
})

test("the installed flag is read from the package's own section only", () => {
  assert.equal(dumpsysDebuggable(DUMPSYS, 'com.couturecast.app'), true)
  // The next package is debuggable; that must not leak into this one.
  assert.equal(dumpsysDebuggable(RELEASE_DUMPSYS, 'com.couturecast.app'), false)
  assert.throws(() => dumpsysDebuggable(DUMPSYS, 'com.absent.app'), /package_missing/)
})

test('a shrink-only build counts as R8 by a removed probe and reports no obfuscation', () => {
  assert.equal(defaultProbeClass('com.couturecast.app'), PROBE)
  const evidence = r8Evidence({
    mapping: SHRUNK_MAPPING,
    usage: SHRUNK_USAGE,
    probeClass: PROBE,
  })
  assert.deepEqual(evidence, {
    mappedClasses: 5,
    renamedClasses: 0,
    removedClasses: 3,
    obfuscated: false,
    probe: { class: PROBE, fate: 'removed' },
  })
  // A class R8 replaced with a removal placeholder counts as removed too.
  assert.equal(
    r8Evidence({ mapping: SHRUNK_MAPPING, probeClass: 'androidx.collection.LongListKt' })
      .probe.fate,
    'removed'
  )
})

test('a renamed probe counts, and a kept or missing probe or an empty mapping fails', () => {
  assert.deepEqual(r8Evidence({ mapping: RENAMED_MAPPING, probeClass: PROBE }).probe, {
    class: PROBE,
    fate: 'renamed',
    to: 'a.b',
  })
  assert.throws(
    () =>
      r8Evidence({
        mapping: SHRUNK_MAPPING,
        usage: SHRUNK_USAGE,
        probeClass: 'com.couturecast.app.MainActivity',
      }),
    /probe_kept/
  )
  // A class with only some members removed is not a removed class.
  assert.throws(
    () =>
      r8Evidence({
        mapping: SHRUNK_MAPPING,
        usage: SHRUNK_USAGE,
        probeClass: 'com.couturecast.app.WidgetSharedPackage',
      }),
    /probe_unaccounted/
  )
  assert.throws(
    () => r8Evidence({ mapping: '# compiler: R8\n', probeClass: PROBE }),
    /mapping_empty/
  )
  assert.throws(() => r8Evidence({ mapping: SHRUNK_MAPPING }), /probe_required/)
})

test('collectEvidence runs the tools on the variant outputs and records the three facts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-minified-evidence-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const outputs = variantOutputs(root)
  for (const [file, contents] of [
    [outputs.apk, 'apk'],
    [outputs.mapping, SHRUNK_MAPPING],
    [outputs.usage, SHRUNK_USAGE],
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  const tool = (name, output) => {
    const file = path.join(root, name)
    fs.writeFileSync(file, `#!/bin/sh\ncat <<'EOF'\n${output}EOF\n`, { mode: 0o755 })
    return file
  }
  const evidence = collectEvidence({
    ...outputs,
    serial: 'emulator-5554',
    aapt2: tool('aapt2', BADGING),
    adb: tool('adb', DUMPSYS),
  })
  assert.deepEqual(evidence.nativeDebuggable, {
    apkManifest: true,
    installed: {
      serial: 'emulator-5554',
      packageName: 'com.couturecast.app',
      flagDebuggable: true,
    },
  })
  assert.equal(evidence.r8.probe.class, PROBE)
  assert.deepEqual(evidence.revenueCat.required, [
    'com.revenuecat.purchases.Purchases',
    'com.revenuecat.purchases.hybridcommon.CommonKt',
  ])
  assert.equal(evidence.jsDev, 'asserted at runtime by the D15 journey')

  assert.throws(
    () => collectEvidence({ ...outputs, aapt2: tool('aapt2-release', RELEASE_BADGING) }),
    /apk_not_debuggable/
  )
  assert.throws(
    () =>
      collectEvidence({
        ...outputs,
        serial: 'emulator-5554',
        aapt2: tool('aapt2-ok', BADGING),
        adb: tool('adb-release', RELEASE_DUMPSYS),
      }),
    /installed_not_debuggable/
  )
  fs.rmSync(outputs.mapping)
  assert.throws(
    () => collectEvidence({ ...outputs, aapt2: tool('aapt2-again', BADGING) }),
    /output_missing/
  )
})

test('RevenueCat survives: its classes keep their names and usage.txt removes none of it', () => {
  assert.deepEqual(revenueCatSurvival({ mapping: SHRUNK_MAPPING, usage: SHRUNK_USAGE }), {
    keptClasses: 3,
    required: [
      'com.revenuecat.purchases.Purchases',
      'com.revenuecat.purchases.hybridcommon.CommonKt',
    ],
  })
  // A later SDK without the blanket keep rule: a class or a member goes, and the check fails.
  assert.throws(
    () =>
      revenueCatSurvival({
        mapping: SHRUNK_MAPPING,
        usage: `${SHRUNK_USAGE}com.revenuecat.purchases.amazon.AmazonBilling\n`,
      }),
    /revenuecat_shrunk: com\.revenuecat\.purchases\.amazon\.AmazonBilling/
  )
  assert.throws(
    () =>
      revenueCatSurvival({
        mapping: SHRUNK_MAPPING,
        usage: 'com.revenuecat.purchases.common.Backend:\n    public void unused()\n',
      }),
    /revenuecat_shrunk/
  )
  assert.throws(
    () =>
      revenueCatSurvival({
        mapping: SHRUNK_MAPPING.replace(
          'com.revenuecat.purchases.Purchases -> com.revenuecat.purchases.Purchases:',
          'com.revenuecat.purchases.Purchases -> a.a:'
        ),
      }),
    /revenuecat_class_missing: com\.revenuecat\.purchases\.Purchases/
  )
  assert.throws(
    () => revenueCatSurvival({ mapping: RENAMED_MAPPING }),
    /revenuecat_absent/
  )
})

const APP_JSON = { expo: { plugins: ['expo-router'] } }
const withBuildProperties = (android) => ({
  expo: { plugins: ['expo-router', ['expo-build-properties', { android }]] },
})
const GRADLE_SDK54 = 'android.useAndroidX=true\nhermesEnabled=true\n'
const GRADLE_MINIFY = `${GRADLE_SDK54}android.enableMinifyInReleaseBuilds=true\n`

test('the Release minify switch is read from the app config and the prebuilt gradle.properties', () => {
  assert.deepEqual(
    releaseMinifyConfig({ appJson: APP_JSON, gradleProperties: GRADLE_SDK54 }),
    {
      enabled: false,
      source: 'app.json',
    }
  )
  assert.equal(
    releaseMinifyConfig({
      appJson: withBuildProperties({ enableMinifyInReleaseBuilds: true }),
      gradleProperties: GRADLE_MINIFY,
    }).enabled,
    true
  )
  assert.equal(
    releaseMinifyConfig({
      appJson: withBuildProperties({ enableProguardInReleaseBuilds: true }),
    }).enabled,
    true
  )
  assert.deepEqual(
    releaseMinifyConfig({ appJson: APP_JSON, gradleProperties: GRADLE_MINIFY }),
    {
      enabled: true,
      source: 'gradle.properties',
    }
  )
  // The config turned minify on but the native project was not prebuilt again.
  assert.throws(
    () =>
      releaseMinifyConfig({
        appJson: withBuildProperties({ enableMinifyInReleaseBuilds: true }),
        gradleProperties: GRADLE_SDK54,
      }),
    /release_minify_config_stale/
  )
})

test('Release without minify is a recorded baseline; with minify a missing mapping fails', () => {
  assert.deepEqual(releaseR8Status({ minifyEnabled: false, mappingExists: false }), {
    r8: false,
    fact: 'Release runs no R8',
    mappingPresent: false,
  })
  assert.deepEqual(releaseR8Status({ minifyEnabled: true, mappingExists: true }), {
    r8: true,
    fact: 'Release ran R8',
    mappingPresent: true,
  })
  assert.throws(
    () => releaseR8Status({ minifyEnabled: true, mappingExists: false }),
    /release_mapping_missing/
  )
})

test('collectReleaseR8 reads the files: the SDK 54 baseline, then minify on without a mapping', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-release-r8-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const outputs = variantOutputs(path.join(root, 'android'))
  const appJsonPath = path.join(root, 'app.json')
  fs.mkdirSync(path.dirname(outputs.gradleProperties), { recursive: true })
  fs.writeFileSync(appJsonPath, JSON.stringify(APP_JSON))
  fs.writeFileSync(outputs.gradleProperties, GRADLE_SDK54)
  const files = {
    appJsonPath,
    gradlePropertiesPath: outputs.gradleProperties,
    releaseMapping: outputs.releaseMapping,
  }
  assert.equal(collectReleaseR8(files).fact, 'Release runs no R8')
  fs.writeFileSync(
    appJsonPath,
    JSON.stringify(withBuildProperties({ enableMinifyInReleaseBuilds: true }))
  )
  fs.writeFileSync(outputs.gradleProperties, GRADLE_MINIFY)
  assert.throws(() => collectReleaseR8(files), /release_mapping_missing/)
  fs.mkdirSync(path.dirname(outputs.releaseMapping), { recursive: true })
  fs.writeFileSync(outputs.releaseMapping, SHRUNK_MAPPING)
  assert.equal(collectReleaseR8(files).fact, 'Release ran R8')
})
