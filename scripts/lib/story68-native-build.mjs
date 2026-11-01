/**
 * The exact commands that build the Story 6.8 native development client. They live apart from
 * the harness so scripts/ci/native-build-cache.mjs can key a cached binary by them: a change to a
 * flag here changes the key, and the next run builds again.
 */

/** The ABI or architecture of this host, which the emulator and simulator also run. */
export const hostNativeArch = (platform, arch = process.arch) =>
  platform === 'ios'
    ? arch === 'arm64'
      ? 'arm64'
      : 'x86_64'
    : arch === 'arm64'
      ? 'arm64-v8a'
      : 'x86_64'

export const IOS_DERIVED_DATA = '/tmp/cc68-ios-build'
export const IOS_APP_NAME = 'CoutureCastStory68.app'

/** The development client a Debug build produces, where the lanes install it from. */
export function nativeDevClientPath(platform, root = '.') {
  if (platform === 'ios')
    return `${IOS_DERIVED_DATA}/Build/Products/Debug-iphonesimulator/${IOS_APP_NAME}`
  if (platform === 'android')
    return `${root}/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
  throw new Error('native_build_platform_required')
}

/** `expo prebuild` arguments; iOS then runs `pod install` in the generated project. */
export const prebuildArgs = (platform, { clean = false } = {}) => [
  'prebuild',
  ...(clean ? ['--clean'] : []),
  '--platform',
  platform,
  '--no-install',
]

/**
 * The build binary and arguments. Android appends the Worklets staging arguments the harness
 * prepares for the configuration.
 */
export function nativeBuildCommand({
  platform,
  configuration = 'Debug',
  arch,
  derivedData = IOS_DERIVED_DATA,
  workletsArgs = [],
}) {
  if (!['Debug', 'Release'].includes(configuration))
    throw new Error('build_configuration_required')
  if (platform === 'ios')
    return {
      binary: 'xcodebuild',
      args: [
        '-workspace',
        'CoutureCastStory68.xcworkspace',
        '-scheme',
        'CoutureCastStory68',
        '-configuration',
        configuration,
        '-destination',
        'generic/platform=iOS Simulator',
        '-derivedDataPath',
        derivedData,
        '-jobs',
        '2',
        `ARCHS=${arch ?? hostNativeArch('ios')}`,
        'ONLY_ACTIVE_ARCH=YES',
        'CODE_SIGN_IDENTITY=-',
        'CODE_SIGN_LOCAL_EXECUTION_IDENTITY=Ad Hoc',
        'CODE_SIGNING_ALLOWED=YES',
        'CODE_SIGNING_REQUIRED=NO',
        'build',
      ],
    }
  if (platform === 'android')
    return {
      binary: './gradlew',
      args: [
        `assemble${configuration}`,
        ...workletsArgs,
        '--no-daemon',
        '--max-workers=2',
        `-PreactNativeArchitectures=${arch ?? hostNativeArch('android')}`,
      ],
    }
  throw new Error('native_build_platform_required')
}
