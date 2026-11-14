// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSyncMaestro,
  waitForPortFree,
  waitOutStaleSessions,
} from './maestro-driver-sync.mjs'

const PACKAGES = 'package:dev.mobile.maestro\npackage:dev.mobile.maestro.test\n'
const INSTRUMENTATION =
  'instrumentation:dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner (target=dev.mobile.maestro)\n'

/** A device whose driver packages come and go as adb and Maestro act on them. */
function fakeDevice({ failures = [], installsOnFailure = true, outputs = [] } = {}) {
  const state = { installed: true, adb: [], maestro: [], log: [] }
  const adb = (args) => {
    state.adb.push(args.join(' '))
    if (args[2] === 'uninstall') state.installed = false
    if (args.join(' ') === 'shell pm list packages dev.mobile.maestro')
      return state.installed ? PACKAGES : ''
    if (args.join(' ') === 'shell pm list instrumentation')
      return state.installed ? INSTRUMENTATION : ''
    return ''
  }
  const maestro = (args, options) => {
    state.maestro.push({ args, options })
    const failure = failures.shift()
    const output = outputs.shift()
    // Maestro installs the driver when it is missing, and with --no-reinstall-driver keeps it;
    // a driver that dies at start can leave it half installed.
    if (!failure || installsOnFailure) state.installed = true
    if (failure) {
      const error = new Error(failure)
      if (output) Object.defineProperty(error, 'output', { value: output })
      throw error
    }
    return 'ok'
  }
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb,
    maestro,
    read: () => '',
    log: (message) => state.log.push(message),
  })
  return { state, run }
}

const flow = ['--device', 'emulator-5554', 'test', '-e', 'A=1', 'flow.yaml']
const read = ['--device', 'emulator-5554', 'hierarchy']

test('the first invocation removes the driver; later ones reuse it without reinstalling', () => {
  const { state, run } = fakeDevice()
  run(flow, { timeout: 240_000 })
  run(read)
  run(flow)
  // Only the first invocation uninstalls, the instrumentation app first.
  assert.deepEqual(
    state.adb.filter((call) => call.includes('uninstall')),
    [
      'shell pm uninstall dev.mobile.maestro.test',
      'shell pm uninstall dev.mobile.maestro',
    ]
  )
  assert.deepEqual(state.maestro[0].args, [
    '--device',
    'emulator-5554',
    'test',
    '--no-reinstall-driver',
    '--driver-host-port',
    '17001',
    '-e',
    'A=1',
    'flow.yaml',
  ])
  assert.deepEqual(state.maestro[0].options, { timeout: 240_000 })
  // hierarchy has no port option in Maestro 2.8.
  assert.deepEqual(state.maestro[1].args, [
    '--device',
    'emulator-5554',
    'hierarchy',
    '--no-reinstall-driver',
  ])
  // Every invocation first stops the driver an earlier one left running.
  assert.equal(
    state.adb.filter((call) => call === 'shell am force-stop dev.mobile.maestro').length,
    3
  )
})

test('a driver that went missing between invocations fails at once, and the next starts fresh', () => {
  const { state, run } = fakeDevice()
  run(flow)
  state.installed = false
  assert.throws(() => run(flow), /maestro_driver_not_ready:package dev\.mobile\.maestro/)
  assert.equal(state.maestro.length, 1)
  run(flow)
  assert.equal(state.adb.filter((call) => call.includes('uninstall')).length, 4)
})

test('a hierarchy read whose driver did not start is read once more; a flow is not rerun', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const reader = fakeDevice({ failures: [died] })
  assert.equal(reader.run(read), 'ok')
  assert.equal(reader.state.maestro.length, 2)
  assert.match(reader.state.log[0], /maestro_hierarchy_retry: DeviceServerDiedException/)
  // A second failure is the run's to report.
  const twice = fakeDevice({ failures: [died, died] })
  assert.throws(() => twice.run(read), /DeviceServerDiedException/)
  assert.equal(twice.state.maestro.length, 2)
  // A flow changes the app, so it is never repeated.
  const flowRun = fakeDevice({ failures: [died] })
  assert.throws(() => flowRun.run(flow), /DeviceServerDiedException/)
  assert.equal(flowRun.state.maestro.length, 1)
  // Any other hierarchy failure is not a driver start.
  const other = fakeDevice({ failures: ['live_font_hierarchy_invalid'] })
  assert.throws(() => other.run(read), /live_font_hierarchy_invalid/)
  assert.equal(other.state.maestro.length, 1)
})

test('iOS invocations pass through untouched', () => {
  const calls = []
  const run = createSyncMaestro({
    platform: 'ios',
    device: 'udid',
    adb: () => assert.fail('no adb on iOS'),
    maestro: (args) => calls.push(args),
  })
  run(flow)
  assert.deepEqual(calls, [flow])
})

test('a stale session record is waited out; a live one stops the run', () => {
  let clock = 100_000
  const slept = []
  const staleRecord = 'ANDROID_emulator-5554_abc=90000\n'
  waitOutStaleSessions({
    device: 'emulator-5554',
    read: () => staleRecord,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms)
      clock += ms
    },
  })
  assert.ok(slept.length >= 1)
  assert.ok(clock - 90_000 >= 21_000, 'waited until the record aged out')
  let beat = 99_000
  assert.throws(
    () =>
      waitOutStaleSessions({
        device: 'emulator-5554',
        read: () => `ANDROID_emulator-5554_live=${beat}\n`,
        now: () => beat + 1_000,
        sleep: () => {
          beat += 5_000
        },
      }),
    /maestro_session_live:live/
  )
  // Another device's record does not hold this one.
  waitOutStaleSessions({
    device: 'emulator-5554',
    read: () => 'ANDROID_emulator-5556_x=99999\n',
    now: () => 100_000,
    sleep: () => assert.fail('no wait for another device'),
  })
})

test('before an invocation, a session record a failed start left is waited out', () => {
  // The failed start left its record at 95 s; the next invocation comes at 100 s.
  let clock = 100_000
  const calls = []
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb: () => '',
    maestro: (args) => calls.push({ args, at: clock }),
    read: () => 'ANDROID_emulator-5554_dead=95000\n',
    now: () => clock,
    sleep: (ms) => {
      clock += ms
    },
    log: () => undefined,
  })
  run(flow)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].at - 95_000 >= 21_000, `ran at ${calls[0].at}`)
})

// Antigravity r29 P2: a first run that died before installing the driver must not leave the next
// one checking a driver that was never there.
test('a run that died before installing the driver makes the next one start fresh', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const reader = fakeDevice({ failures: [died], installsOnFailure: false })
  assert.equal(reader.run(read), 'ok')
  assert.equal(reader.state.maestro.length, 2)
  // Both attempts started from a removed driver.
  assert.equal(reader.state.adb.filter((call) => call.includes('uninstall')).length, 4)
  const flows = fakeDevice({ failures: [died], installsOnFailure: false })
  assert.throws(() => flows.run(flow), /DeviceServerDiedException/)
  assert.equal(flows.run(flow), 'ok')
  assert.equal(flows.state.adb.filter((call) => call.includes('uninstall')).length, 4)
})

test('only the hierarchy subcommand is retried, read from its position', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const named = fakeDevice({ failures: [died] })
  const args = ['--device', 'emulator-5554', 'test', '-e', 'hierarchy', 'flow.yaml']
  assert.throws(() => named.run(args), /DeviceServerDiedException/)
  assert.equal(named.state.maestro.length, 1)
})

test('a driver start cause past the kept tail of the message is read from the whole output', () => {
  const long = fakeDevice({
    failures: [
      'live_font_command_failed:maestro hierarchy:1:...tail of a long traceback',
    ],
    outputs: ["DeviceServerDiedException: Device server died during 'deviceInfo'\n..."],
  })
  assert.equal(long.run(read), 'ok')
  assert.equal(long.state.maestro.length, 2)
})

test('maestro test waits for its pinned port to be free; hierarchy does not', () => {
  const held = '  1: 0100007F:4269 00000000:0000 0A 00000000:00000000\n'
  let reads = 0
  let installed = false
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb: (args) => {
      if (args.includes('/proc/net/tcp')) return reads++ < 2 ? held : ''
      if (args.includes('uninstall')) installed = false
      if (args.includes('packages')) return installed ? PACKAGES : ''
      if (args.includes('instrumentation')) return installed ? INSTRUMENTATION : ''
      return ''
    },
    maestro: () => {
      installed = true
      return 'ok'
    },
    read: () => '',
    sleep: () => undefined,
    log: () => undefined,
  })
  run(read)
  assert.equal(reads, 0)
  run(flow)
  assert.equal(reads, 3)
  let clock = 0
  assert.throws(
    () =>
      waitForPortFree({
        adb: () => held,
        port: 17001,
        now: () => clock,
        sleep: (ms) => {
          clock += ms
        },
      }),
    /maestro_driver_port_busy:17001/
  )
  // A device that hides its socket table is not checked.
  waitForPortFree({
    adb: () => {
      throw new Error('permission denied')
    },
    port: 17001,
    log: () => undefined,
  })
})
