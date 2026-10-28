import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { spawnIosFlow } from './native-ios-flow-deadline.mjs'

const delayedTermination =
  "process.on('SIGTERM',()=>setTimeout(()=>process.exit(143),300));setInterval(()=>{},1000)"

test('the previous sync SIGTERM timeout waits for child termination after its deadline', () => {
  const began = performance.now()
  const r = spawnSync(process.execPath, ['-e', delayedTermination], {
    timeout: 500,
    killSignal: 'SIGTERM',
    encoding: 'utf8',
  })
  assert.equal(r.error?.code, 'ETIMEDOUT')
  assert.equal(r.status, 143)
  assert.ok(
    performance.now() - began >= 780,
    'SIGTERM cleanup extends the configured deadline'
  )
})

test('the independent deadline kills only its owned command group without waiting for SIGTERM cleanup', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-deadline-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = spawnIosFlow(
    process.execPath,
    ['-e', delayedTermination],
    { cwd: process.cwd(), env: process.env, timeout: 500, maxBuffer: 1024 * 1024 },
    path.join(dir, 'timing.json')
  )
  assert.equal(result.status, 124)
  assert.equal(result.deadline.timedOut, true)
  assert.equal(result.deadline.timeoutMs, 500)
  assert.ok(result.deadline.killAfterMs >= 490)
  assert.ok(result.deadline.killAfterMs < 700)
  assert.ok(result.deadline.childMs < 750, 'the old 300ms cleanup is bypassed')
})

test('an ordinary command keeps its exit status and records bootstrap separately', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-success-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = spawnIosFlow(
    process.execPath,
    ['-e', "console.log('closed-marker');process.exitCode=7"],
    { cwd: process.cwd(), env: process.env, timeout: 2000, maxBuffer: 1024 * 1024 },
    path.join(dir, 'timing.json')
  )
  assert.equal(result.status, 7)
  assert.match(result.stdout, /closed-marker/)
  assert.equal(result.deadline.timedOut, false)
  assert.equal(result.deadline.killAfterMs, null)
  assert.ok(result.deadline.workerOverheadMs >= 0)
})

test('a failed child launch retains a closed error and timing record', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-flow-missing-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const result = spawnIosFlow(
    '/missing/cc68-command',
    [],
    { cwd: process.cwd(), env: process.env, timeout: 500, maxBuffer: 1024 * 1024 },
    path.join(dir, 'timing.json')
  )
  assert.equal(result.status, 127)
  assert.match(result.stderr, /owned_flow_launch_failed/)
  assert.equal(result.deadline.timedOut, false)
})
