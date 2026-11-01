import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  IOS_APP_NAME,
  IOS_DERIVED_DATA,
  hostNativeArch,
  nativeBuildCommand,
  nativeDevClientPath,
  prebuildArgs,
} from './story68-native-build.mjs'

describe('Story 6.8 native build commands', () => {
  test('the host architecture names the iOS arch and the Android ABI the device runs', () => {
    assert.equal(hostNativeArch('ios', 'arm64'), 'arm64')
    assert.equal(hostNativeArch('ios', 'x64'), 'x86_64')
    assert.equal(hostNativeArch('android', 'arm64'), 'arm64-v8a')
    assert.equal(hostNativeArch('android', 'x64'), 'x86_64')
  })

  test('prebuild generates one platform without installing, and cleans only on request', () => {
    assert.deepEqual(prebuildArgs('ios'), [
      'prebuild',
      '--platform',
      'ios',
      '--no-install',
    ])
    assert.deepEqual(prebuildArgs('android', { clean: true }), [
      'prebuild',
      '--clean',
      '--platform',
      'android',
      '--no-install',
    ])
  })

  test('iOS builds the simulator client ad hoc signed into the pinned derived data', () => {
    const { binary, args } = nativeBuildCommand({ platform: 'ios', arch: 'arm64' })
    assert.equal(binary, 'xcodebuild')
    const value = (flag) => args[args.indexOf(flag) + 1]
    assert.equal(value('-workspace'), 'CoutureCastStory68.xcworkspace')
    assert.equal(value('-configuration'), 'Debug')
    assert.equal(value('-destination'), 'generic/platform=iOS Simulator')
    assert.equal(value('-derivedDataPath'), IOS_DERIVED_DATA)
    assert.ok(args.includes('ARCHS=arm64'))
    assert.ok(args.includes('ONLY_ACTIVE_ARCH=YES'))
    assert.ok(args.includes('CODE_SIGNING_REQUIRED=NO'))
    assert.equal(args.at(-1), 'build')
  })

  test('Android assembles the configuration with the Worklets staging and the device ABI', () => {
    const { binary, args } = nativeBuildCommand({
      platform: 'android',
      configuration: 'Release',
      arch: 'x86_64',
      workletsArgs: ['--init-script', '/owned/worklets.gradle'],
    })
    assert.equal(binary, './gradlew')
    assert.deepEqual(args, [
      'assembleRelease',
      '--init-script',
      '/owned/worklets.gradle',
      '--no-daemon',
      '--max-workers=2',
      '-PreactNativeArchitectures=x86_64',
    ])
  })

  test('refuses an unknown configuration or platform', () => {
    assert.throws(
      () => nativeBuildCommand({ platform: 'ios', configuration: 'Profile' }),
      /build_configuration_required/
    )
    assert.throws(() => nativeBuildCommand({ platform: 'web' }), /platform_required/)
    assert.throws(() => nativeDevClientPath('web'), /platform_required/)
  })

  test('the Debug client is where the lanes install it from', () => {
    assert.equal(
      nativeDevClientPath('ios'),
      `/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/${IOS_APP_NAME}`
    )
    assert.equal(
      nativeDevClientPath('android', '/repo'),
      '/repo/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'
    )
  })
})
