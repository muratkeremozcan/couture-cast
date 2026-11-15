import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  IOS_DRIVER_PORT,
  IOS_DRIVER_RUNNER_BUNDLE,
  iosDriverGlobalArgs,
  iosDriverTestArgs,
  recordIosDriverFlow,
  stopIosDriver,
} from './native-ios-maestro-driver.mjs'

const device = 'CA0B0E89-6DC8-4846-9D34-14E6DC90A4A7'
const other = '1EA78792-74C3-4EFA-B7D4-6461428726E1'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-driver-'))

test('only iOS pins the driver port', () => {
  assert.deepEqual(iosDriverGlobalArgs('ios'), [
    '--driver-host-port',
    String(IOS_DRIVER_PORT),
  ])
  assert.deepEqual(iosDriverGlobalArgs('android'), [])
})

// Maestro 2.8 kills a runner started without --no-reinstall-driver as it exits (nightly run
// 43707223465), so every iOS flow passes the flag; one with no reuse mark stops this device's
// runner first and so still starts from a fresh one.
test('every iOS flow keeps its runner; a flow with no reuse mark stops the old one first', () => {
  const directory = tmp()
  const calls = []
  const spawn = (command, args) => {
    calls.push([command, ...args].join(' '))
    return { stdout: '' }
  }
  const args = () => iosDriverTestArgs({ platform: 'ios', directory, device, spawn })
  assert.deepEqual(args(), ['--no-reinstall-driver'])
  assert.deepEqual(calls, [
    `pgrep -f xcodebuild test-without-building.*${device}`,
    `xcrun simctl terminate ${device} ${IOS_DRIVER_RUNNER_BUNDLE}`,
  ])
  recordIosDriverFlow({ platform: 'ios', directory, device, ok: true })
  calls.length = 0
  assert.deepEqual(args(), ['--no-reinstall-driver'])
  assert.deepEqual(calls, [], 'a marked runner is reused as it is')
  recordIosDriverFlow({ platform: 'ios', directory, device, ok: false, spawn })
  calls.length = 0
  assert.deepEqual(args(), ['--no-reinstall-driver'])
  assert.equal(calls.length, 2, 'after a failure the next flow stops the runner first')
})

test('a driver warmed on another device is never reused', () => {
  const directory = tmp()
  const calls = []
  const spawn = (command, args) => {
    calls.push([command, ...args].join(' '))
    return { stdout: '' }
  }
  recordIosDriverFlow({ platform: 'ios', directory, device: other, ok: true })
  assert.deepEqual(iosDriverTestArgs({ platform: 'ios', directory, device, spawn }), [
    '--no-reinstall-driver',
  ])
  assert.ok(
    calls.includes(`xcrun simctl terminate ${device} ${IOS_DRIVER_RUNNER_BUNDLE}`)
  )
})

test('android never records or reuses a driver', () => {
  const directory = tmp()
  assert.equal(
    recordIosDriverFlow({ platform: 'android', directory, device, ok: true }),
    null
  )
  assert.deepEqual(iosDriverTestArgs({ platform: 'android', directory, device }), [])
  assert.deepEqual(fs.readdirSync(directory), [])
})

test('stopping signals only the runners of this device and never the harness', () => {
  const calls = []
  const spawn = (command, args) => {
    calls.push([command, ...args])
    return { stdout: command === 'pgrep' ? `4242\n${process.pid}\n1\nnope\n77\n` : '' }
  }
  assert.deepEqual(stopIosDriver(device, spawn), { stopped: 2 })
  assert.deepEqual(calls[0], [
    'pgrep',
    '-f',
    `xcodebuild test-without-building.*${device}`,
  ])
  assert.deepEqual(calls[1], ['kill', '-TERM', '4242', '77'])
  // The runner app goes too, so a later --no-reinstall-driver flow cannot reuse it.
  assert.deepEqual(calls[2], [
    'xcrun',
    'simctl',
    'terminate',
    device,
    IOS_DRIVER_RUNNER_BUNDLE,
  ])
  assert.equal(calls.length, 3)
})

test('a device name that is not a simulator id is refused before any process is listed', () => {
  const spawn = () => assert.fail('no process may be listed')
  assert.deepEqual(stopIosDriver('booted; rm -rf /', spawn), { stopped: 0 })
})
