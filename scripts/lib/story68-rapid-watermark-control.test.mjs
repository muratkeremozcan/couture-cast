import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { summarizeNativeFlowFailure } from './share-card-native-failure.mjs'
import {
  withRapidWatermarkControl,
  redactRapidWatermarkControl,
  closedRapidWatermarkFailure,
} from './story68-rapid-watermark-control.mjs'

async function post(url) {
  const response = await fetch(url, { method: 'POST' })
  await response.text()
  return response.status
}
function locking(events) {
  return async (whileLocked) => {
    events.push('locked')
    try {
      await whileLocked(new AbortController().signal)
    } finally {
      events.push('rollback')
    }
    return { heldMs: 8, blockedSourceObserved: true }
  }
}

describe('withRapidWatermarkControl', () => {
  test('starts the HTTP server and warms the driver before acquiring; release acknowledges actual rollback', async () => {
    const events = []
    const result = await withRapidWatermarkControl({
      withLock: locking(events),
      runFlow: async ({ url }) => {
        events.push('driver-ready')
        assert.equal(await post(`${url}/acquire`), 200)
        events.push('acquire-returned')
        assert.deepEqual(events, ['driver-ready', 'locked', 'acquire-returned'])
        assert.equal(await post(`${url}/release`), 200)
        assert.equal(events.at(-1), 'rollback')
        events.push('driver-shutdown')
      },
    })
    assert.equal(result.heldMs, 8)
    assert.deepEqual(events, [
      'driver-ready',
      'locked',
      'acquire-returned',
      'rollback',
      'driver-shutdown',
    ])
  })

  test('a random capability path and POST are required before any lock is acquired', async () => {
    let locked = false
    await assert.rejects(
      withRapidWatermarkControl({
        withLock: async () => {
          locked = true
        },
        runFlow: async ({ url }) => {
          assert.equal(await post(`${new URL(url).origin}/unowned/acquire`), 404)
          const response = await fetch(`${url}/acquire`)
          assert.equal(response.status, 404)
          await response.text()
        },
      }),
      /rapid_watermark_acquire_required/
    )
    assert.equal(locked, false)
  })

  test('release before acquisition and duplicate acquisition are rejected without another lock', async () => {
    const events = []
    await withRapidWatermarkControl({
      withLock: locking(events),
      runFlow: async ({ url }) => {
        assert.equal(await post(`${url}/release`), 409)
        assert.equal(await post(`${url}/acquire`), 200)
        assert.equal(await post(`${url}/acquire`), 409)
        assert.equal(await post(`${url}/release`), 200)
        assert.equal(await post(`${url}/release`), 409)
      },
    })
    assert.deepEqual(events, ['locked', 'rollback'])
  })

  test('a failed flow before release aborts and rolls back while preserving its original error', async () => {
    const events = []
    const original = new Error('actual_maestro_assertion_failed')
    let signal
    await assert.rejects(
      withRapidWatermarkControl({
        withLock: locking(events),
        runFlow: async ({ url }, active) => {
          signal = active
          assert.equal(await post(`${url}/acquire`), 200)
          throw original
        },
      }),
      (error) => error === original
    )
    assert.equal(signal.aborted, true)
    assert.deepEqual(events, ['locked', 'rollback'])
  })

  test('a completed flow without release still fails and releases its held transaction', async () => {
    const events = []
    await assert.rejects(
      withRapidWatermarkControl({
        withLock: locking(events),
        runFlow: async ({ url }) => {
          assert.equal(await post(`${url}/acquire`), 200)
        },
      }),
      /rapid_watermark_release_required/
    )
    assert.deepEqual(events, ['locked', 'rollback'])
  })

  test('a database failure before the lock returns 503 and never claims acquisition', async () => {
    const original = new Error('effective_owned_database_mismatch')
    await assert.rejects(
      withRapidWatermarkControl({
        withLock: async () => {
          throw original
        },
        runFlow: async ({ url }) => {
          assert.equal(await post(`${url}/acquire`), 503)
        },
      }),
      (error) => error === original
    )
  })

  test('a lock deadline aborts the flow and waits for the child to settle before returning', async () => {
    const original = new Error('rapid_watermark_hold_deadline')
    let settled = false
    await assert.rejects(
      withRapidWatermarkControl({
        withLock: async (held) => {
          const controller = new AbortController()
          const pending = held(controller.signal)
          queueMicrotask(() => controller.abort(original))
          return pending
        },
        runFlow: async ({ url }, signal) => {
          await post(`${url}/acquire`)
          await new Promise((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
          settled = true
        },
      }),
      (error) => error === original
    )
    assert.equal(settled, true)
  })

  test('capabilities are removed from every owned nested text artifact and failure codes remain closed', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'cc68-rapid-control-redaction-')
    )
    const token = 'private-one-shot-token'
    const url = `http://127.0.0.1:12345/${token}`
    try {
      fs.mkdirSync(path.join(directory, 'nested'))
      fs.writeFileSync(path.join(directory, 'process.log'), `URL ${url}/acquire`)
      fs.writeFileSync(
        path.join(directory, 'nested', 'commands.json'),
        JSON.stringify({ env: url, encoded: encodeURIComponent(url) })
      )
      redactRapidWatermarkControl(directory, url)
      for (const file of ['process.log', 'nested/commands.json'])
        assert.equal(
          fs.readFileSync(path.join(directory, file), 'utf8').includes(token),
          false
        )
      assert.equal(
        closedRapidWatermarkFailure(new Error(`private failure ${url}`)),
        'native_rapid_watermark_failed'
      )
      assert.equal(
        closedRapidWatermarkFailure(new Error('rapid_watermark_hold_deadline')),
        'rapid_watermark_hold_deadline'
      )
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })

  test('the actual async child failure path publishes only the closed four-field native record', async () => {
    const source = fs.readFileSync('scripts/run-story68-native.mjs', 'utf8')
    const start = source.indexOf('function rapidWatermarkFlow(')
    const end = source.indexOf("\nif (command === 'prebuild')", start)
    const records = []
    const timings = []
    const child = new EventEmitter()
    const context = {
      signal: new AbortController().signal,
      control: { url: 'http://127.0.0.1:12345/private-capability' },
      reverse: () => undefined,
      path,
      directory: '/owned/runtime',
      platform: 'ios',
      device: 'owned',
      maestroBinary: 'fake-maestro',
      root: process.cwd(),
      localeEnv: () => ({}),
      process: { env: {} },
      setTimeout,
      clearTimeout,
      fs: {
        mkdirSync: () => undefined,
        openSync: () => 1,
        closeSync: () => undefined,
        existsSync: () => true,
        readFileSync: () =>
          'AssertionFailure PRIVATE_USER@example.test private-capability',
      },
      spawn: () => {
        queueMicrotask(() => child.emit('close', 1))
        return child
      },
      privateJson: (file, record) => records.push({ file, record }),
      summarizeNativeFlowFailure,
      redactRapidWatermarkControl: () => undefined,
      recordIosCommandTimings: (options) => timings.push(options),
    }
    const result = vm.runInNewContext(
      `(${source.slice(start, end)})(signal, control)`,
      context
    )
    await assert.rejects(result, /native_rapid_watermark_flow_failed/)
    assert.equal(records.length, 1)
    assert.equal(records[0].file, 'native-flow-failure-ios.json')
    assert.deepEqual(Object.keys(records[0].record).sort(), [
      'classification',
      'durationMs',
      'flow',
      'platform',
    ])
    assert.equal(records[0].record.flow, 'rapid-watermark-held.yaml')
    assert.equal(records[0].record.classification, 'assertion')
    assert.equal(timings.length, 1)
    assert.equal(timings[0].flow, 'maestro/story68/rapid-watermark-held.yaml')
    assert.equal(timings[0].minMs, 0)
    assert.equal(JSON.stringify(records).includes('PRIVATE_USER'), false)
    assert.equal(JSON.stringify(records).includes('private-capability'), false)
  })
})
