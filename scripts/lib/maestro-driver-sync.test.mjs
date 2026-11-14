// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSyncMaestro, waitOutStaleSessions } from './maestro-driver-sync.mjs'

const PACKAGES = 'package:dev.mobile.maestro\npackage:dev.mobile.maestro.test\n'
const INSTRUMENTATION =
  'instrumentation:dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner (target=dev.mobile.maestro)\n'

/** A device whose driver packages come and go as adb and Maestro act on them. */
function fakeDevice({ failures = [] } = {}) {
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
    // Maestro installs the driver when it is missing, and with --no-reinstall-driver keeps it.
    state.installed = true
    const failure = failures.shift()
    if (failure) throw new Error(failure)
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
