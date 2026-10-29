/**
 * One XCUITest driver for the whole iOS native run. Maestro starts `xcodebuild
 * test-without-building` on every invocation, which cost 17 s of the 37 s mean flow in run 28
 * (85 flows). The runner survives the Maestro process, and a later invocation that finds it
 * answering on the same `--driver-host-port` skips the install, so the harness pins one port and
 * passes `--no-reinstall-driver` once a flow has completed on this device.
 *
 * Flow state stays isolated by the flows themselves (each launches the app). Driver state does
 * too: any failed flow stops the runner of this device, so the next flow gets a fresh one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const IOS_DRIVER_PORT = 17101
const STATE_FILE = 'native-ios-driver.json'
const UDID = /^[0-9A-Fa-f-]{36}$/

const readState = (directory) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, STATE_FILE), 'utf8'))
  } catch {
    return null
  }
}

/** Global Maestro options that pin the driver port (iOS only). */
export const iosDriverGlobalArgs = (platform) =>
  platform === 'ios' ? ['--driver-host-port', String(IOS_DRIVER_PORT)] : []

/** `test` options: skip the reinstall only while a flow has already completed on this device. */
export function iosDriverTestArgs({ platform, directory, device }) {
  if (platform !== 'ios') return []
  const state = readState(directory)
  return state?.device === device && state.port === IOS_DRIVER_PORT
    ? ['--no-reinstall-driver']
    : []
}

/** SIGTERM of the xcodebuild runner(s) of this simulator only; other devices are untouched. */
export function stopIosDriver(device, spawn = spawnSync) {
  if (!UDID.test(device)) return { stopped: 0 }
  const listed = spawn('pgrep', ['-f', `xcodebuild test-without-building.*${device}`], {
    encoding: 'utf8',
  })
  const pids = String(listed.stdout ?? '')
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid)
  if (pids.length) spawn('kill', ['-TERM', ...pids.map(String)], { encoding: 'utf8' })
  return { stopped: pids.length }
}

/**
 * Called after every iOS flow. A pass marks the driver reusable; a failure stops it and clears
 * the mark so a stale runner cannot carry a broken flow into the next one.
 */
export function recordIosDriverFlow({ platform, directory, device, ok, spawn }) {
  if (platform !== 'ios') return null
  const file = path.join(directory, STATE_FILE)
  if (ok) {
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, device, port: IOS_DRIVER_PORT }) + '\n',
      { mode: 0o600 }
    )
    return { reusable: true }
  }
  fs.rmSync(file, { force: true })
  const { stopped } = stopIosDriver(device, spawn)
  console.log(JSON.stringify({ iosDriverStopped: { stopped } }))
  return { reusable: false, stopped }
}
