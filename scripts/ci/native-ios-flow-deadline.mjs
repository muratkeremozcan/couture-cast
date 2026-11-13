#!/usr/bin/env node
/** A separate event loop owns the deadline and the Maestro process group. */
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Synchronous harness adapter. Credentials travel through a private stdin pipe. */
export function spawnIosFlow(binary, args, options, timingFile) {
  const began = performance.now()
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), 'worker', timingFile],
    {
      cwd: options.cwd,
      input: JSON.stringify({
        binary,
        args,
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeout,
      }),
      encoding: 'utf8',
      maxBuffer: options.maxBuffer,
    }
  )
  const wrapperMs = Math.round(performance.now() - began)
  const child = fs.existsSync(timingFile)
    ? JSON.parse(fs.readFileSync(timingFile, 'utf8'))
    : null
  if (!child) {
    // Story 6.15: say how the worker ended, so a missing record names its cause.
    console.error(String(result.stderr ?? '').slice(-2000))
    throw new Error(
      `ios_flow_deadline_record_missing:status=${result.status}:signal=${result.signal}:error=${result.error?.code ?? null}`
    )
  }
  return {
    ...result,
    deadline: {
      ...child,
      wrapperMs,
      workerOverheadMs: Math.max(0, wrapperMs - child.childMs),
    },
  }
}

/**
 * Writes the flow's timing record and logs it. The log line also names the flow, so the shard
 * plan can be rebalanced from the job log by measured flow durations; the file keeps its shape.
 */
export function recordIosFlowTiming(timingFile, result, harnessMs, flow) {
  if (!result.deadline) return
  const timing = {
    ...result.deadline,
    setupMs: Math.max(0, harnessMs - result.deadline.wrapperMs),
    harnessMs,
  }
  fs.writeFileSync(timingFile, JSON.stringify(timing) + '\n', { mode: 0o600 })
  console.log(
    JSON.stringify({ iosFlowDeadline: flow === undefined ? timing : { flow, ...timing } })
  )
}

export async function runDeadlineWorker(request, timingFile) {
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)
    throw new Error('flow_deadline_required')
  const began = performance.now()
  let timedOut = false
  let killAfterMs = null
  const child = spawn(request.binary, request.args, {
    cwd: request.cwd,
    env: request.env,
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const write = () =>
    fs.writeFileSync(
      timingFile,
      JSON.stringify({
        timeoutMs: request.timeoutMs,
        childMs: Math.round(performance.now() - began),
        timedOut,
        killAfterMs,
      }) + '\n',
      { mode: 0o600 }
    )
  // Story 6.15: the worker never dies without its record or leaves the owned group running. A kill
  // that fails is reported and retried on the child alone, never thrown from the timer; a SIGTERM
  // from the parent (spawnSync past maxBuffer) or an uncaught error still kills the group and writes.
  const killOwned = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code === 'ESRCH') return
      console.error(`owned_flow_group_kill_failed:${error.code ?? 'unknown'}`)
      try {
        child.kill('SIGKILL')
      } catch {
        // The record below still names the deadline.
      }
    }
  }
  let written = false
  const writeOnce = () => {
    if (written) return
    written = true
    write()
  }
  const abort = (code) => {
    killOwned()
    writeOnce()
    process.exit(code)
  }
  process.once('SIGTERM', () => abort(143))
  process.once('uncaughtException', (error) => {
    console.error(
      `owned_flow_worker_failed:${error?.code ?? error?.message ?? 'unknown'}`
    )
    abort(1)
  })
  const timer = setTimeout(
    () => {
      timedOut = true
      killAfterMs = Math.round(performance.now() - began)
      killOwned()
      console.error('Timed out at the native flow deadline')
    },
    Math.max(0, request.timeoutMs - (performance.now() - began))
  )
  try {
    const code = await new Promise((resolve) => {
      child.once('error', () => {
        console.error('owned_flow_launch_failed')
        resolve(127)
      })
      child.once('close', (exitCode, signal) =>
        resolve(timedOut ? 124 : (exitCode ?? (signal ? 1 : 0)))
      )
    })
    writeOnce()
    return code
  } finally {
    clearTimeout(timer)
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === 'worker'
) {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'))
  process.exitCode = await runDeadlineWorker(request, process.argv[3])
}
