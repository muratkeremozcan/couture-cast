// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Antigravity r30 item 3: every restore step of the live font-scale proof runs on its own, the
// report is still written, and SIGINT or SIGTERM run the restores once.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'

import { installRestoreGuard } from './live-font-run-guard.mjs'

/** A process stand-in: signals are events, exit and stderr are recorded. */
function fakeProcess() {
  const proc = new EventEmitter()
  proc.exits = []
  proc.errors = []
  proc.exit = (code) => proc.exits.push(code)
  proc.stderr = { write: (text) => proc.errors.push(text) }
  return proc
}

describe('installRestoreGuard', () => {
  test('a throwing first step still runs the second and the report writer', () => {
    const proc = fakeProcess()
    const guard = installRestoreGuard({ proc })
    const ran = []
    guard.step('timezone', () => {
      ran.push('timezone')
      throw new Error('live_font_command_failed:adb shell cmd alarm:1:')
    })
    guard.step('font-scale', () => ran.push('font-scale'))
    let reported
    const errors = guard.finish((restoreErrors) => {
      ran.push('report')
      reported = restoreErrors
    })
    assert.deepEqual(ran, ['timezone', 'font-scale', 'report'])
    const expected = [
      { step: 'timezone', error: 'live_font_command_failed:adb shell cmd alarm:1:' },
    ]
    assert.deepEqual(reported, expected)
    assert.deepEqual(errors, expected)
    // finish removes the handlers, so a later signal takes the default path.
    assert.equal(proc.listenerCount('SIGINT'), 0)
    assert.equal(proc.listenerCount('SIGTERM'), 0)
    assert.deepEqual(proc.exits, [])
  })

  test('every step runs once however often the restores are asked for', () => {
    const proc = fakeProcess()
    const guard = installRestoreGuard({ proc })
    let runs = 0
    guard.step('font-scale', () => {
      runs += 1
    })
    guard.restore()
    guard.restore()
    guard.finish(() => undefined)
    assert.equal(runs, 1)
  })

  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])
    test(`${signal} runs the restores once and exits with ${code}`, () => {
      const proc = fakeProcess()
      const guard = installRestoreGuard({ proc })
      const ran = []
      guard.step('status-bar', () => {
        ran.push('status-bar')
        throw new Error('simctl gone')
      })
      guard.step('font-scale', () => ran.push('font-scale'))
      proc.emit(signal)
      assert.deepEqual(ran, ['status-bar', 'font-scale'])
      assert.deepEqual(proc.exits, [code])
      assert.deepEqual(proc.errors, [
        'live_font_restore_failed: status-bar: simctl gone\n',
      ])
      // The run's own finish after the signal restores nothing twice.
      guard.finish(() => undefined)
      assert.deepEqual(ran, ['status-bar', 'font-scale'])
    })

  test('a second signal while the restores run is ignored', () => {
    const proc = fakeProcess()
    const guard = installRestoreGuard({ proc })
    const ran = []
    guard.step('timezone', () => {
      ran.push('timezone')
      proc.emit('SIGTERM')
      proc.emit('SIGINT')
    })
    guard.step('font-scale', () => ran.push('font-scale'))
    proc.emit('SIGINT')
    assert.deepEqual(ran, ['timezone', 'font-scale'])
    assert.deepEqual(proc.exits, [130])
    proc.emit('SIGTERM')
    assert.deepEqual(proc.exits, [130])
  })

  test('a step added after a restore still runs at the next one', () => {
    const proc = fakeProcess()
    const guard = installRestoreGuard({ proc })
    const ran = []
    guard.step('font-scale', () => ran.push('font-scale'))
    guard.restore()
    guard.step('status-bar', () => ran.push('status-bar'))
    proc.emit('SIGINT')
    assert.deepEqual(ran, ['font-scale', 'status-bar'])
    assert.deepEqual(proc.exits, [130])
  })

  test('a report writer that throws still removes the handlers', () => {
    const proc = fakeProcess()
    const guard = installRestoreGuard({ proc })
    assert.throws(
      () =>
        guard.finish(() => {
          throw new Error('disk full')
        }),
      /disk full/
    )
    assert.equal(proc.listenerCount('SIGINT'), 0)
  })
})
