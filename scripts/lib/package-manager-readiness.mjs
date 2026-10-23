/**
 * Waits until the Android package manager answers `pm clear` for Expo Go
 * promptly, before the first flow runs.
 *
 * Story 1.2b R28: in CI job 120347100806 the shard's first flow sat in
 * Maestro's `pm clear host.exp.exponent` for both attempts (12 minutes), and
 * the next flow's identical clear finished in 1.6 s. The stall hit the first
 * clear after Expo Go was installed on a freshly restored emulator, so the
 * working hypothesis, unproven, is a package manager that is not ready yet.
 * Probing first means a flow only starts once a clear completes quickly, and a
 * slow probe captures the device state at that moment, so a recurrence names
 * the blocker.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const PROBE_TIMEOUT_MS = 20_000
export const READINESS_TIMEOUT_MS = 15 * 60_000

/**
 * @typedef {{ completed: boolean, code: number | null, output: string }} ProbeResult
 */

/**
 * Probes until one completes within `probeTimeoutMs`, logging each duration.
 * A probe that runs out its bound is killed, reported to `onSlowProbe`, and
 * followed by another until `overallTimeoutMs` has passed, which throws.
 *
 * @param {{
 *   runProbe: (signal: AbortSignal) => Promise<{ code: number | null, output: string }>,
 *   onSlowProbe: (attempt: number) => Promise<void> | void,
 *   log: (message: string) => void,
 *   probeTimeoutMs?: number,
 *   overallTimeoutMs?: number,
 *   now?: () => number,
 * }} options
 * @returns {Promise<{ attempts: number, durationsMs: number[] }>}
 */
export async function waitForPackageManagerReady({
  runProbe,
  onSlowProbe,
  log,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  overallTimeoutMs = READINESS_TIMEOUT_MS,
  now = Date.now,
}) {
  const startedAt = now()
  const durationsMs = []
  for (let attempt = 1; ; attempt += 1) {
    const probeStartedAt = now()
    const result = await boundedProbe(runProbe, probeTimeoutMs)
    const elapsed = now() - probeStartedAt
    durationsMs.push(elapsed)
    if (result.completed) {
      log(
        `Package manager ready: pm clear probe ${attempt} completed in ${elapsed} ms ` +
          `(exit ${result.code}${result.output.trim() ? `, ${result.output.trim()}` : ''})`
      )
      return { attempts: attempt, durationsMs }
    }
    log(
      `Package manager not ready: pm clear probe ${attempt} did not complete within ` +
        `${probeTimeoutMs} ms`
    )
    await onSlowProbe(attempt)
    if (now() - startedAt >= overallTimeoutMs) {
      throw new Error(
        `The package manager never answered pm clear within ${probeTimeoutMs} ms in ` +
          `${overallTimeoutMs} ms (probe durations: ${durationsMs.join(', ')} ms)`
      )
    }
  }
}

/**
 * @param {(signal: AbortSignal) => Promise<{ code: number | null, output: string }>} runProbe
 * @param {number} timeoutMs
 * @returns {Promise<ProbeResult>}
 */
async function boundedProbe(runProbe, timeoutMs) {
  const controller = new AbortController()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      // Settle first: aborting makes the killed probe resolve too.
      resolve(undefined)
      controller.abort()
    }, timeoutMs)
  })
  const result = await Promise.race([runProbe(controller.signal), timedOut])
  clearTimeout(timer)
  return result
    ? { completed: true, code: result.code, output: result.output }
    : { completed: false, code: null, output: '' }
}

/**
 * Runs an adb command, killing it when `signal` aborts.
 *
 * @param {string} adbBinary
 * @param {string[]} args
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ code: number | null, output: string }>}
 */
export const runAdb = (adbBinary, args, signal) =>
  new Promise((resolve) => {
    const child = spawn(adbBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => resolve({ code: null, output: String(error) }))
    child.on('close', (code) => resolve({ code, output }))
  })

/** What a slow probe captures, each bounded so a wedged device cannot hang it. */
export const SLOW_PROBE_CAPTURES = [
  ['logcat', ['logcat', '-d', '-t', '4000']],
  ['processes', ['shell', 'ps', '-A', '-o', 'PID,PPID,S,TIME,ARGS']],
  ['package', ['shell', 'dumpsys', 'package']],
  ['activity-processes', ['shell', 'dumpsys', 'activity', 'processes']],
]

/**
 * Saves the device state for a slow probe under `artifactDir`.
 *
 * @param {{
 *   adbBinary: string,
 *   serial: string,
 *   artifactDir: string,
 *   attempt: number,
 *   log: (message: string) => void,
 *   timeoutMs?: number,
 *   run?: typeof runAdb,
 * }} options
 * @returns {Promise<void>}
 */
export async function captureSlowProbeState({
  adbBinary,
  serial,
  artifactDir,
  attempt,
  log,
  timeoutMs = 30_000,
  run = runAdb,
}) {
  fs.mkdirSync(artifactDir, { recursive: true })
  for (const [name, args] of SLOW_PROBE_CAPTURES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const result = await run(adbBinary, ['-s', serial, ...args], controller.signal)
    clearTimeout(timer)
    const file = path.join(
      artifactDir,
      `pm-readiness-${serial}-probe-${attempt}-${name}.txt`
    )
    fs.writeFileSync(file, result.output)
    log(`Saved ${name} for slow pm clear probe ${attempt} on ${serial} to ${file}`)
  }
}
