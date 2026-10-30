import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  beginExpoGoProbe,
  EXPO_GO_PROBE_FILE,
  metroLogCounts,
  metroSocketStates,
  readExpoGoVersion,
  summarizeExpoGoLog,
} from './native-ios-expo-go-probe.mjs'
import { closedValueProblem } from './native-ios-public-diagnostics.mjs'

const row = (messageType, eventMessage) => JSON.stringify({ messageType, eventMessage })

test('Expo Go log lines count by level and fixed family and keep no text', () => {
  const summary = summarizeExpoGoLog(
    [
      row('Error', 'NSURLErrorDomain -1001 timed out for http://127.0.0.1:8089/x.bundle'),
      row('Default', 'Downloading JavaScript bundle'),
      row('Fault', 'Hermes bytecode version mismatch'),
      row('Default', 'Unhandled JS Exception: boom'),
      row('Default', 'unrelated line'),
      'not json',
      row(undefined, 'no level'),
    ].join('\n')
  )
  assert.deepEqual(summary, {
    lines: 5,
    error: 1,
    fault: 1,
    families: {
      network: 1,
      manifest: 0,
      bundle: 2,
      hermes: 1,
      javascript: 1,
      memory: 0,
    },
  })
  assert.doesNotMatch(JSON.stringify(summary), /127\.0\.0\.1|boom/)
})

test('sockets to Metro count by state; its listener and other ports do not count', () => {
  const netstat = [
    'Active Internet connections (including servers)',
    'tcp4       0      0  127.0.0.1.8089         127.0.0.1.60001        ESTABLISHED',
    'tcp4       0      0  127.0.0.1.60001        127.0.0.1.8089         ESTABLISHED',
    'tcp4       0      0  127.0.0.1.8089         127.0.0.1.60002        TIME_WAIT',
    'tcp4       0      0  127.0.0.1.8089         127.0.0.1.60003        TIME_WAIT',
    'tcp46      0      0  *.8089                 *.*                    LISTEN',
    'tcp4       0      0  127.0.0.1.4088         127.0.0.1.60004        ESTABLISHED',
    'udp4       0      0  *.8089                 *.*',
  ].join('\n')
  assert.deepEqual(metroSocketStates(netstat), { ESTABLISHED: 2, TIME_WAIT: 2 })
  assert.deepEqual(metroSocketStates(''), {})
})

test('Metro log text counts bundle completions and failures', () => {
  assert.deepEqual(
    metroLogCounts(
      'iOS Bundled 1200ms entry.js (2233 modules)\niOS Bundled 40ms entry.js (1 module)\nBundling failed'
    ),
    { bundled: 2, failed: 1 }
  )
  assert.deepEqual(metroLogCounts(undefined), { bundled: 0, failed: 0 })
})

test('the Expo Go version is read from the app plist and must look like a version', () => {
  const spawn = (binary, args) => {
    assert.equal(binary, 'plutil')
    assert.deepEqual(args.slice(0, 4), [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
    ])
    assert.equal(args.at(-1), '/tmp/x/Expo Go.app/Info.plist')
    return { status: 0, stdout: '54.0.8\n' }
  }
  assert.equal(readExpoGoVersion('/tmp/x/Expo Go.app', { spawn }), '54.0.8')
  assert.equal(
    readExpoGoVersion('/tmp/x', { spawn: () => ({ status: 0, stdout: 'garbage' }) }),
    null
  )
  assert.equal(
    readExpoGoVersion('/tmp/x', {
      spawn: () => {
        throw new Error('no plutil')
      },
    }),
    null
  )
})

test('finish records the deltas since the baseline, writes a closed record and never throws', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-probe-'))
  try {
    fs.writeFileSync(path.join(directory, 'metro.log'), 'iOS Bundled 900ms e.js\n')
    const reports = []
    const spawn = (binary) =>
      binary === 'netstat'
        ? {
            status: 0,
            stdout: 'tcp4 0 0 127.0.0.1.8089 127.0.0.1.60002 TIME_WAIT\n',
          }
        : { status: 0, stdout: row('Error', 'could not connect') }
    const probe = beginExpoGoProbe({
      directory,
      device: 'DEV',
      version: '54.0.8',
      spawn,
      report: (line) => reports.push(line),
    })
    fs.appendFileSync(
      path.join(directory, 'metro.log'),
      'iOS Bundled 30ms e.js\niOS Bundled 31ms e.js\n'
    )
    probe.finish()
    const written = JSON.parse(fs.readFileSync(path.join(directory, EXPO_GO_PROBE_FILE)))
    assert.deepEqual(written.metro, { bundled: 2, failed: 0 })
    assert.deepEqual(written.metroSockets, { TIME_WAIT: 1 })
    assert.equal(written.expoGoVersion, '54.0.8')
    assert.equal(written.expoGoLog.error, 1)
    assert.equal(written.expoGoLog.families.network, 1)
    assert.equal(closedValueProblem(written), null)
    assert.deepEqual(JSON.parse(reports[0]), { expoGoProbe: written })

    const broken = beginExpoGoProbe({
      directory: path.join(directory, 'missing'),
      device: 'DEV',
      spawn: () => {
        throw new Error('boom')
      },
      report: (line) => reports.push(line),
    })
    assert.doesNotThrow(() => broken.finish())
    assert.match(reports.at(-1), /expoGoProbeFailure/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
