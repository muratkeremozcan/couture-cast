#!/usr/bin/env node
/** One disposable hosted VM diagnoses startup tuning and the mandatory settle gate. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simulatorCommandRecorder } from './native-ios-command-evidence.mjs'
import { quiesceOwnedSimulator } from './native-ios-quiesce.mjs'
import { preflightObserver, observedRuntimeQuery } from './native-ios-preflight.mjs'

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
    command(`host-${label}`, process.execPath, [
      'scripts/ci/native-host-evidence.mjs',
      'sample',
      label,
      '--platform',
      'ios',
    ])
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
  try {
    command('boot-device', 'xcrun', ['simctl', 'boot', device])
    command('bootstatus', 'xcrun', ['simctl', 'bootstatus', device, '-b'], {
      timeout: 300000,
    })
    sample('after-simulator-boot')
    await quiesceOwnedSimulator(device, command)
    sample('before-first-flow')
    console.log(
      JSON.stringify({
        startupProbe: 'settled',
        firstFlow: 'not_started_startup_only_probe',
      })
    )
  } finally {
    command('delete-device', 'xcrun', ['simctl', 'delete', device], { fatal: false })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
