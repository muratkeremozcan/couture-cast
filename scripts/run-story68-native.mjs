#!/usr/bin/env node
// Story 6.8 native harness. Every mutation is scoped to the explicitly owned runtime/device.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { story68FocusObservationHandler } from './lib/story68-ios-focus-observation.mjs'
import { startWeatherProviderDouble } from './weather-provider-double.mjs'
import { closedShareCardAuditReport } from './lib/share-card-audit-report.mjs'
import { summarizeNativeFlowFailure } from './lib/share-card-native-failure.mjs'
import { recordNativeFlowDiagnostics } from './lib/share-card-native-diagnostics.mjs'
import { assertShareCardDialogStatusBar } from './lib/share-card-system-bars.mjs'
import { withColdAndroidFontScale } from './lib/story68-cold-font-scale.mjs'
import { runReleaseLiveFontCommand } from './lib/story68-release-live-font-command.mjs'
import {
  assertIosReadDenied,
  shouldRetryIosSnapshot,
  assertOwnedStory68AppReset,
  restoreAndroidReverse,
  withNativeTransport,
  assertOwnedStory68EmulatorPort,
} from './lib/story68-native-safety.mjs'
import { assertStory68DiskSpace } from './lib/test-disk-space.mjs'
import { MAESTRO_BIN } from './maestro-version.mjs'
import { flowTimeoutMs } from './lib/story68-flow-timeouts.mjs'
import {
  IOS_RETRYABLE_DENIAL_EVIDENCE,
  IOS_SETTINGS_MARKERS,
} from './lib/story68-native-evidence-schema.mjs'
import {
  prepareWorkletsStaging,
  verifyWorkletsStaging,
} from './lib/story68-worklets-staging.mjs'
import {
  DRIVER_HOST_PORT_ARG,
  MAESTRO_ANDROID_DRIVER_PORT,
} from './lib/maestro-android-driver-session.mjs'
import {
  assertRapidWatermarkRuntime,
  rapidWatermarkRequests,
  withRapidWatermarkLock,
} from './lib/story68-rapid-watermark.mjs'
import {
  withRapidWatermarkControl,
  redactRapidWatermarkControl,
  closedRapidWatermarkFailure,
} from './lib/story68-rapid-watermark-control.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const command = argv[0]
if (
  [
    'prebuild',
    'build',
    'emulator',
    'matrix',
    'a11y',
    'expo-go-proof',
    'rapid-watermark',
    'fallback-focus',
    'release-live-font',
  ].includes(command)
)
  assertStory68DiskSpace(root)
const option = (name) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? undefined : argv[at + 1]
}
const directory = path.resolve(
  option('harness') ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
const privateJson = (name, value) =>
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  })
function iosPhotoPermissions() {
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json']))
  const selected = Object.values(devices.devices)
    .flat()
    .find((entry) => entry.udid === device)
  if (!selected) throw new Error('owned_simulator_required')
  return JSON.parse(
    run('python3', [
      '-c',
      'import sqlite3,json,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); r=dict(c.execute("select service,auth_value from access where client=? and service in (\'kTCCServicePhotos\',\'kTCCServicePhotosAdd\')",(sys.argv[2],))); c.close(); print(json.dumps({"read":r.get("kTCCServicePhotos"),"addOnly":r.get("kTCCServicePhotosAdd")}))',
      path.join(selected.dataPath, 'Library/TCC/TCC.db'),
      appId,
    ])
  )
}
function ownedEnv() {
  const env = read('owned-env.json')
  const db = new URL(env.DATABASE_URL)
  if (
    !['127.0.0.1', 'localhost'].includes(db.hostname) ||
    !/^\/tea_community_[a-f0-9]{32}$/.test(db.pathname)
  )
    throw new Error('owned_database_required')
  if (new URL(env.SUPABASE_URL).hostname !== '127.0.0.1')
    throw new Error('loopback_auth_required')
  return env
}
function child(binary, args, env, log, cwd = root) {
  const fd = fs.openSync(path.join(directory, log), 'a', 0o600)
  const process = spawn(binary, args, {
    cwd,
    env: { ...globalThis.process.env, ...env },
    stdio: ['ignore', fd, fd],
  })
  fs.closeSync(fd)
  return process
}
const appId =
  command === 'expo-go-proof' ? 'host.exp.Exponent' : 'com.couturecast.story68'
const device = option('device')
const platform = option('platform')
let activeLocale = option('locale') ?? 'en-US'
const maestroBinary =
  process.env.MAESTRO_PATH ?? (fs.existsSync(MAESTRO_BIN) ? MAESTRO_BIN : 'maestro')
const adb = path.join(
  process.env.ANDROID_HOME ?? path.join(process.env.HOME, 'Library/Android/sdk'),
  'platform-tools/adb'
)
function run(binary, args, env = {}, cwd = root, input) {
  const result = spawnSync(binary, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    maxBuffer: 30 * 1024 * 1024,
  })
  if (result.status !== 0)
    throw new Error(
      `owned_command_failed:${path.basename(binary)}:${result.status}:${result.stderr.slice(-1500)}`
    )
  return result.stdout
}
function requireDevice() {
  if (!device || !['android', 'ios'].includes(platform))
    throw new Error('explicit_device_and_platform_required')
  ownedEnv()
}
function reverse() {
  if (platform === 'android')
    restoreAndroidReverse({ adb, device, ports: [4088, 8089, 53068, 54321] })
}
function nativeOriginalPaths() {
  if (platform === 'android') {
    const rows = run(adb, [
      '-s',
      device,
      'shell',
      'content',
      'query',
      '--uri',
      'content://media/external/images/media',
      '--projection',
      '_id:_data:_display_name',
    ])
    return [...rows.matchAll(/_data=([^,\r\n]+)/g)]
      .map((match) => match[1])
      .filter((file) => /\/cc68-[a-f0-9-]+\.png$/.test(file))
  }
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json']))
  const selected = Object.values(devices.devices)
    .flat()
    .find((entry) => entry.udid === device)
  if (!selected) throw new Error('owned_simulator_required')
  const visit = (directory) =>
    fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .flatMap((entry) =>
            entry.isDirectory()
              ? visit(path.join(directory, entry.name))
              : [path.join(directory, entry.name)]
          )
      : []
  return visit(path.join(selected.dataPath, 'Media/DCIM'))
}
function captureApproved() {
  requireDevice()
  const hierarchy = run(maestroBinary, ['--device', device, 'hierarchy'])
  fs.writeFileSync(path.join(directory, `hierarchy-${platform}.txt`), hierarchy, {
    mode: 0o600,
  })
  const digest = hierarchy.match(/share-card-preview-loaded-([a-f0-9]{64})/)?.[1]
  if (!digest) throw new Error('loaded_approved_preview_required')
  privateJson(`approved-${platform}.json`, {
    sha256: digest,
    at: new Date().toISOString(),
    priorResources: nativeOriginalPaths(),
  })
  console.log(JSON.stringify({ platform, approvedPreviewLoaded: true }))
}
function previewDigest() {
  requireDevice()
  const digest = run(maestroBinary, ['--device', device, 'hierarchy']).match(
    /share-card-preview-loaded-([a-f0-9]{64})/
  )?.[1]
  if (!digest) throw new Error('loaded_approved_preview_required')
  return digest
}
// settings.yaml asserts the destination in Maestro; this reads it again from the OS.
function openOsSettings() {
  maestro('maestro/story68/settings.yaml')
  requireDevice()
  if (platform === 'android') {
    const resumed = run(adb, ['-s', device, 'shell', 'dumpsys', 'activity', 'activities'])
      .split('\n')
      .find((line) =>
        /^\s*(topResumedActivity|mResumedActivity|ResumedActivity)/.test(line)
      )
      ?.match(/ActivityRecord\{\S+ \S+ ([\w.]+)\//)?.[1]
    if (resumed !== 'com.android.settings') throw new Error('os_settings_not_opened')
    return { foregroundPackage: resumed }
  }
  const hierarchy = run(maestroBinary, ['--device', device, 'hierarchy'])
  if (!IOS_SETTINGS_MARKERS.every((marker) => hierarchy.includes(marker)))
    throw new Error('os_settings_not_opened')
  return { foregroundMarkers: IOS_SETTINGS_MARKERS }
}
// A cold Metro needs longer to build the launch bundle than open-app.yaml waits for the
// tab bar, so the dev client is only pointed at Metro once that exact bundle is built.
const DEV_CLIENT_URL = 'couturecast-story68://expo-development-client/'
const LAUNCH_BUNDLE_DEADLINE_SECONDS = 600
let launchBundleWarm = false
function warmLaunchBundle() {
  if (launchBundleWarm) return
  const manifest = JSON.parse(
    run('curl', [
      '-sf',
      '--max-time',
      '30',
      '-H',
      `expo-platform: ${platform}`,
      '-H',
      'Accept: application/expo+json,application/json',
      'http://127.0.0.1:8089',
    ])
  )
  const bundle = new URL(manifest.launchAsset?.url ?? '')
  if (bundle.origin !== 'http://127.0.0.1:8089' || !bundle.pathname.endsWith('.bundle'))
    throw new Error('owned_metro_launch_bundle_required')
  run('curl', [
    '-sf',
    '--max-time',
    String(LAUNCH_BUNDLE_DEADLINE_SECONDS),
    '-o',
    '/dev/null',
    bundle.href,
  ])
  launchBundleWarm = true
}
function openUrl(url) {
  requireDevice()
  reverse()
  if (url.startsWith(DEV_CLIENT_URL)) warmLaunchBundle()
  if (platform === 'ios') run('xcrun', ['simctl', 'openurl', device, url])
  else
    run(adb, [
      '-s',
      device,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      url,
      appId,
    ])
}
function readLocale() {
  return JSON.parse(
    fs.readFileSync(path.join(root, `apps/mobile/assets/locales/${activeLocale}.json`))
  )
}
function localeEnv() {
  const locale = activeLocale
  const json = JSON.parse(
    fs.readFileSync(path.join(root, `apps/mobile/assets/locales/${locale}.json`))
  )
  const n = json.community.notifications
  return {
    MAESTRO_APP_ID: appId,
    MAESTRO_TITLE: n.title,
    MAESTRO_SIGNIN: n.signin,
    MAESTRO_SEND: n.sendCode,
    MAESTRO_VERIFY: n.verify,
    MAESTRO_CODE_SENT: n.codeSent,
    MAESTRO_EMAIL_LABEL: n.email,
    MAESTRO_CODE_LABEL: n.code,
    MAESTRO_ENABLED: n.enabled,
    MAESTRO_SIGNOUT: n.signout,
    MAESTRO_BACK: json.common.back,
    MAESTRO_SAVED: json.shareCard.saved,
    MAESTRO_SAVING: json.shareCard.saving,
    MAESTRO_PREPARING: json.shareCard.preparing,
    MAESTRO_DENIED: json.shareCard.permissionDenied,
    MAESTRO_PERMANENT: json.shareCard.permissionPermanent,
    MAESTRO_RETRY: json.shareCard.retry,
    MAESTRO_SETTINGS: json.shareCard.openSettings,
    MAESTRO_STORAGE: json.shareCard.storage,
    MAESTRO_UNAVAILABLE: json.shareCard.nativeSaveUnavailable,
    MAESTRO_FAILURE: json.shareCard.storage,
    MAESTRO_PENDING: json.shareCard.finishingSave,
    MAESTRO_CARD_TITLE: json.shareCard.title,
    MAESTRO_WATERMARK: json.shareCard.watermark,
    MAESTRO_SAVE_LABEL: json.shareCard.save,
    MAESTRO_CANCEL_LABEL: json.shareCard.cancel,
    MAESTRO_POST_ID: read('fixtures.json').postId,
  }
}
function maestro(flow, env = {}, secret = '', attempt = 0) {
  requireDevice()
  const started = Date.now()
  const output = path.join(directory, `maestro-${platform}-${Date.now()}`)
  fs.mkdirSync(output, { mode: 0o700 })
  const result = withNativeTransport(() => {
    const result = spawnSync(
      maestroBinary,
      [
        '--device',
        device,
        'test',
        ...(platform === 'android'
          ? [DRIVER_HOST_PORT_ARG, String(MAESTRO_ANDROID_DRIVER_PORT)]
          : []),
        '--test-output-dir',
        output,
        '--debug-output',
        output,
        '--flatten-debug-output',
        path.join(root, flow),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          JAVA_HOME:
            process.env.JAVA_HOME ??
            '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
          MAESTRO_CLI_NO_ANALYTICS: '1',
          ...localeEnv(),
          ...env,
        },
        encoding: 'utf8',
        maxBuffer: 30 * 1024 * 1024,
        detached: true,
        timeout: flowTimeoutMs(flow),
        killSignal: 'SIGTERM',
      }
    )
    if (result.error?.code === 'ETIMEDOUT') {
      // Detached child owns this process group, including its XCTest driver.
      try {
        process.kill(-result.pid, 'SIGTERM')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    return result
  }, reverse)
  const driverLog = path.join(output, 'maestro.log')
  const snapshotLog = fs.existsSync(driverLog) ? fs.readFileSync(driverLog, 'utf8') : ''
  const failureDurationMs = Math.max(0, Date.now() - started)
  const recoverSnapshot =
    result.status !== 0 &&
    shouldRetryIosSnapshot({ platform, attempt, log: snapshotLog, flow })
  if (result.status !== 0 && !recoverSnapshot) {
    privateJson(
      `native-flow-failure-${platform}.json`,
      summarizeNativeFlowFailure({
        flow,
        platform,
        durationMs: failureDurationMs,
        log: `${snapshotLog}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      })
    )
    // Capture while the emulator and the exact failed-step artifacts still exist.
    // The child projects closed diagnostics; raw captures stay runner-private.
    try {
      recordNativeFlowDiagnostics({
        root,
        directory,
        output,
        flow,
        platform,
        device,
        adb,
        durationMs: failureDurationMs,
        exitCode: result.status,
        signal: result.signal ?? null,
        sensitive: secret !== '',
        startedAt: started,
        log: `${snapshotLog}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(
          -200000
        ),
      })
    } catch {
      // Diagnostics must preserve the original Maestro failure.
    }
  }
  const log = `${result.stdout}\n${result.stderr}`
    .split(secret || '\0')
    .join('[REDACTED]')
  if (secret) fs.rmSync(output, { recursive: true })
  fs.writeFileSync(
    path.join(directory, `maestro-${platform}-${path.basename(flow)}.log`),
    log,
    { mode: 0o600 }
  )
  if (recoverSnapshot) return maestro(flow, env, secret, attempt + 1)
  if (result.status !== 0) throw new Error(`native_flow_failed:${flow}`)
}
async function signin() {
  activeLocale = 'en-US'
  maestro('maestro/story65/open-app.yaml')
  maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
  const account = read('fixtures.json').identities.find(
    (identity) => identity.label === (option('account') ?? 'cc68-primary')
  )
  if (!account || account.pending) throw new Error('ready_owned_identity_required')
  const since = Date.now()
  maestro(
    'maestro/story65/signin-request.yaml',
    { MAESTRO_EMAIL: account.email },
    account.email
  )
  const file = path.join(
    read('auth-harness.json').otpDir,
    createHash('sha256').update(account.email).digest('hex') + '.json'
  )
  let code
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const value = JSON.parse(fs.readFileSync(file))
      if (value.issuedAt >= since && /^\d{6,10}$/.test(value.code)) {
        code = value.code
        break
      }
    } catch {
      // The owned proxy has not written a fresh code yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!code) throw new Error('owned_fresh_otp_timeout')
  maestro('maestro/story65/signin-verify.yaml', { MAESTRO_OTP: code }, code)
  maestro('maestro/story65/open-app.yaml')
  console.log('Genuine owned account signed in through product UI.')
}
function rapidWatermarkFlow(signal, control) {
  const started = Date.now()
  reverse()
  const output = path.join(directory, `maestro-${platform}-rapid-${Date.now()}`)
  fs.mkdirSync(output, { mode: 0o700 })
  const fd = fs.openSync(path.join(output, 'process.log'), 'wx', 0o600)
  return new Promise((resolve, reject) => {
    const process = spawn(
      maestroBinary,
      [
        '--device',
        device,
        'test',
        ...(platform === 'android'
          ? [DRIVER_HOST_PORT_ARG, String(MAESTRO_ANDROID_DRIVER_PORT)]
          : []),
        '--test-output-dir',
        output,
        '--debug-output',
        output,
        '--flatten-debug-output',
        path.join(root, 'maestro/story68/rapid-watermark-held.yaml'),
      ],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', fd, fd],
        env: {
          ...globalThis.process.env,
          ...localeEnv(),
          MAESTRO_RAPID_CONTROL_URL: control.url,
          MAESTRO_CLI_NO_ANALYTICS: '1',
          JAVA_HOME:
            globalThis.process.env.JAVA_HOME ??
            '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
        },
      }
    )
    fs.closeSync(fd)
    let killTimer
    const kill = (signal) => {
      if (!process.pid) return
      try {
        globalThis.process.kill(-process.pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    const stop = () => {
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 500)
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const cleanup = () => {
      clearTimeout(killTimer)
      signal.removeEventListener('abort', stop)
    }
    process.once('error', (error) => {
      cleanup()
      reject(error)
    })
    process.once('close', (code) => {
      cleanup()
      if (signal.aborted) reject(signal.reason)
      else if (code !== 0) reject(new Error('native_rapid_watermark_flow_failed'))
      else resolve()
    })
  })
    .catch((error) => {
      const logs = ['maestro.log', 'process.log']
        .map((name) => {
          const file = path.join(output, name)
          return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
        })
        .join('\n')
      privateJson(
        `native-flow-failure-${platform}.json`,
        summarizeNativeFlowFailure({
          flow: 'maestro/story68/rapid-watermark-held.yaml',
          platform,
          durationMs: Math.max(0, Date.now() - started),
          log: logs,
        })
      )
      throw error
    })
    .finally(() => redactRapidWatermarkControl(output, control.url))
}
if (command === 'prebuild') {
  ownedEnv()
  const env = read('public-build-env.json')
  const fd = fs.openSync(path.join(directory, `prebuild-${platform}.log`), 'w', 0o600)
  const result = spawnSync(
    path.join(root, 'node_modules/.bin/expo'),
    [
      'prebuild',
      ...(option('clean') === 'yes' ? ['--clean'] : []),
      '--platform',
      platform,
      '--no-install',
    ],
    {
      cwd: path.join(root, 'apps/mobile'),
      env: { ...process.env, ...env },
      stdio: ['ignore', fd, fd],
    }
  )
  fs.closeSync(fd)
  if (result.status !== 0) throw new Error('native_prebuild_failed')
  if (platform === 'ios') run('pod', ['install'], {}, path.join(root, 'apps/mobile/ios'))
} else if (command === 'build') {
  ownedEnv()
  const configuration = option('configuration') ?? 'Debug'
  if (!['Debug', 'Release'].includes(configuration))
    throw new Error('build_configuration_required')
  const fd = fs.openSync(
    path.join(directory, `build-${platform}-${configuration}.log`),
    'w',
    0o600
  )
  const workletsStaging =
    platform === 'android'
      ? prepareWorkletsStaging({
          projectRoot: path.join(root, 'apps/mobile/android'),
          configuration,
          architectures:
            option('arch') ?? (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'),
          evidenceDirectory: directory,
        })
      : undefined
  const binary = platform === 'ios' ? 'xcodebuild' : './gradlew'
  const args =
    platform === 'ios'
      ? [
          '-workspace',
          'CoutureCastStory68.xcworkspace',
          '-scheme',
          'CoutureCastStory68',
          '-configuration',
          configuration,
          '-destination',
          'generic/platform=iOS Simulator',
          '-derivedDataPath',
          option('derived-data') ?? '/tmp/cc68-ios-build',
          '-jobs',
          '2',
          `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
          'ONLY_ACTIVE_ARCH=YES',
          'CODE_SIGN_IDENTITY=-',
          'CODE_SIGN_LOCAL_EXECUTION_IDENTITY=Ad Hoc',
          'CODE_SIGNING_ALLOWED=YES',
          'CODE_SIGNING_REQUIRED=NO',
          'build',
        ]
      : [
          `assemble${configuration}`,
          ...workletsStaging.args,
          '--no-daemon',
          '--max-workers=2',
          `-PreactNativeArchitectures=${option('arch') ?? (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64')}`,
        ]
  const result = spawnSync(binary, args, {
    cwd: path.join(root, `apps/mobile/${platform === 'ios' ? 'ios' : 'android'}`),
    env: {
      ...process.env,
      ...read('public-build-env.json'),
      ANDROID_HOME: process.env.ANDROID_HOME ?? path.dirname(path.dirname(adb)),
    },
    stdio: ['ignore', fd, fd],
  })
  fs.closeSync(fd)
  if (result.status !== 0) throw new Error('native_build_failed')
  if (workletsStaging) verifyWorkletsStaging(workletsStaging)
  console.log(`Owned ${platform} ${configuration} native build passed.`)
} else if (command === 'a11y' && platform === 'android') {
  requireDevice()
  activeLocale = 'en-US'
  maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
  const env = {
    ...read('public-build-env.json'),
    ANDROID_SERIAL: device,
    ANDROID_HOME: process.env.ANDROID_HOME ?? path.dirname(path.dirname(adb)),
  }
  const moduleDirectory = path.join(
    root,
    'apps/mobile/modules/accessibility-focus/android'
  )
  const previous = run(adb, [
    '-s',
    device,
    'shell',
    'settings',
    'get',
    'secure',
    'enabled_accessibility_services',
  ]).trim()
  const enabled = run(adb, [
    '-s',
    device,
    'shell',
    'settings',
    'get',
    'secure',
    'accessibility_enabled',
  ]).trim()
  try {
    run(
      path.join(root, 'apps/mobile/android/gradlew'),
      [
        '-p',
        path.join(root, 'apps/mobile/android'),
        ':accessibility-focus:assembleDebugAndroidTest',
        ':accessibility-focus:testDebugUnitTest',
        '--max-workers=2',
      ],
      env
    )
    run(adb, [
      '-s',
      device,
      'install',
      '-r',
      path.join(
        moduleDirectory,
        'build/outputs/apk/androidTest/debug/accessibility-focus-debug-androidTest.apk'
      ),
    ])
    run('bash', ['scripts/ci/android-talkback.sh', 'enable'], { ...env, ADB: adb })
    run(adb, ['-s', device, 'shell', 'am', 'force-stop', appId])
    openUrl(
      `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
    )
    maestro('maestro/story65/open-app.yaml')
    const output = run(adb, [
      '-s',
      device,
      'shell',
      'am',
      'instrument',
      '-w',
      '-e',
      'class',
      'expo.modules.accessibilityfocus.ShareCardComposerTalkBackTest',
      'expo.modules.accessibilityfocus.test/androidx.test.runner.AndroidJUnitRunner',
    ])
    fs.writeFileSync(path.join(directory, 'talkback-composer.log'), output, {
      mode: 0o600,
    })
    if (!/OK \(2 tests\)/.test(output) || /FAILURES|INSTRUMENTATION_FAILED/.test(output))
      throw new Error('actual_talkback_composer_failed')
    privateJson('accessibility-android.json', {
      platform,
      service: 'TalkBack',
      actualService: true,
      openTitleFocus: true,
      saveFocusContained: true,
      cancelOpenerFocus: true,
      ownedSavingFocus: true,
      reopenedFinishingFocus: true,
      watermarkReenabled: true,
      existingHeaderLabels: true,
      traversalLabelsTraits: true,
    })
  } finally {
    if (!previous || previous === 'null')
      run(adb, [
        '-s',
        device,
        'shell',
        'settings',
        'delete',
        'secure',
        'enabled_accessibility_services',
      ])
    else
      run(adb, [
        '-s',
        device,
        'shell',
        'settings',
        'put',
        'secure',
        'enabled_accessibility_services',
        previous,
      ])
    run(adb, [
      '-s',
      device,
      'shell',
      'settings',
      'put',
      'secure',
      'accessibility_enabled',
      enabled === 'null' ? '0' : enabled,
    ])
  }
} else if (command === 'a11y' && platform === 'ios') {
  requireDevice()
  const generated = path.join(directory, 'accessibility-project')
  fs.mkdirSync(generated, { recursive: true })
  for (const name of [
    'project.yml',
    'ShareCardAccessibilityUITests.swift',
    'ShareCardHeaderSemantics.swift',
    'ShareCardHeaderQuery.swift',
  ])
    fs.copyFileSync(
      path.join(root, 'apps/mobile/native-tests', name),
      path.join(generated, name)
    )
  const catalogs = path.join(generated, 'catalogs')
  fs.mkdirSync(catalogs, { recursive: true })
  for (const name of fs
    .readdirSync(path.join(root, 'apps/api/src/modules/share-cards/assets'))
    .filter((name) => name.endsWith('.json'))) {
    fs.copyFileSync(
      path.join(root, 'apps/api/src/modules/share-cards/assets', name),
      path.join(catalogs, name)
    )
    fs.copyFileSync(
      path.join(root, 'apps/mobile/assets/locales', name),
      path.join(catalogs, `client-${name}`)
    )
  }
  run('xcodegen', [
    'generate',
    '--spec',
    path.join(generated, 'project.yml'),
    '--project',
    generated,
  ])
  const focusObservation = story68FocusObservationHandler({
    device,
    appId,
    readContainer: () =>
      run('xcrun', ['simctl', 'get_app_container', device, appId, 'data']),
  })
  const control = createServer((request, response) => {
    if (focusObservation(request, response)) return
    const url = new URL(request.url, 'http://127.0.0.1:63068')
    const mode = url.searchParams.get('mode')
    if (
      url.pathname !== '/fixture' ||
      ![
        'real',
        'storage',
        'offline',
        'unavailable',
        'limited',
        'prepare_deferred',
        'permission_denied',
        'permission_permanent',
        'cache_failure',
        'deferred',
        'release',
      ].includes(mode)
    ) {
      response.writeHead(400).end()
      return
    }
    try {
      openUrl(`couturecast-story68://__story68__/share-card?mode=${mode}`)
      response.writeHead(200).end()
    } catch {
      response.writeHead(503).end()
    }
  })
  await new Promise((resolve) => control.listen(63068, '127.0.0.1', resolve))
  const result = path.join(directory, `accessibility-ios-${Date.now()}.xcresult`)
  const auditLog = path.join(directory, 'accessibility-ios.log')
  const offset = fs.existsSync(auditLog) ? fs.statSync(auditLog).size : 0
  const audit = child(
    'xcodebuild',
    [
      'test',
      '-project',
      path.join(generated, 'ShareCardAccessibility.xcodeproj'),
      '-scheme',
      'ShareCardAccessibility',
      '-destination',
      `platform=iOS Simulator,id=${device}`,
      '-collect-test-diagnostics',
      'never',
      '-derivedDataPath',
      path.join(directory, 'accessibility-build'),
      '-resultBundlePath',
      result,
      'CODE_SIGN_IDENTITY=-',
      'CODE_SIGNING_ALLOWED=YES',
      'CODE_SIGNING_REQUIRED=NO',
    ],
    {},
    'accessibility-ios.log'
  )
  try {
    const code = await new Promise((resolve) => audit.once('exit', resolve))
    const summary = JSON.parse(
      run('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', result])
    )
    const tree = JSON.parse(
      run('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', result])
    )
    const closed = closedShareCardAuditReport(
      summary,
      tree,
      fs.readFileSync(auditLog).subarray(offset).toString()
    )
    privateJson('accessibility-ios.json', closed)
    if (code !== 0 || !closed.passed) {
      const hierarchy = run(maestroBinary, ['--device', device, 'hierarchy'])
      if (hierarchy.includes('share-card-title'))
        run('xcrun', [
          'simctl',
          'io',
          device,
          'screenshot',
          path.join(directory, 'native-ios-audit-failure.png'),
        ])
      throw new Error('ios_accessibility_audit_failed')
    }
  } finally {
    await new Promise((resolve) => control.close(resolve))
  }
} else if (command === 'serve') {
  const env = ownedEnv()
  env.CC68_EXPECTED_DATABASE_URL = env.DATABASE_URL
  env.E2E_CALLER_OWNED_ENV_KEYS = Object.keys(env).join(',')
  const weather = await startWeatherProviderDouble({
    port: Number(env.E2E_WEATHER_DOUBLE_PORT ?? env.WEATHER_PROVIDER_TEST_DOUBLE_PORT),
  })
  const api = child(
    process.execPath,
    ['scripts/lib/story68-api-entry.mjs'],
    env,
    'api.log'
  )
  privateJson('owned-processes.json', { harnessPid: process.pid, apiPid: api.pid })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    api.kill('SIGTERM')
    await weather.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
  api.once('exit', (code) => {
    if (!stopping) {
      console.error('owned_api_exited')
      void weather.close().then(() => process.exit(code ?? 1))
    }
  })
  console.log('Owned Story68 API and weather processes started. See private api.log.')
} else if (command === 'metro') {
  ownedEnv()
  const env = read('public-build-env.json')
  const metro = child(
    path.join(root, 'node_modules/.bin/expo'),
    ['start', '--dev-client', '--port', '8089', '--localhost'],
    env,
    'metro.log',
    path.join(root, 'apps/mobile')
  )
  privateJson('owned-metro-process.json', {
    harnessPid: process.pid,
    metroPid: metro.pid,
  })
  process.once('SIGINT', () => metro.kill('SIGTERM'))
  process.once('SIGTERM', () => metro.kill('SIGTERM'))
  metro.once('exit', (code) => process.exit(code ?? 1))
  console.log('Owned Story68 Metro started. See private metro.log.')
} else if (command === 'emulator') {
  ownedEnv()
  const avd = option('avd')
  const port = option('port') ?? '5584'
  assertOwnedStory68EmulatorPort({ avd, port })
  const sdk =
    process.env.ANDROID_HOME ?? path.join(process.env.HOME, 'Library/Android/sdk')
  const emulator = child(
    path.join(sdk, 'emulator/emulator'),
    [
      '-avd',
      avd,
      '-port',
      port,
      '-memory',
      '4096',
      '-gpu',
      'swiftshader_indirect',
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot',
    ],
    {},
    `${avd}.log`
  )
  privateJson(`owned-${avd}-process.json`, {
    harnessPid: process.pid,
    emulatorPid: emulator.pid,
    avd,
    device: `emulator-${port}`,
  })
  process.once('SIGINT', () => emulator.kill('SIGTERM'))
  process.once('SIGTERM', () => emulator.kill('SIGTERM'))
  emulator.once('exit', (code) => process.exit(code ?? 1))
  console.log(`Owned ${avd} emulator started on port ${port}.`)
} else if (command === 'open') {
  requireDevice()
  if (platform === 'android') run(adb, ['-s', device, 'shell', 'am', 'force-stop', appId])
  openUrl(
    `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
  )
  maestro('maestro/story65/open-app.yaml')
} else if (command === 'expo-go-proof') {
  requireDevice()
  if (platform !== 'ios') throw new Error('ios_expo_go_device_required')
  const inventory = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json']))
  const selected = Object.values(inventory.devices)
    .flat()
    .find((entry) => entry.udid === device)
  if (!selected) throw new Error('explicit_existing_simulator_required')
  const wasBooted = selected.state === 'Booted'
  let installed = false
  privateJson('expo-go-owned-install.json', {
    device,
    wasBooted,
    installed: false,
    appId,
  })
  try {
    if (!wasBooted) {
      run('xcrun', ['simctl', 'boot', device])
      run('xcrun', ['simctl', 'bootstatus', device, '-b'])
    }
    const apps = JSON.parse(
      run(
        'plutil',
        ['-convert', 'json', '-o', '-', '-'],
        {},
        root,
        run('xcrun', ['simctl', 'listapps', device])
      )
    )
    if (apps[appId])
      throw new Error('preexisting_expo_go_preserved_use_another_explicit_device')
    process.env.__UNSAFE_EXPO_HOME_DIRECTORY = path.join(directory, 'expo-home')
    const expoDownloads = (
      await import('../node_modules/@expo/cli/build/src/utils/downloadExpoGoAsync.js')
    ).default
    const downloaded = await expoDownloads.downloadExpoGoAsync('ios', {
      sdkVersion: '54.0.0',
    })
    privateJson('expo-go-owned-install.json', {
      device,
      wasBooted,
      installed: false,
      appId,
      downloaded,
    })
    run('xcrun', ['simctl', 'install', device, downloaded])
    installed = true
    privateJson('expo-go-owned-install.json', {
      device,
      wasBooted,
      installed: true,
      appId,
      downloaded,
    })
    openUrl('exp://127.0.0.1:8089')
    maestro('maestro/story65/open-app.yaml')
    await signin()
    const before = JSON.stringify(nativeOriginalPaths())
    maestro('maestro/story68/expo-go-unavailable.yaml')
    if (JSON.stringify(nativeOriginalPaths()) !== before)
      throw new Error('unavailable_adapter_created_asset')
    run('xcrun', [
      'simctl',
      'io',
      device,
      'screenshot',
      path.join(directory, 'native-ios-expo-go-unavailable.png'),
    ])
    privateJson('expo-go-unavailable.json', {
      platform,
      actualExpoGo: true,
      nativeAdapterAbsent: true,
      previewLoaded: true,
      saveDisabled: true,
      actualAssetCountUnchanged: true,
    })
  } finally {
    if (installed) run('xcrun', ['simctl', 'uninstall', device, appId])
    if (!wasBooted) run('xcrun', ['simctl', 'shutdown', device])
    privateJson('expo-go-owned-install-cleanup.json', {
      device,
      installedByThisRun: installed,
      uninstalledOwnedInstall: installed,
      restoredInitialBootState: true,
    })
  }
} else if (command === 'signin') {
  await signin()
} else if (command === 'flow') {
  const flow = option('flow') ?? 'share-card-export'
  if (!/^[a-z-]+$/.test(flow)) throw new Error('flow_name_required')
  maestro(
    flow === 'share-card-export'
      ? 'maestro/share-card-export.yaml'
      : `maestro/story68/${flow}.yaml`
  )
} else if (command === 'release-live-font') {
  privateJson('native-release-live-font-android.json', {
    platform: 'android',
    configuration: 'Release',
    passed: false,
  })
  requireDevice()
  activeLocale = 'en-US'
  await runReleaseLiveFontCommand({
    root,
    directory,
    platform,
    device,
    appId,
    adb,
    maestroBinary,
    maestro,
    read,
    privateJson,
    apkPath: path.resolve(
      option('apk') ??
        path.join(
          root,
          'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
        )
    ),
  })
} else if (command === 'fallback-focus') {
  requireDevice()
  activeLocale = 'en-US'
  const { runStory68FallbackFocus } = await import('./lib/story68-fallback-focus.mjs')
  await runStory68FallbackFocus({
    root,
    directory,
    device,
    platform,
    appId,
    adb,
    maestro,
    run,
    read,
    privateJson,
    openUrl,
  })
} else if (command === 'rapid-watermark') {
  requireDevice()
  const report = { platform, passed: false, stage: 'validating_runtime' }
  privateJson(`native-rapid-watermark-${platform}.json`, report)
  try {
    const connectionString = assertRapidWatermarkRuntime({
      environment: ownedEnv(),
      build: read('public-build-env.json'),
      resources: read('resources.json'),
      apiLog: fs.readFileSync(path.join(directory, 'api.log'), 'utf8'),
    })
    report.stage = 'fresh_runtime'
    // A new JS runtime removes all retained preview keys and resets restricted adapters to real.
    if (platform === 'ios') run('xcrun', ['simctl', 'terminate', device, appId])
    else run(adb, ['-s', device, 'shell', 'am', 'force-stop', appId])
    openUrl(
      `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
    )
    maestro('maestro/story65/open-app.yaml')
    maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
    report.stage = 'ready_opener'
    // Feed requests and the visible opener must settle before the table is held.
    maestro('maestro/story68/rapid-ready-outfit.yaml')
    const logPath = path.join(directory, 'api.log')
    const offset = fs.statSync(logPath).size
    const { default: pg } = await import('pg')
    report.stage = 'held_flow'
    const result = await withRapidWatermarkControl({
      withLock: (whileLocked) =>
        withRapidWatermarkLock({
          connectionString,
          createClient: (options) =>
            new pg.Client({
              ...options,
              connectionTimeoutMillis: 2000,
              query_timeout: 2000,
            }),
          whileLocked,
        }),
      runFlow: (control, signal) => rapidWatermarkFlow(signal, control),
    })
    report.stage = 'fresh_preview'
    maestro('maestro/story68/rapid-watermark-loaded.yaml')
    maestro('maestro/story68/cancel.yaml')
    report.stage = 'requests'
    const requests = rapidWatermarkRequests(
      fs.readFileSync(logPath).subarray(offset).toString()
    )
    privateJson(`native-rapid-watermark-${platform}.json`, {
      platform,
      passed: true,
      stage: 'completed',
      preparation: 'actual_api_owned_postgresql_source_barrier',
      lockTiming: 'warmed_host_http_handshake',
      freshAppRuntime: true,
      readyOpenerBeforeLock: true,
      ...result,
      ...requests,
    })
    console.log(
      `Native ${platform} actual API rapid watermark passed in ${result.heldMs}ms held time.`
    )
  } catch (error) {
    privateJson(`native-rapid-watermark-${platform}.json`, {
      ...report,
      code: closedRapidWatermarkFailure(error),
    })
    throw error
  }
} else if (command === 'proof') {
  requireDevice()
  if (platform === 'ios') {
    run('xcrun', ['simctl', 'privacy', device, 'revoke', 'photos', appId])
    run('xcrun', ['simctl', 'privacy', device, 'reset', 'photos-add', appId])
    assertIosReadDenied(iosPhotoPermissions())
    openUrl(
      `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
    )
    maestro('maestro/story65/open-app.yaml')
  }
  if (
    platform === 'android' &&
    Number(run(adb, ['-s', device, 'shell', 'getprop', 'ro.build.version.sdk']).trim()) <
      33
  ) {
    const installed = run(adb, ['-s', device, 'shell', 'dumpsys', 'package', appId])
    assertOwnedStory68AppReset({
      appId,
      isolatedBuild: read('public-build-env.json').STORY68_NATIVE_TEST_BUILD,
      debuggable: installed.includes('DEBUGGABLE'),
      explicit: option('reinitialize-owned-app'),
    })
    // API32 has no clear-permission-flags shell command. Initialize this owned app
    // alone, then establish genuine UI Auth before the real permission prompts.
    run(adb, ['-s', device, 'shell', 'pm', 'clear', appId])
    openUrl(
      `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
    )
    maestro('maestro/story65/open-app.yaml')
    await signin()
  }
  maestro('maestro/story68/open-outfit.yaml')
  maestro('maestro/story68/watermark.yaml', { MAESTRO_ON_PREVIEW: previewDigest() })
  captureApproved()
  if (
    platform === 'android' &&
    Number(run(adb, ['-s', device, 'shell', 'getprop', 'ro.build.version.sdk']).trim()) <
      33
  ) {
    const before = nativeOriginalPaths()
    maestro('maestro/story68/denied.yaml')
    maestro('maestro/story68/permanent.yaml')
    if (JSON.stringify(nativeOriginalPaths()) !== JSON.stringify(before))
      throw new Error('denial_created_asset')
    openOsSettings()
    run(adb, [
      '-s',
      device,
      'shell',
      'pm',
      'grant',
      appId,
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ])
    run(adb, ['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'])
    maestro('maestro/story68/permission-return.yaml')
    if (JSON.stringify(nativeOriginalPaths()) !== JSON.stringify(before))
      throw new Error('settings_return_auto_saved')
    // Settings grant activates permission only. A second explicit Save follows below.
  }
  if (platform === 'ios') {
    const before = JSON.stringify(nativeOriginalPaths())
    // iOS reports canAskAgain=false after the first real add-only denial.
    maestro('maestro/story68/permanent.yaml')
    if (JSON.stringify(nativeOriginalPaths()) !== before)
      throw new Error('denial_created_asset')
    const settingsEvidence = openOsSettings()
    run('xcrun', ['simctl', 'privacy', device, 'grant', 'photos-add', appId])
    openUrl(
      `couturecast-story68://expo-development-client/?url=${encodeURIComponent('http://127.0.0.1:8089')}`
    )
    maestro('maestro/story65/open-app.yaml')
    maestro('maestro/story68/open-outfit.yaml')
    maestro('maestro/story68/permission-return.yaml')
    if (JSON.stringify(nativeOriginalPaths()) !== before)
      throw new Error('settings_return_auto_saved')
    privateJson('permission-ios.json', {
      platform,
      actualAddOnlyDenial: true,
      readPermissionBeforeSave: iosPhotoPermissions(),
      canAskAgain: false,
      actualSettingsOpened: true,
      settingsEvidence,
      settingsGrantReturnedWithoutImport: true,
      retryableDenialEvidence: IOS_RETRYABLE_DENIAL_EVIDENCE,
    })
  }
  maestro('maestro/story68/save.yaml')
  run(process.execPath, [
    fileURLToPath(import.meta.url),
    'extract',
    '--harness',
    directory,
    '--platform',
    platform,
    '--device',
    device,
  ])
  if (platform === 'ios') {
    const after = iosPhotoPermissions()
    assertIosReadDenied(after, true)
    privateJson('permission-ios.json', {
      ...read('permission-ios.json'),
      readPermissionAfterSave: after,
      readRemainedDenied: true,
      addOnlyGranted: true,
    })
  }
  // Finish the owned dialog before the next command opens Settings through tabs.
  // Extraction and the iOS permission assertions must complete before dismissal.
  maestro('maestro/story68/cancel.yaml')
  console.log('Explicit native save and fresh OS original proof passed.')
} else if (command === 'matrix') {
  requireDevice()
  const report = { platform, cases: [], completed: false }
  const mark = (id) => {
    report.cases.push({ id, passed: true })
    privateJson(`native-matrix-${platform}.json`, report)
  }
  const fixture = (mode) =>
    openUrl(`couturecast-story68://__story68__/share-card?mode=${mode}`)
  const close = () => maestro('maestro/story68/cancel.yaml')
  const open = (source) => maestro(`maestro/story68/open-${source}.yaml`)
  const originals = () => JSON.stringify(nativeOriginalPaths().sort())
  const assertUnchanged = (before) => {
    if (originals() !== before) throw new Error('unexpected_native_import')
  }
  const extract = (name) => {
    run(process.execPath, [
      fileURLToPath(import.meta.url),
      'extract',
      '--harness',
      directory,
      '--platform',
      platform,
      '--device',
      device,
    ])
    fs.copyFileSync(
      path.join(directory, `original-proof-${platform}.json`),
      path.join(directory, `original-proof-${platform}-${name}.json`)
    )
    fs.copyFileSync(
      path.join(directory, `saved-original-${platform}.png`),
      path.join(directory, `saved-original-${platform}-${name}.png`)
    )
  }
  const screenshot = (name) => {
    const output = path.join(directory, `native-${platform}-${name}.png`)
    if (platform === 'ios') run('xcrun', ['simctl', 'io', device, 'screenshot', output])
    else
      fs.writeFileSync(
        output,
        spawnSync(adb, ['-s', device, 'exec-out', 'screencap', '-p']).stdout
      )
  }
  // Real Settings controls establish locale; no direct i18n test setter is used.
  activeLocale = 'en-US'
  maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
  const beforePreparation = originals()
  fixture('prepare_deferred')
  maestro('maestro/story68/preparing-cancel.yaml')
  fixture('release')
  maestro('maestro/story68/no-late-feedback.yaml')
  assertUnchanged(beforePreparation)
  mark('M-CANCEL:preparation-before-commit')
  fixture('real')
  open('post')
  captureApproved()
  maestro('maestro/story68/save.yaml')
  extract('post')
  mark('M-POST M-SAVE')
  close()
  if (platform === 'ios') {
    maestro('maestro/story68/community-draft-background-ios.yaml')
    mark('M-A11Y:community-draft-native-host-foreground')
  }
  open('outfit')
  maestro('maestro/story68/watermark.yaml', { MAESTRO_ON_PREVIEW: previewDigest() })
  captureApproved()
  const retained = read(`approved-${platform}.json`).sha256
  let before = originals()
  close()
  open('outfit')
  captureApproved()
  if (read(`approved-${platform}.json`).sha256 !== retained)
    throw new Error('reopen_composition_changed')
  assertUnchanged(before)
  mark('M-CANCEL M-WATERMARK')
  for (const mode of ['cache_failure', 'storage', 'offline']) {
    before = originals()
    fixture(mode)
    maestro('maestro/story68/failure.yaml', {
      MAESTRO_FAILURE: readLocale().shareCard[mode === 'offline' ? 'offline' : 'storage'],
    })
    assertUnchanged(before)
    mark(mode === 'offline' ? 'M-OFFLINE' : `M-STORAGE:${mode}`)
    // Retry prepares a fresh preview; the next Save takes a new final authorization.
    fixture('real')
    maestro('maestro/story68/retry.yaml')
    assertUnchanged(before)
    captureApproved()
    maestro('maestro/story68/save.yaml')
    extract(`retry-${mode}`)
    mark(`${mode === 'offline' ? 'M-OFFLINE' : `M-STORAGE:${mode}`}:retry-recovers`)
    before = originals()
  }
  fixture('real')
  close()
  fixture('unavailable')
  open('outfit')
  maestro('maestro/story68/unavailable.yaml')
  assertUnchanged(before)
  mark('M-NATIVE-UNAVAILABLE:restricted-adapter-boundary')
  close()
  fixture('limited')
  open('outfit')
  captureApproved()
  maestro('maestro/story68/save.yaml')
  extract('limited')
  mark('U-PERMISSION-LIMITED:native-adapter-integration')
  close()
  fixture('real')
  for (const locale of [
    'en-US',
    'en-CA',
    'fr-FR',
    'fr-CA',
    'de-DE',
    'es-419',
    'it-IT',
    'pt-BR',
    'pt-PT',
    'tr-TR',
  ]) {
    activeLocale = locale
    maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: locale })
    open('outfit')
    maestro('maestro/story68/localized.yaml')
    const catalog = JSON.parse(
      fs.readFileSync(
        path.join(root, `apps/api/src/modules/share-cards/assets/${locale}.json`)
      )
    )
    const body = [
      catalog.outfit,
      catalog.scenarios.morning,
      ...['top', 'bottom', 'shoes'].map((category) => catalog.categories[category]),
      'CoutureCast',
    ].join('. ')
    const matchesLabel = (expected) => {
      const hierarchy = JSON.parse(run(maestroBinary, ['--device', device, 'hierarchy']))
      const findPreview = (node) =>
        node.attributes?.['resource-id']?.includes('share-card-preview-loaded-')
          ? node.attributes
          : (node.children ?? []).map(findPreview).find(Boolean)
      const image = findPreview(hierarchy)
      return image && [image.text, image.accessibilityText].includes(expected)
    }
    const waitLabel = async (expected) => {
      for (let n = 0; n < 10; n++) {
        if (matchesLabel(expected)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('localized_full_preview_label_mismatch')
    }
    await waitLabel(`${body}. ${catalog.watermarkRole}: CoutureCast`)
    maestro('maestro/story68/toggle-once.yaml', {
      MAESTRO_PREVIOUS_PREVIEW: previewDigest(),
    })
    await waitLabel(body)
    maestro('maestro/story68/toggle-once.yaml', {
      MAESTRO_PREVIOUS_PREVIEW: previewDigest(),
    })
    await waitLabel(`${body}. ${catalog.watermarkRole}: CoutureCast`)
    if (platform === 'android') {
      assertShareCardDialogStatusBar(
        run(adb, ['-s', device, 'shell', 'dumpsys', 'window']),
        appId
      )
      mark(`M-A11Y:dark-dialog-status-icons:${locale}`)
    }
    screenshot(locale)
    mark(`M-LOCALE:${locale}`)
    close()
  }
  activeLocale = 'pt-PT'
  maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
  const previousFont =
    platform === 'ios'
      ? run('xcrun', ['simctl', 'ui', device, 'content_size']).trim()
      : undefined
  const verifyLargeText = () => {
    open('outfit')
    maestro('maestro/story68/large-text.yaml')
    screenshot('large-text')
    close()
    mark('M-A11Y:large-text-pt-PT')
  }
  if (platform === 'android') {
    await withColdAndroidFontScale(
      { appId, adb, device, run, openUrl, maestro },
      verifyLargeText
    )
  } else {
    try {
      run('xcrun', ['simctl', 'ui', device, 'content_size', 'accessibility-medium'])
      verifyLargeText()
    } finally {
      run('xcrun', ['simctl', 'ui', device, 'content_size', previousFont])
    }
  }
  activeLocale = 'en-US'
  maestro('maestro/story65/set-locale.yaml', { MAESTRO_LOCALE: activeLocale })
  for (const lifecycle of ['close', 'navigation']) {
    fixture('real')
    open('outfit')
    captureApproved()
    const retainedDigest = read(`approved-${platform}.json`).sha256
    close()
    open('outfit')
    captureApproved()
    if (read(`approved-${platform}.json`).sha256 !== retainedDigest)
      throw new Error('retained_precommit_preview_changed')
    fixture('authorization_deferred')
    before = originals()
    maestro('maestro/story68/precommit-cancel.yaml')
    if (lifecycle === 'navigation') maestro('maestro/story68/navigate-pending.yaml')
    fixture('release')
    maestro('maestro/story68/no-late-feedback.yaml')
    assertUnchanged(before)
    fixture('real')
    open('outfit')
    captureApproved()
    if (read(`approved-${platform}.json`).sha256 !== retainedDigest)
      throw new Error('cancelled_precommit_composition_changed')
    maestro('maestro/story68/precommit-reopened.yaml')
    assertUnchanged(before)
    close()
    mark(`M-CANCEL M-SINGLE-WRITE:precommit-authorization-${lifecycle}`)
  }
  for (const lifecycle of ['close', 'navigation', 'signout']) {
    fixture('deferred')
    open('outfit')
    captureApproved()
    before = originals()
    maestro('maestro/story68/pending.yaml')
    assertUnchanged(before)
    mark('M-SAVE-OWNERSHIP:current-saving')
    if (lifecycle === 'close') {
      open('outfit')
      maestro('maestro/story68/pending-reopened.yaml')
      mark('M-SAVE-OWNERSHIP:reopened-finishing')
    }
    if (lifecycle !== 'close') maestro('maestro/story68/navigate-pending.yaml')
    if (lifecycle === 'signout') maestro('maestro/story68/signout.yaml')
    fixture('release')
    for (let n = 0; n < 80 && originals() === before; n++)
      await new Promise((resolve) => setTimeout(resolve, 100))

    if (lifecycle === 'close') {
      maestro('maestro/story68/pending-settled.yaml', {
        MAESTRO_ON_PREVIEW: read(`approved-${platform}.json`).sha256,
      })
      mark('M-WATERMARK:reopen-after-settlement')
      close()
    }
    maestro('maestro/story68/no-late-feedback.yaml')
    extract(`pending-${lifecycle}`)
    mark(`M-SINGLE-WRITE M-IDENTITY:${lifecycle}`)
    fixture('real')
    if (lifecycle === 'signout') await signin()
  }
  report.completed = true
  privateJson(`native-matrix-${platform}.json`, report)
  console.log(`Native ${platform} matrix passed ${report.cases.length} cases.`)
} else if (command === 'fixture') {
  const mode = option('mode')
  if (
    ![
      'real',
      'limited',
      'prepare_deferred',
      'authorization_deferred',
      'permission_denied',
      'permission_permanent',
      'storage',
      'cache_failure',
      'offline',
      'unavailable',
      'deferred',
      'release',
    ].includes(mode)
  )
    throw new Error('fixture_mode_required')
  openUrl(`couturecast-story68://__story68__/share-card?mode=${mode}`)
} else if (command === 'settings') {
  console.log(
    JSON.stringify({ platform, actualSettingsOpened: true, ...openOsSettings() })
  )
} else if (command === 'snapshot') {
  captureApproved()
} else if (command === 'extract') {
  requireDevice()
  const approved = read(`approved-${platform}.json`)
  const output = path.join(directory, `saved-original-${platform}.png`)
  let bytes
  const freshResources = nativeOriginalPaths().filter(
    (file) => !approved.priorResources?.includes(file)
  )
  if (!Array.isArray(approved.priorResources))
    throw new Error('pre_save_resource_baseline_required')
  const freshPngs = freshResources.filter((file) => /\.png$/i.test(file))
  if (freshPngs.length !== 1) throw new Error('exactly_one_fresh_original_required')
  if (platform === 'android') {
    const rows = run(adb, [
      '-s',
      device,
      'shell',
      'content',
      'query',
      '--uri',
      'content://media/external/images/media',
      '--projection',
      '_id:_data:_display_name',
    ])
    const files = [...rows.matchAll(/_data=([^,\r\n]+)/g)]
      .map((match) => match[1])
      .filter((file) => /\/cc68-[a-f0-9-]+\.png$/.test(file))
      .filter((file) => freshResources.includes(file))
    for (const file of files) {
      run(adb, ['-s', device, 'pull', file, output])
      const candidate = fs.readFileSync(output)
      if (createHash('sha256').update(candidate).digest('hex') === approved.sha256) {
        bytes = candidate
        break
      }
    }
  } else {
    const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '--json']))
    const selected = Object.values(devices.devices)
      .flat()
      .find((entry) => entry.udid === device)
    if (!selected) throw new Error('owned_simulator_required')
    const media = path.join(selected.dataPath, 'Media/DCIM')
    const visit = (directory) =>
      fs.existsSync(directory)
        ? fs
            .readdirSync(directory, { withFileTypes: true })
            .flatMap((entry) =>
              entry.isDirectory()
                ? visit(path.join(directory, entry.name))
                : [path.join(directory, entry.name)]
            )
        : []
    for (const file of visit(media).filter((file) => freshResources.includes(file))) {
      const candidate = fs.readFileSync(file)
      if (createHash('sha256').update(candidate).digest('hex') === approved.sha256) {
        bytes = candidate
        fs.writeFileSync(output, bytes)
        break
      }
    }
  }
  if (!bytes) throw new Error('actual_os_original_not_found')
  if (platform === 'android') {
    const remaining = run(adb, [
      '-s',
      device,
      'shell',
      'run-as',
      appId,
      'find',
      'cache/share-cards',
      '-name',
      'cc68-*.png',
    ])
    if (remaining.trim()) throw new Error('settled_feature_cache_not_cleaned')
  } else {
    const container = run('xcrun', [
      'simctl',
      'get_app_container',
      device,
      appId,
      'data',
    ]).trim()
    const cache = path.join(container, 'Library/Caches/share-cards')
    if (
      fs.existsSync(cache) &&
      fs.readdirSync(cache).some((file) => /^cc68-.*\.png$/.test(file))
    )
      throw new Error('settled_feature_cache_not_cleaned')
  }
  const { validateShareCardPng } = await import('@couture/api-client')
  validateShareCardPng(bytes)
  privateJson(`original-proof-${platform}.json`, {
    sha256: approved.sha256,
    bytes: bytes.length,
    resource: output,
    newNativeResources: freshResources,
    exactOneNewAsset: true,
    featureCacheEmpty: true,
    chunks: ['IHDR', 'IDAT', 'IEND'],
  })
  console.log(
    JSON.stringify({
      proof: 'actual_os_original_matches_approved_preview',
      platform,
      bytes: bytes.length,
    })
  )
} else if (command === 'inspect-png') {
  const expected = option('sha256')
  const file = option('file')
  if (!file || !/^[a-f0-9]{64}$/.test(expected ?? ''))
    throw new Error('file_and_preview_digest_required')
  const bytes = fs.readFileSync(file)
  const { validateShareCardPng } = await import('@couture/api-client')
  validateShareCardPng(bytes)
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('saved_original_mismatch')
  console.log(
    JSON.stringify({
      proof: 'saved_original_matches_approved_preview',
      bytes: bytes.length,
      chunks: ['IHDR', 'IDAT', 'IEND'],
    })
  )
} else {
  throw new Error(
    'Use serve, metro or inspect-png; native test/extraction commands require an explicit device and built client.'
  )
}
