import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { projectStartupTimings } from './native-ios-startup-timings.mjs'

const directory = (record) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-timings-'))
  if (record !== undefined)
    fs.writeFileSync(path.join(dir, 'native-ios-startup-private.json'), record)
  return dir
}

test('only the operation name, duration and exit facts leave the private startup record', () => {
  const dir = directory(
    JSON.stringify({
      version: 1,
      commands: [
        {
          operation: 'install-client',
          binary: 'xcrun',
          args: [
            'simctl',
            'install',
            '8F3C6A1E-1B2D-4C5E-9A7B-0123456789AB',
            '/Users/runner/app',
          ],
          durationMs: 60012.4,
          exitCode: null,
          signal: 'SIGKILL',
          errorCode: 'ETIMEDOUT',
          stdout: 'secret /Users/runner/x',
          stderr: 'eyJhbGciOiJIUzI1NiJ9.e30.c2ln',
        },
        {
          operation: 'bootstatus',
          durationMs: 81000,
          exitCode: 0,
          signal: null,
          errorCode: null,
        },
      ],
    })
  )
  const projected = projectStartupTimings(dir)
  assert.deepEqual(projected, {
    version: 1,
    commands: [
      {
        operation: 'install-client',
        durationMs: 60012,
        exitCode: null,
        signal: 'SIGKILL',
        errorCode: 'ETIMEDOUT',
      },
      {
        operation: 'bootstatus',
        durationMs: 81000,
        exitCode: 0,
        signal: null,
        errorCode: null,
      },
    ],
  })
  const text = JSON.stringify(projected)
  for (const leak of ['8F3C', 'Users', 'eyJ', 'secret', 'xcrun'])
    assert.equal(text.includes(leak), false, leak)
})

test('a missing, unreadable or malformed record projects nothing', () => {
  assert.equal(projectStartupTimings(directory()), null)
  assert.equal(projectStartupTimings(directory('{nope')), null)
  assert.equal(projectStartupTimings(directory('{"commands":"x"}')), null)
})

test('a row with an unsafe operation, signal or error code is dropped, not published', () => {
  const dir = directory(
    JSON.stringify({
      commands: [
        {
          operation: '/Users/runner/x',
          durationMs: 1,
          exitCode: 0,
          signal: null,
          errorCode: null,
        },
        {
          operation: 'a-b',
          durationMs: 1,
          exitCode: 0,
          signal: 'not a signal',
          errorCode: null,
        },
        {
          operation: 'c-d',
          durationMs: 1,
          exitCode: 0,
          signal: null,
          errorCode: 'path /tmp',
        },
        { operation: 'ok', durationMs: 5, exitCode: 0, signal: null, errorCode: null },
      ],
    })
  )
  assert.deepEqual(
    projectStartupTimings(dir).commands.map((row) => row.operation),
    ['ok']
  )
})
