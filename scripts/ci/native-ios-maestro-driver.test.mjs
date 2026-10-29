import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  IOS_DRIVER_PORT,
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

test('the first flow installs; later flows skip the reinstall until a failure', () => {
  const directory = tmp()
  const args = () => iosDriverTestArgs({ platform: 'ios', directory, device })
  assert.deepEqual(args(), [])
  recordIosDriverFlow({ platform: 'ios', directory, device, ok: true })
  assert.deepEqual(args(), ['--no-reinstall-driver'])
  recordIosDriverFlow({
    platform: 'ios',
    directory,
    device,
    ok: false,
    spawn: () => ({ stdout: '' }),
  })
  assert.deepEqual(args(), [])
})

test('a driver warmed on another device is never reused', () => {
  const directory = tmp()
  recordIosDriverFlow({ platform: 'ios', directory, device: other, ok: true })
  assert.deepEqual(iosDriverTestArgs({ platform: 'ios', directory, device }), [])
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
})

test('a device name that is not a simulator id is refused before any process is listed', () => {
  const spawn = () => assert.fail('no process may be listed')
  assert.deepEqual(stopIosDriver('booted; rm -rf /', spawn), { stopped: 0 })
})
