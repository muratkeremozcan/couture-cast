#!/usr/bin/env node
/** One disposable hosted VM diagnoses startup tuning and the mandatory settle gate. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simulatorCommandRecorder } from './native-ios-command-evidence.mjs'
import { quiesceOwnedSimulator } from './native-ios-quiesce.mjs'
import { preflightObserver, observedRuntimeQuery } from './native-ios-preflight.mjs'
import { seedOwnedSiriPreferences } from './native-ios-siri-preferences.mjs'
import { cleanupOwnedDevice } from './native-ios-device-cleanup.mjs'

/**
 * Runs 28 to 33 installed this 140 MB client in 24 to 33 s under host load 70 to 100. A fresh shard
 * host (load 312 to 516, 170 MB free) took longer than the 60 s command default and the install
 * was killed. One bounded attempt with the same budget bootstatus has; no retry.
 */
export const INSTALL_CLIENT_TIMEOUT_MS = 300000

/**
 * The first native flow opens the app on a fixed deadline (IOS_FIRST_FLOW_TIMEOUT_MS in
 * native-ios-flow-budget.mjs, 120 s until story 6.15), so it must not start while the host is
 * saturated. The CPU gate above settles three named simulator daemons, yet the hosted VM can still
 * carry a 1-minute load of 130 or more from boot, install and Metro work: every failed first flow
 * on record started at load1 136 to 156 (runs 41297785476 and 41352898854, burn-in 41426869137),
 * the app never fetched its bundle and logged nothing, and load1 fell to 33 to 59 within two
 * minutes. First flows that started at 35 to 113 passed. So the flow waits until two load1
 * readings in a row are at most 80, and starts anyway after five minutes so a host that never
 * settles fails on its own evidence.
 */
export const HOST_LOAD_POLICY = Object.freeze({
  maxLoad1: 80,
  // load1 is a smoothed average, so one low reading can be a dip: two in a row, 5 s apart.
  settledSamples: 2,
  pollSeconds: 5,
  maxWaitSeconds: 300,
})
export async function settleHostLoad({
  loadavg = () => os.loadavg()[0],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  policy = HOST_LOAD_POLICY,
} = {}) {
  const started = now()
  const startLoad1 = loadavg()
  let load1 = startLoad1
  let below = load1 <= policy.maxLoad1 ? 1 : 0
  while (
    below < policy.settledSamples &&
    now() - started < policy.maxWaitSeconds * 1000
  ) {
    await sleep(policy.pollSeconds * 1000)
    load1 = loadavg()
    below = load1 <= policy.maxLoad1 ? below + 1 : 0
  }
  const record = {
    maxLoad1: policy.maxLoad1,
    startLoad1: Math.round(startLoad1),
    load1: Math.round(load1),
    waitedSeconds: Math.round((now() - started) / 1000),
    outcome: below >= policy.settledSamples ? 'settled' : 'cap',
  }
  console.log(JSON.stringify({ hostLoadGate: record }))
  return record
}

/** The development client ios-build builds and the shards install. */
export const DEV_CLIENT_APP =
  '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app'
/** The Story 6.8 Release simulator app ios-live-font builds with the same derived data path. */
export const RELEASE_APP =
  '/tmp/cc68-ios-build/Build/Products/Release-iphonesimulator/CoutureCastStory68.app'

/**
 * The app a native-flow probe installs: the development client, or with `--app` the Release app,
 * the only other build the iOS jobs make. Any other value fails before a simulator exists.
 */
export function probeAppPath(argv) {
  const at = argv.indexOf('--app')
  if (at < 0) return DEV_CLIENT_APP
  const app = argv[at + 1]
  if (![DEV_CLIENT_APP, RELEASE_APP].includes(app))
    throw new Error('owned_story68_app_path_required')
  return app
}

export async function finishOwnedStartup({
  device,
  command,
  sample,
  quiesce = quiesceOwnedSimulator,
  settleHost = settleHostLoad,
  prepareForFlow = false,
  appPath,
  afterBoot = () => undefined,
  cleanup = () =>
    command('delete-device', 'xcrun', ['simctl', 'delete', device], { fatal: false }),
}) {
  let ready = false
  const snapshot = (label, operation = () => sample(label)) => {
    try {
      operation()
    } catch (error) {
      console.log(
        JSON.stringify({
          startupSnapshotFailure: {
            label,
            errorName: error.name,
            errorCode: error.code ?? null,
            errorMessage: error.message,
            stderr: error.stderr ?? '',
          },
        })
      )
    }
  }
  try {
    command('boot-device', 'xcrun', ['simctl', 'boot', device])
    command('bootstatus', 'xcrun', ['simctl', 'bootstatus', device, '-b'], {
      timeout: 300000,
    })
    snapshot('siri-preference-readback', afterBoot)
    snapshot('after-simulator-boot')
    if (prepareForFlow)
      command('install-client', 'xcrun', ['simctl', 'install', device, appPath], {
        timeout: INSTALL_CLIENT_TIMEOUT_MS,
      })
    await quiesce(device, command)
    if (prepareForFlow) await settleHost()
    snapshot('before-first-flow')
    ready = true
  } finally {
    if (!prepareForFlow || !ready) snapshot('device-cleanup', cleanup)
  }
}

async function main() {
  if (
    process.platform !== 'darwin' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('startup_probe_requires_disposable_macos')
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  const appPath = probeAppPath(process.argv.slice(2))
  const command = simulatorCommandRecorder(directory)
  const sample = (label) =>
    command(
      `host-${label}`,
      process.execPath,
      ['scripts/ci/native-host-evidence.mjs', 'sample', label, '--platform', 'ios'],
      { fatal: false }
    )
  command('indexing-off', 'sudo', ['mdutil', '-a', '-i', 'off'])
  sample('before-simulator-boot')
  const sdk = command('sdk-version', 'xcrun', [
    '--sdk',
    'iphonesimulator',
    '--show-sdk-version',
  ]).stdout.trim()
  let queried
  try {
    queried = await observedRuntimeQuery({
      directory,
      command,
      observe: preflightObserver(directory),
    })
  } finally {
    command('runtime-image-list', 'xcrun', ['simctl', 'runtime', 'list', '--json'], {
      timeout: 10000,
      fatal: false,
    })
  }
  const available = JSON.parse(queried.stdout).runtimes
  const runtime = available.findLast(
    (r) =>
      r.platform === 'iOS' &&
      r.isAvailable &&
      (r.version === sdk || r.version.startsWith(sdk + '.'))
  )
  if (!runtime) throw new Error('matching_simulator_runtime_required')
  const device = command('create-device', 'xcrun', [
    'simctl',
    'create',
    'cc68-startup-probe',
    'iPhone 16 Pro',
    runtime.identifier,
  ]).stdout.trim()
  if (!/^[A-Fa-f0-9-]{36}$/.test(device))
    throw new Error('created_device_identifier_required')
  fs.writeFileSync(path.join(directory, 'owned-startup-device.txt'), device + '\n', {
    mode: 0o600,
  })
  const prepareForFlow = process.argv.includes('--for-native-flow')
  if (prepareForFlow)
    fs.writeFileSync('/tmp/cc68-simulator', device + '\n', { mode: 0o600 })
  fs.writeFileSync(
    path.join(directory, 'native-ios-device.json'),
    JSON.stringify(
      {
        version: 1,
        device,
        deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
        runtime: {
          identifier: runtime.identifier,
          version: runtime.version,
          build: runtime.buildversion,
        },
      },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
  let afterBoot = () => undefined
  try {
    afterBoot = seedOwnedSiriPreferences({ device, directory, runtime, command })
  } catch (error) {
    console.log(
      JSON.stringify({
        siriPreferenceFailure: {
          errorCode: error.code ?? null,
          errorMessage: error.message,
        },
      })
    )
  }
  await finishOwnedStartup({
    device,
    command,
    sample,
    prepareForFlow,
    afterBoot,
    cleanup: () => cleanupOwnedDevice(device, directory, command),
    appPath,
  })
  console.log(
    JSON.stringify({
      startupProbe: 'settled',
      firstFlow: prepareForFlow
        ? 'ready_for_native_first_flow'
        : 'not_started_startup_only_probe',
    })
  )
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
