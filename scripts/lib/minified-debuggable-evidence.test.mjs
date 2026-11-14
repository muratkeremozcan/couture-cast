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
import { fileURLToPath } from 'node:url'
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

const repository = fileURLToPath(new URL('../../', import.meta.url))

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
  // P2-1 (Antigravity r8): RevenueCat stripped down to the two required names passes the mapping
  // check, so a missing usage.txt must fail rather than read as "nothing removed".
  const stripped = { ...outputs, usage: path.join(root, 'missing-usage.txt') }
  fs.writeFileSync(
    outputs.mapping,
    [
      'com.couturecast.app.MainActivity -> com.couturecast.app.MainActivity:',
      'com.revenuecat.purchases.Purchases -> com.revenuecat.purchases.Purchases:',
      'com.revenuecat.purchases.hybridcommon.CommonKt -> com.revenuecat.purchases.hybridcommon.CommonKt:',
      '',
    ].join('\n')
  )
  assert.throws(
    () => collectEvidence({ ...stripped, aapt2: tool('aapt2-usage', BADGING) }),
    /output_missing: .*missing-usage\.txt/
  )
  assert.throws(
    () =>
      collectEvidence({
        ...outputs,
        usage: undefined,
        aapt2: tool('aapt2-no-usage', BADGING),
      }),
    /output_missing/
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

const resolved = ({ plugins = ['expo-router'], gradleProperties = [] } = {}) => ({
  plugins,
  _internal: { modResults: { android: { gradleProperties } } },
})
const withBuildProperties = (android) =>
  resolved({ plugins: ['expo-router', ['expo-build-properties', { android }]] })
const MINIFY_PROPERTY = {
  type: 'property',
  key: 'android.enableMinifyInReleaseBuilds',
  value: 'true',
}
const GRADLE_SDK54 = 'android.useAndroidX=true\nhermesEnabled=true\n'
const GRADLE_MINIFY = `${GRADLE_SDK54}android.enableMinifyInReleaseBuilds=true\n`

test('the Release minify switch is read from the resolved app config and the prebuilt gradle.properties', () => {
  assert.deepEqual(
    releaseMinifyConfig({ resolvedConfig: resolved(), gradleProperties: GRADLE_SDK54 }),
    { enabled: false, source: 'app config' }
  )
  assert.equal(
    releaseMinifyConfig({
      resolvedConfig: withBuildProperties({ enableMinifyInReleaseBuilds: true }),
      gradleProperties: GRADLE_MINIFY,
    }).enabled,
    true
  )
  assert.equal(
    releaseMinifyConfig({
      resolvedConfig: withBuildProperties({ enableProguardInReleaseBuilds: true }),
    }).enabled,
    true
  )
  // A plugin, from app.json or app.config.ts, that writes the gradle property.
  assert.deepEqual(
    releaseMinifyConfig({
      resolvedConfig: resolved({ gradleProperties: [MINIFY_PROPERTY] }),
    }),
    { enabled: true, source: 'app config' }
  )
  assert.deepEqual(
    releaseMinifyConfig({ resolvedConfig: resolved(), gradleProperties: GRADLE_MINIFY }),
    { enabled: true, source: 'gradle.properties' }
  )
  // The config turned minify on but the native project was not prebuilt again.
  assert.throws(
    () =>
      releaseMinifyConfig({
        resolvedConfig: resolved({ gradleProperties: [MINIFY_PROPERTY] }),
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

/** A resolvable Expo project root whose apps/mobile holds the given files. */
function mobileFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-release-r8-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const mobile = path.join(root, 'apps/mobile')
  fs.mkdirSync(mobile, { recursive: true })
  fs.symlinkSync(
    path.join(repository, 'apps/mobile/node_modules'),
    path.join(mobile, 'node_modules')
  )
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'))
  const all = {
    'package.json': '{"name":"r8-fixture","version":"1.0.0"}',
    'app.json': JSON.stringify({ expo: { name: 'Fixture', slug: 'fixture' } }),
    'app.config.ts': 'export default ({ config }: { config: object }) => config\n',
    ...files,
  }
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(mobile, file)), { recursive: true })
    fs.writeFileSync(path.join(mobile, file), text)
  }
  return root
}

// P3-2 (Antigravity r8): an app.config.ts that turns minify on is seen before any prebuild.
const MINIFY_APP_CONFIG = `import { withGradleProperties } from 'expo/config-plugins'
import type { ExpoConfig } from 'expo/config'

const minify = (config: ExpoConfig) =>
  withGradleProperties(config, (next) => {
    next.modResults.push({ type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' })
    return next
  })

export default ({ config }: { config: ExpoConfig }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), minify],
})
`

test('collectReleaseR8 resolves the app config: the baseline, then app.config.ts minify before prebuild', (t) => {
  const baseline = mobileFixture(t, {})
  const outputs = variantOutputs(path.join(baseline, 'apps/mobile/android'))
  const files = (root) => ({
    root,
    gradlePropertiesPath: path.join(root, 'apps/mobile/android/gradle.properties'),
    releaseMapping: path.join(
      root,
      'apps/mobile/android/app/build/outputs/mapping/release/mapping.txt'
    ),
  })
  assert.deepEqual(collectReleaseR8(files(baseline)), {
    configSource: 'app config',
    r8: false,
    fact: 'Release runs no R8',
    mappingPresent: false,
  })
  assert.equal(outputs.releaseMapping, files(baseline).releaseMapping)

  const minified = mobileFixture(t, { 'app.config.ts': MINIFY_APP_CONFIG })
  assert.throws(() => collectReleaseR8(files(minified)), /release_mapping_missing/)
  const mapping = files(minified).releaseMapping
  fs.mkdirSync(path.dirname(mapping), { recursive: true })
  fs.writeFileSync(mapping, SHRUNK_MAPPING)
  assert.equal(collectReleaseR8(files(minified)).fact, 'Release ran R8')

  const broken = mobileFixture(t, {
    'app.config.ts': 'export default () => { throw new Error("broken config") }\n',
  })
  assert.throws(() => collectReleaseR8(files(broken)), /app_config_unresolved/)
})

// Antigravity r9 (P3-2): an omitted output fails closed without Node's DEP0187 warning for
// fs.existsSync(undefined).
test('an omitted usage.txt fails closed without a deprecation warning', async () => {
  const warnings = []
  const listen = (warning) => warnings.push(warning.code ?? warning.name)
  process.on('warning', listen)
  try {
    assert.throws(
      () =>
        collectEvidence({
          apk: undefined,
          mapping: undefined,
          usage: undefined,
          aapt2: '/usr/bin/false',
        }),
      {
        message: 'minified_debuggable_output_missing: undefined',
      }
    )
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('warning', listen)
  }
  assert.ok(!warnings.includes('DEP0187'), warnings.join(','))
})
