import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  seedOwnedSiriPreferences,
  SIRI_DOMAIN,
  SIRI_KEYS,
} from './native-ios-siri-preferences.mjs'
import { collectSimulatorLogCounts, logCounter } from './native-ios-log-counts.mjs'
import { cleanupOwnedDevice } from './native-ios-device-cleanup.mjs'

const device = 'A63391DE-17A2-4B16-9C93-16B986580C99'
const directoryFor = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-runtime-diagnostics-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'owned-startup-device.txt'), device)
  return directory
}

test('log summaries retain only process/subsystem counts and omit message bodies and arbitrary fields', () => {
  const c = logCounter()
  for (const processImagePath of ['/sim/Emitter', '/sim/Emitter', '/sim/Other'])
    c.line(
      JSON.stringify({
        processImagePath,
        subsystem: 'com.apple.test',
        eventMessage: 'private-message-body',
        backtrace: 'private-backtrace',
      })
    )
  c.line('invalid-private-line')
  const r = c.result()
  assert.equal(r.entries, 3)
  assert.equal(r.invalidLines, 1)
  assert.deepEqual(r.processes, [
    { process: 'Emitter', count: 2 },
    { process: 'Other', count: 1 },
  ])
  assert.deepEqual(r.subsystems, [{ subsystem: 'com.apple.test', count: 3 }])
  assert.doesNotMatch(JSON.stringify(r), /private|message|backtrace|\/sim/)
})

test('a real one-shot child is streamed into a body-free receipt', async (t) => {
  const directory = directoryFor(t)
  const r = await collectSimulatorLogCounts(device, directory, {
    binary: process.execPath,
    args: [
      '-e',
      'console.log(JSON.stringify({processImagePath:"/sim/Emitter",subsystem:"com.apple.test",eventMessage:"private-message-body"}))',
    ],
    timeoutMs: 2000,
    gateOutcome: 'cap_hit',
  })
  assert.equal(r.exitCode, 0)
  assert.equal(r.entries, 1)
  assert.equal(r.gateOutcome, 'cap_hit')
  assert.equal(r.windowSeconds, 120)
  assert.equal(r.timedOut, false)
  assert.doesNotMatch(
    fs.readFileSync(path.join(directory, 'native-ios-log-counts.json'), 'utf8'),
    /private-message-body|eventMessage/
  )
})

test('a stuck or oversized log query is bounded and returns partial evidence without failing the run', async (t) => {
  const directory = directoryFor(t)
  const timeout = await collectSimulatorLogCounts(device, directory, {
    binary: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'],
    timeoutMs: 150,
  })
  assert.equal(timeout.timedOut, true)
  assert.equal(timeout.signal, 'SIGKILL')
  assert.ok(timeout.durationMs < 1500)
  const capped = await collectSimulatorLogCounts(device, directory, {
    binary: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(100000))'],
    timeoutMs: 2000,
    maxBytes: 64,
  })
  assert.equal(capped.outputCapped, true)
  assert.ok(capped.bytes > 64)
  assert.equal(capped.entries, 0)
})

test('a failed log-query launch publishes its exact error without throwing', async (t) => {
  const directory = directoryFor(t)
  const r = await collectSimulatorLogCounts(device, directory, {
    binary: '/missing/cc68-log-query',
    args: [],
    timeoutMs: 1000,
  })
  assert.equal(r.errorCode, 'ENOENT')
  assert.equal(r.entries, 0)
})

test('Siri intervention verifies the selected runtime keys and changes only the owned device before boot', (t) => {
  const directory = directoryFor(t)
  const runtime = {
    runtimeRoot: path.join(directory, 'runtime'),
    identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
    version: '18.5',
    buildversion: '22F77',
  }
  const binary = path.join(
    runtime.runtimeRoot,
    'System/Library/PrivateFrameworks/AssistantServices.framework/AssistantServices'
  )
  fs.mkdirSync(path.dirname(binary), { recursive: true })
  fs.writeFileSync(binary, [SIRI_DOMAIN, ...SIRI_KEYS].join('\0'))
  const calls = [],
    values = new Map(SIRI_KEYS.map((key) => [key, '1']))
  const command = (operation, executable, args, options) => {
    calls.push({ operation, executable, args, options })
    const key = executable === 'xcrun' ? args.at(-1) : args[2]
    if (args[0] === 'write') values.set(key, '0')
    return { exitCode: 0, stdout: values.get(key) + '\n' }
  }
  const afterBoot = seedOwnedSiriPreferences({
    device,
    directory,
    runtime,
    command,
    home: directory,
  })
  assert.equal(calls.length, 6)
  assert.equal(
    calls.some((c) => c.executable === 'xcrun'),
    false
  )
  for (const call of calls) {
    assert.ok(
      call.args[1].startsWith(
        path.join(
          directory,
          'Library/Developer/CoreSimulator/Devices',
          device,
          'data/Library/Preferences'
        )
      )
    )
    assert.equal(call.options.fatal, false)
  }
  afterBoot()
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-siri-preferences.json'), 'utf8')
  )
  assert.equal(record.runtime.build, '22F77')
  assert.equal(record.deviceType, 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro')
  assert.equal(record.changes.length, 2)
  assert.ok(record.changes.every((c) => c.before === '1' && c.confirmedFalse))
  assert.ok(record.postBoot.every((c) => c.confirmedFalse))
  assert.deepEqual(calls.at(-1).args.slice(0, 5), [
    'simctl',
    'spawn',
    device,
    'defaults',
    'read',
  ])
})

test('unknown runtime keys and mismatched device receipts cannot change any preference', (t) => {
  const directory = directoryFor(t)
  const runtime = {
    runtimeRoot: path.join(directory, 'missing-runtime'),
    identifier: 'runtime',
    version: 'unknown',
    buildversion: 'unknown',
  }
  let writes = 0
  seedOwnedSiriPreferences({
    device,
    directory,
    runtime,
    home: directory,
    command: () => {
      writes++
      return { exitCode: 0, stdout: '' }
    },
  })
  assert.equal(writes, 0)
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-siri-preferences.json'), 'utf8')
  )
  assert.equal(record.keysPresentInRuntime, false)
  assert.equal(record.sourceError.errorCode, 'ENOENT')
  assert.throws(
    () =>
      seedOwnedSiriPreferences({
        device: 'B63391DE-17A2-4B16-9C93-16B986580C99',
        directory,
        runtime,
        command: () => {
          writes++
        },
      }),
    /owned_created_device_receipt_required/
  )
  assert.equal(writes, 0)
})

test('helper cleanup then workflow cleanup records already-deleted without a second simctl call', (t) => {
  const directory = directoryFor(t)
  const calls = []
  const command = (_operation, _binary, args) => {
    calls.push(args)
    return { exitCode: 0, stderr: '' }
  }
  assert.equal(cleanupOwnedDevice(device, directory, command).outcome, 'deleted')
  assert.equal(cleanupOwnedDevice(device, directory, command).outcome, 'already-deleted')
  assert.deepEqual(calls, [['simctl', 'delete', device]])
})

test('a missing exact device is already-deleted, while another deletion error remains explicit', (t) => {
  const directory = directoryFor(t)
  const r = cleanupOwnedDevice(device, directory, () => ({
    exitCode: 148,
    stderr: 'Invalid device: ' + device,
  }))
  assert.equal(r.outcome, 'already-deleted')
  const other = directoryFor(t)
  const error = cleanupOwnedDevice(device, other, () => ({
    exitCode: null,
    errorCode: 'ETIMEDOUT',
    stderr: 'service unavailable',
  }))
  assert.equal(error.outcome, 'delete-failed')
  assert.equal(error.errorCode, 'ETIMEDOUT')
  assert.equal(error.stderr, 'service unavailable')
})

test('cleanup refuses a UUID absent from the job receipt before issuing any command', (t) => {
  const directory = directoryFor(t)
  let invoked = false
  assert.throws(
    () =>
      cleanupOwnedDevice('B63391DE-17A2-4B16-9C93-16B986580C99', directory, () => {
        invoked = true
      }),
    /owned_created_device_receipt_required/
  )
  assert.equal(invoked, false)
})
