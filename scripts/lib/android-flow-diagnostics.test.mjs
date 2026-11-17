// CI run 43919975098 (mobile-e2e-android shard 1, job 133485499295): garment-capture-flow failed
// on `app-root-mounted` three times. The window stack held only Expo Go's system splash for
// HomeActivity and the process list held no Expo Go process, but the saved log was the last
// 4000 lines, about 36 s of UiAutomator noise, and nothing showed whether Expo Go died, whether
// it ever asked Metro for the bundle, or when. These captures answer each of those.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  ANDROID_LOG_BUFFER,
  androidFailureCaptures,
  createLineLog,
  describeExpoGoPid,
  logcatSinceArgs,
  metroOutputSince,
} from './android-flow-diagnostics.mjs'

describe('logcatSinceArgs', () => {
  test('dumps every buffer from the flow start, as epoch seconds with milliseconds', () => {
    assert.deepEqual(logcatSinceArgs(Date.UTC(2026, 10, 16, 17, 47, 7, 836)), [
      'logcat',
      '-d',
      '-b',
      'all',
      '-v',
      'threadtime',
      '-T',
      '1794851227.836',
    ])
  })

  test('the buffer is large enough to hold a whole flow', () => {
    assert.deepEqual(ANDROID_LOG_BUFFER, ['logcat', '-b', 'all', '-G', '16M'])
  })
})

describe('androidFailureCaptures', () => {
  test('saves the windows, the log since the flow started, the processes and Expo Go pid', () => {
    const captures = androidFailureCaptures(Date.UTC(2026, 10, 16, 17, 47, 7, 836))
    assert.deepEqual(
      captures.map(({ suffix, label }) => [suffix, label]),
      [
        ['windows', 'window stack'],
        ['logcat', 'device log since the flow started'],
        ['processes', 'process list'],
        ['expo-go-pid', 'Expo Go process id'],
      ]
    )
    assert.deepEqual(
      captures.find(({ suffix }) => suffix === 'logcat').args,
      logcatSinceArgs(Date.UTC(2026, 10, 16, 17, 47, 7, 836))
    )
    assert.deepEqual(captures.find(({ suffix }) => suffix === 'expo-go-pid').args, [
      'shell',
      'pidof',
      'host.exp.exponent',
    ])
  })

  test('without a start time the log falls back to its tail', () => {
    const logcat = androidFailureCaptures(undefined).find(
      ({ suffix }) => suffix === 'logcat'
    )
    assert.deepEqual(logcat.args, ['logcat', '-d', '-t', '4000'])
    assert.equal(logcat.label, 'device log tail')
  })

  test('plain captures keep stdout and refuse an empty or failed answer', () => {
    const windows = androidFailureCaptures(1).find(({ suffix }) => suffix === 'windows')
    assert.equal(windows.describe({ status: 0, stdout: 'Window #0' }), 'Window #0')
    assert.equal(windows.describe({ status: 0, stdout: '' }), null)
    assert.equal(windows.describe({ status: 1, stdout: 'partial' }), null)
  })
})

describe('describeExpoGoPid', () => {
  test('names the running process, and says so when there is none', () => {
    assert.equal(
      describeExpoGoPid({ status: 0, stdout: '9871\n' }),
      'host.exp.exponent pid 9871\n'
    )
    // pidof exits 1 with no output when nothing matches: that is the answer, not a failure.
    assert.equal(
      describeExpoGoPid({ status: 1, stdout: '', stderr: '' }),
      'host.exp.exponent: no process\n'
    )
    assert.equal(
      describeExpoGoPid({ status: 1, stdout: '', stderr: 'adb: no devices' }),
      null
    )
    assert.equal(describeExpoGoPid({ status: null, stdout: '' }), null)
  })
})

describe('createLineLog', () => {
  test('keeps whole lines with the time each arrived, and returns those since a moment', () => {
    let now = 1000
    const metro = createLineLog({ now: () => now })
    const out = metro.writer()
    out.write('Android Bundled 141ms apps/mobile/index.ts (1 module)\nAndroid ')
    now = 2000
    out.write('Bundled 45ms node_modules/expo-file-system/legacy.ts (1 module)\n')
    now = 3000
    out.write(Buffer.from(' WARN  late\n'))
    assert.equal(
      metro.since(1500),
      [
        '1970-01-01T00:00:02.000Z Android Bundled 45ms node_modules/expo-file-system/legacy.ts (1 module)',
        '1970-01-01T00:00:03.000Z  WARN  late',
        '',
      ].join('\n')
    )
    assert.equal(metro.since(5000), '')
  })

  test('keeps at most maxLines, dropping the oldest', () => {
    let now = 0
    const metro = createLineLog({ now: () => (now += 1), maxLines: 2 })
    const out = metro.writer()
    for (const line of ['a', 'b', 'c']) out.write(`${line}\n`)
    assert.equal(
      metro.since(0),
      '1970-01-01T00:00:00.002Z b\n1970-01-01T00:00:00.003Z c\n'
    )
  })

  // CodeRabbit on PR 242: one partial line for both streams spliced a stderr error into a
  // stdout bundle line, and an error with no newline was never saved.
  test('keeps each stream whole and shows an unterminated line without consuming it', () => {
    let now = 0
    const metro = createLineLog({ now: () => (now += 1) })
    const out = metro.writer()
    const err = metro.writer()
    out.write('Android Bun')
    err.write('Error: disconnected\n')
    out.write('dled 45ms apps/mobile/index.ts\n')
    err.write('Error: connection closed')
    const lines = metro.since(0)
    assert.equal(
      lines,
      [
        '1970-01-01T00:00:00.002Z Error: disconnected',
        '1970-01-01T00:00:00.003Z Android Bundled 45ms apps/mobile/index.ts',
        '1970-01-01T00:00:00.004Z Error: connection closed',
        '',
      ].join('\n')
    )
    assert.equal(metro.since(0), lines, 'reading takes nothing away')
    err.write(' by peer\n')
    assert.match(metro.since(0), /Z Error: connection closed by peer\n$/)
  })
})

describe('metroOutputSince', () => {
  test('tells a Metro this run did not start apart from a Metro that said nothing', () => {
    const metro = createLineLog({ now: () => 10 })
    assert.equal(
      metroOutputSince(metro, 0),
      'Metro output was not captured: this run did not start Metro.\n'
    )
    const out = metro.writer()
    assert.equal(
      metroOutputSince(metro, 0),
      'Metro printed nothing since the flow started.\n'
    )
    out.write('Android Bundled 9ms\n')
    assert.equal(
      metroOutputSince(metro, 0),
      '1970-01-01T00:00:00.010Z Android Bundled 9ms\n'
    )
  })
})
