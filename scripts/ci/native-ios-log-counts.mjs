/** Count historical log emitters after the gate; message bodies never leave memory. */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

const label = (value) =>
  typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._+-]/g, '_').slice(0, 160)
    : 'unknown'
export function logCounter() {
  const processes = new Map(),
    subsystems = new Map(),
    pairs = new Map()
  let entries = 0,
    invalidLines = 0
  return {
    line: (line) => {
      if (!line.trim()) return
      let row
      try {
        row = JSON.parse(line)
      } catch {
        invalidLines++
        return
      }
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        invalidLines++
        return
      }
      const processName = label(
        path.basename(
          typeof row.processImagePath === 'string'
            ? row.processImagePath
            : typeof row.process === 'string'
              ? row.process
              : 'unknown'
        )
      )
      const subsystem = label(row.subsystem)
      entries++
      processes.set(processName, (processes.get(processName) ?? 0) + 1)
      subsystems.set(subsystem, (subsystems.get(subsystem) ?? 0) + 1)
      const key = processName + '\0' + subsystem
      const pair = pairs.get(key) ?? { process: processName, subsystem, count: 0 }
      pair.count++
      pairs.set(key, pair)
    },
    result: () => ({
      entries,
      invalidLines,
      processes: [...processes]
        .map(([process, count]) => ({ process, count }))
        .sort((a, b) => b.count - a.count),
      subsystems: [...subsystems]
        .map(([subsystem, count]) => ({ subsystem, count }))
        .sort((a, b) => b.count - a.count),
      pairs: [...pairs.values()].sort((a, b) => b.count - a.count),
    }),
  }
}

export async function collectSimulatorLogCounts(
  device,
  directory,
  {
    binary = 'xcrun',
    args = [
      'simctl',
      'spawn',
      device,
      'log',
      'show',
      '--last',
      '2m',
      '--style',
      'ndjson',
      '--info',
      '--debug',
    ],
    timeoutMs = 30000,
    maxBytes = 64 * 1024 * 1024,
    killGraceMs = 2000,
    signalProcess = process.kill,
    gateOutcome = null,
  } = {}
) {
  const began = performance.now()
  const startedAt = new Date().toISOString()
  const counter = logCounter(),
    decoder = new StringDecoder('utf8')
  const events = [],
    killAttempts = []
  const mark = (event) =>
    events.push({ event, atMs: Math.round(performance.now() - began) })
  let pending = '',
    stderr = '',
    bytes = 0,
    countedBytes = 0,
    stopped = false,
    timedOut = false,
    outputCapped = false,
    launchError = null,
    settledBy = null
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  // The group kill can be refused (EPERM was observed on hosted macOS), so the direct
  // child is always signalled too; both outcomes are recorded and neither is fatal.
  const kill = () => {
    if (!child.pid) return
    for (const [target, signalTarget] of [
      ['group', -child.pid],
      ['child', child.pid],
    ]) {
      try {
        signalProcess(signalTarget, 'SIGKILL')
        killAttempts.push({ target, atMs: Math.round(performance.now() - began) })
      } catch (error) {
        killAttempts.push({
          target,
          atMs: Math.round(performance.now() - began),
          errorCode: error.code ?? null,
        })
      }
    }
  }
  // Nothing after the first bound violation is counted; late data is only measured.
  const stop = (event) => {
    if (stopped) return
    stopped = true
    mark(event)
    kill()
    pending = ''
  }
  let finish
  const settled = new Promise((resolve) => {
    finish = (by, exitCode, signal) => {
      if (settledBy) return
      settledBy = by
      mark('settled:' + by)
      resolve({ exitCode, signal })
    }
  })
  let graceTimer = null
  const timer = setTimeout(() => {
    timedOut = true
    stop('deadline')
    // A killed grandchild can keep the pipes open, so settling never waits on 'close'.
    graceTimer = setTimeout(() => {
      child.stdout.destroy()
      child.stderr.destroy()
      finish('grace_deadline', null, null)
    }, killGraceMs)
  }, timeoutMs)
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length
    if (stopped) return
    if (bytes > maxBytes) {
      outputCapped = true
      stop('output_cap')
      return
    }
    countedBytes += chunk.length
    pending += decoder.write(chunk)
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      counter.line(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
    }
    if (pending.length > 1024 * 1024) {
      outputCapped = true
      stop('line_cap')
    }
  })
  child.stdout.on('close', () => mark('stdout_closed'))
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(0, 65536)
  })
  child.once('error', (error) => {
    launchError = error
    mark('error')
  })
  child.once('exit', (exitCode, signal) => {
    mark('exit')
    // After a bound violation the child's exit settles the query; pipes are cut at once.
    if (stopped) {
      child.stdout.destroy()
      child.stderr.destroy()
      finish('exit_after_stop', exitCode, signal)
    }
  })
  child.once('close', (exitCode, signal) => finish('close', exitCode, signal))
  const result = await settled
  clearTimeout(timer)
  clearTimeout(graceTimer)
  if (!stopped) counter.line(pending + decoder.end())
  const record = {
    version: 1,
    device,
    gateOutcome,
    startedAt,
    completedAt: new Date().toISOString(),
    windowSeconds: 120,
    timeoutMs,
    durationMs: Math.round(performance.now() - began),
    ...result,
    timedOut,
    outputCapped,
    bytes,
    countedBytes,
    settledBy,
    boundHeld: Math.round(performance.now() - began) <= timeoutMs + killGraceMs + 500,
    killAttempts,
    events,
    errorCode: launchError?.code ?? null,
    errorMessage: launchError?.message ?? null,
    stderr,
    ...counter.result(),
  }
  try {
    fs.writeFileSync(
      path.join(directory, 'native-ios-log-counts.json'),
      JSON.stringify(record, null, 2) + '\n',
      { mode: 0o600 }
    )
  } catch (error) {
    console.log(
      JSON.stringify({
        logCountWriteFailure: {
          errorCode: error.code ?? null,
          errorMessage: error.message,
        },
      })
    )
  }
  console.log(
    JSON.stringify({
      simulatorLogCounts: {
        entries: record.entries,
        durationMs: record.durationMs,
        exitCode: record.exitCode,
        timedOut,
        outputCapped,
        settledBy,
        boundHeld: record.boundHeld,
      },
    })
  )
  return record
}
