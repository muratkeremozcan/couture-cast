#!/usr/bin/env node
/** One disposable hosted VM diagnoses startup tuning and the mandatory settle gate. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simulatorCommandRecorder } from './native-ios-command-evidence.mjs'
import { quiesceOwnedSimulator } from './native-ios-quiesce.mjs'
import { preflightObserver, observedRuntimeQuery } from './native-ios-preflight.mjs'

export async function finishOwnedStartup({
  device,
  command,
  sample,
  quiesce = quiesceOwnedSimulator,
  prepareForFlow = false,
  appPath,
}) {
  let ready = false
  const snapshot = (label) => {
    try {
      sample(label)
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
    snapshot('after-simulator-boot')
    if (prepareForFlow)
      command('install-client', 'xcrun', ['simctl', 'install', device, appPath])
    await quiesce(device, command)
    snapshot('before-first-flow')
    ready = true
  } finally {
    if (!prepareForFlow || !ready)
      command('delete-device', 'xcrun', ['simctl', 'delete', device], { fatal: false })
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
  await finishOwnedStartup({
    device,
    command,
    sample,
    prepareForFlow,
    appPath:
      '/tmp/cc68-ios-build/Build/Products/Debug-iphonesimulator/CoutureCastStory68.app',
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
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
