/** Idempotent cleanup requires the exact UUID receipt created by this hosted job. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { simulatorCommandRecorder } from './native-ios-command-evidence.mjs'

export function cleanupOwnedDevice(device, directory, command) {
  const owned = fs
    .readFileSync(path.join(directory, 'owned-startup-device.txt'), 'utf8')
    .trim()
  if (
    owned !== device ||
    !/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/.test(device)
  )
    throw new Error('owned_created_device_receipt_required')
  const file = path.join(directory, 'native-ios-device-cleanup.json')
  let previous
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    /* No successful cleanup receipt yet. */
  }
  if (
    previous?.device === device &&
    ['deleted', 'already-deleted'].includes(previous.outcome)
  ) {
    console.log(
      JSON.stringify({ simulatorCleanup: { device, outcome: 'already-deleted' } })
    )
    return { ...previous, outcome: 'already-deleted' }
  }
  const r = command('delete-device', 'xcrun', ['simctl', 'delete', device], {
    fatal: false,
    timeout: 10000,
  })
  const missing = r.stderr?.includes('Invalid device: ' + device)
  const record = {
    version: 1,
    device,
    outcome: r.exitCode === 0 ? 'deleted' : missing ? 'already-deleted' : 'delete-failed',
    exitCode: r.exitCode,
    stderr: r.stderr ?? '',
    errorCode: r.errorCode ?? null,
  }
  try {
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  } catch (error) {
    console.log(
      JSON.stringify({
        cleanupReceiptFailure: {
          errorCode: error.code ?? null,
          errorMessage: error.message,
        },
      })
    )
  }
  console.log(JSON.stringify({ simulatorCleanup: record }))
  return record
}

function main() {
  if (
    process.platform !== 'darwin' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('cleanup_requires_disposable_macos')
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  try {
    if (!fs.existsSync('/tmp/cc68-simulator')) {
      console.log(JSON.stringify({ simulatorCleanup: 'no-owned-device' }))
      return
    }
    cleanupOwnedDevice(
      fs.readFileSync('/tmp/cc68-simulator', 'utf8').trim(),
      directory,
      simulatorCommandRecorder(directory)
    )
  } catch (error) {
    console.log(
      JSON.stringify({
        simulatorCleanupFailure: {
          errorCode: error.code ?? null,
          errorMessage: error.message,
        },
      })
    )
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
