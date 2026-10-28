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
    gateOutcome = null,
  } = {}
) {
  const began = performance.now()
  const startedAt = new Date().toISOString()
  const counter = logCounter(),
    decoder = new StringDecoder('utf8')
  let pending = '',
    stderr = '',
    bytes = 0,
    timedOut = false,
    outputCapped = false,
    launchError = null
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const kill = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') launchError ??= error
    }
  }
  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeoutMs)
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes > maxBytes) {
      outputCapped = true
      kill()
      return
    }
    pending += decoder.write(chunk)
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      counter.line(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
    }
    if (pending.length > 1024 * 1024) {
      outputCapped = true
      kill()
      pending = ''
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(0, 65536)
  })
  const result = await new Promise((resolve) => {
    child.once('error', (error) => {
      launchError = error
    })
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  clearTimeout(timer)
  if (!outputCapped) counter.line(pending + decoder.end())
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
      },
    })
  )
  return record
}
