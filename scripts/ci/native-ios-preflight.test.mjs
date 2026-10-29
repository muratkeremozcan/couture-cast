import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { simulatorCommandRecorder } from './native-ios-command-evidence.mjs'
import {
  preflightProcesses,
  preflightObserver,
  observedRuntimeQuery,
  RUNTIME_QUERY_CAP_MS,
} from './native-ios-preflight.mjs'

const temporary = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-preflight-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('preflight records CoreSimulator and image-mounter state, mounts, load and client chains without raw arguments', (t) => {
  const directory = temporary(t)
  const usage =
    '10 1 S 12.5 200 /core/com.apple.CoreSimulator.CoreSimulatorService\n11 10 R+ 3.5 100 /usr/libexec/simdiskimaged\n12 10 S 1 50 /usr/bin/log'
  assert.equal(preflightProcesses(usage)[1].state, 'R+')
  const observe = preflightObserver(directory, {
    execute: (binary, args) => ({
      status: 0,
      stdout:
        binary === '/sbin/mount'
          ? '/dev/disk2 on /Library/Developer/CoreSimulator/Volumes/iOS_22F77 (apfs)\n/dev/disk1 on / (apfs)'
          : args.at(-1).includes('stat=')
            ? usage
            : '10 1 CoreSimulatorService --token private\n11 10 simdiskimaged\n12 10 log stream --predicate private',
    }),
    crashScan: () => ({ sources: [], reports: [], counts: [] }),
  })
  observe('before-query')
  observe('during-query')
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-preflight.json'), 'utf8')
  )
  assert.equal(record.timeoutMs, 300000)
  assert.equal(record.snapshots.length, 2)
  assert.equal(record.snapshots[0].processes[0].cpuPercent, 12.5)
  assert.equal(record.snapshots[0].processes[1].rssKB, 100)
  assert.equal(record.snapshots[0].runtimeMounts.length, 1)
  assert.equal(
    record.snapshots[0].collectors.find((r) => r.pid === 12).parents[0].pid,
    10
  )
  assert.equal(record.snapshots[0].load.length, 3)
  assert.doesNotMatch(JSON.stringify(record), /private|token|predicate/)
})

test('a live first query publishes its timing and observations before, during and after completion', async (t) => {
  const directory = temporary(t)
  const phases = []
  const command = simulatorCommandRecorder(directory)
  const result = await observedRuntimeQuery({
    directory,
    command,
    observe: (phase) => phases.push(phase),
    binary: process.execPath,
    args: ['-e', 'setTimeout(()=>console.log(JSON.stringify({runtimes:[]})),200)'],
    timeoutMs: 2000,
    pollMs: 25,
  })
  assert.equal(result.exitCode, 0)
  assert.deepEqual(JSON.parse(result.stdout), { runtimes: [] })
  assert.equal(phases[0], 'before-query')
  assert.ok(phases.includes('during-query'))
  assert.equal(phases.at(-1), 'after-query')
  const timing = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-runtime-deadline.json'), 'utf8')
  )
  assert.equal(timing.timedOut, false)
  assert.equal(RUNTIME_QUERY_CAP_MS, 300000)
})

test('a hung first query is fatal at its independently enforced cap and preserves exact timeout evidence', async (t) => {
  const directory = temporary(t)
  const command = simulatorCommandRecorder(directory)
  await assert.rejects(
    observedRuntimeQuery({
      directory,
      command,
      observe: () => undefined,
      binary: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      timeoutMs: 200,
      pollMs: 25,
    }),
    /list-runtimes:ETIMEDOUT/
  )
  const timing = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-runtime-deadline.json'), 'utf8')
  )
  assert.equal(timing.timeoutMs, 200)
  assert.equal(timing.timedOut, true)
  assert.ok(timing.killAfterMs >= 190 && timing.killAfterMs < 1000)
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-ios-startup-private.json'), 'utf8')
  ).commands[0]
  assert.equal(record.errorCode, 'ETIMEDOUT')
  assert.equal(record.signal, 'SIGKILL')
  assert.equal(record.exitCode, 124)
})

test('failed preflight snapshots preserve query success and permit the next stage', async (t) => {
  const directory = temporary(t)
  const command = simulatorCommandRecorder(directory)
  let failures = 0
  const result = await observedRuntimeQuery({
    directory,
    command,
    observe: () => {
      failures++
      throw Object.assign(new Error('snapshot refused'), {
        code: 'EACCES',
        stderr: 'exact snapshot stderr',
      })
    },
    binary: process.execPath,
    args: ['-e', 'setTimeout(()=>console.log("query-complete"),100)'],
    timeoutMs: 2000,
    pollMs: 25,
  })
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /query-complete/)
  assert.ok(failures >= 2)
})
