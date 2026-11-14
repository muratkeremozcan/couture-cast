// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { killOwned, killOwnedGroup } from './owned-process.mjs'

const exited = (child) =>
  new Promise((resolve) => child.once('exit', (code, name) => resolve(name)))

test('a live process running the expected command is signalled', async () => {
  const child = spawn('/bin/sleep', ['31'], { stdio: 'ignore' })
  const done = exited(child)
  assert.equal(killOwned(child.pid, '/bin/sleep 31'), true)
  assert.equal(await done, 'SIGKILL')
})

test('a pid running anything else, or a pid that is gone, is left alone', async (t) => {
  const child = spawn('/bin/sleep', ['32'], { stdio: 'ignore' })
  t.after(() => child.kill('SIGKILL'))
  // The pid now belongs to a process the test did not expect (a recycled pid).
  assert.equal(killOwned(child.pid, '/bin/sleep 99'), false)
  assert.equal(child.exitCode, null)
  assert.equal(child.signalCode, null)
  const done = exited(child)
  child.kill('SIGKILL')
  await done
  assert.equal(killOwned(child.pid, '/bin/sleep 32'), false)
  assert.equal(killOwned(undefined, 'x'), false)
  assert.equal(killOwned(child.pid, ''), false)
})

test('a group is signalled member by member, only the expected ones', () => {
  const sent = []
  const table = () => [
    { pid: 10, pgid: 10, command: 'sh -c x' },
    { pid: 11, pgid: 10, command: '/bin/sleep 30' },
    { pid: 12, pgid: 12, command: '/bin/sleep 30' },
  ]
  const original = process.kill
  process.kill = (pid, name) => sent.push([pid, name])
  try {
    assert.equal(killOwnedGroup(10, '/bin/sleep 30', 'SIGKILL', table), 1)
  } finally {
    process.kill = original
  }
  assert.deepEqual(sent, [[11, 'SIGKILL']])
})
