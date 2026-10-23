/**
 * Waits until the Android package manager answers `pm clear` for Expo Go
 * successfully, before the first flow runs.
 *
 * Story 1.2b R28: in CI job 120347100806 the shard's first flow sat in
 * Maestro's `pm clear host.exp.exponent` for both attempts (12 minutes), and
 * the next flow's identical clear finished in 1.6 s. The stall hit the first
 * clear after Expo Go was installed on a freshly restored emulator, so the
 * working hypothesis, unproven, is a package manager that is not ready yet.
 * Probing first means a flow only starts once a clear succeeds, and an unready
 * probe captures the device state at that moment, so a recurrence names the
 * blocker.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const PROBE_TIMEOUT_MS = 20_000
export const READINESS_TIMEOUT_MS = 15 * 60_000
/** Pause between probes, so a probe that fails at once does not spin. */
export const PROBE_RETRY_DELAY_MS = 2_000

/**
 * @typedef {{ completed: boolean, code: number | null, output: string }} ProbeResult
 */

/**
 * Probes until one succeeds, logging each. Success means `pm clear` exited 0
 * and printed `Success` within `probeTimeoutMs` (Story 1.2b R29). Anything else
 * (a probe killed at its bound, a non-zero exit, `Can't find service: package`,
 * `device offline`, an adb that would not start) is reported to
 * `onUnreadyProbe` and retried after `retryDelayMs`, until `overallTimeoutMs`
 * has passed, which throws with every probe's outcome.
 *
 * @param {{
 *   runProbe: (signal: AbortSignal) => Promise<{ code: number | null, output: string }>,
 *   onUnreadyProbe: (attempt: number) => Promise<void> | void,
 *   log: (message: string) => void,
 *   probeTimeoutMs?: number,
 *   overallTimeoutMs?: number,
 *   retryDelayMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<{ attempts: number, durationsMs: number[] }>}
 */
export async function waitForPackageManagerReady({
  runProbe,
  onUnreadyProbe,
  log,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  overallTimeoutMs = READINESS_TIMEOUT_MS,
  retryDelayMs = PROBE_RETRY_DELAY_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = now()
  const durationsMs = []
  const outcomes = []
  for (let attempt = 1; ; attempt += 1) {
    const probeStartedAt = now()
    const result = await boundedProbe(runProbe, probeTimeoutMs)
    const elapsed = now() - probeStartedAt
    durationsMs.push(elapsed)
    const output = result.output.trim()
    if (result.completed && result.code === 0 && /^Success$/m.test(output)) {
      log(`Package manager ready: pm clear probe ${attempt} succeeded in ${elapsed} ms`)
      return { attempts: attempt, durationsMs }
    }
    const outcome = result.completed
      ? `exited ${result.code} in ${elapsed} ms${output ? `: ${output}` : ''}`
      : `did not complete within ${probeTimeoutMs} ms`
    outcomes.push(`probe ${attempt} ${outcome}`)
    log(`Package manager not ready: pm clear probe ${attempt} ${outcome}`)
    await onUnreadyProbe(attempt)
    if (now() - startedAt >= overallTimeoutMs) {
      throw new Error(
        `The package manager never answered pm clear with Success in ${overallTimeoutMs} ms ` +
          `(${outcomes.join('; ')})`
      )
    }
    await sleep(retryDelayMs)
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
 * The serials the readiness probe must cover: the run's own intended devices,
 * or the one device adb reports when the run names none. Throws, naming each
 * device and its state, when an intended device is missing or not in the
 * `device` state, so no device the run will drive goes unprobed (R29).
 *
 * @param {string[]} intendedSerials
 * @param {Map<string, string>} adbStates serial to adb state (`device`, `offline`, ...)
 * @returns {string[]}
 */
export function resolveProbeSerials(intendedSerials, adbStates) {
  const describe = (entries) =>
    entries.map(([serial, state]) => `${serial} ${state}`).join(', ') || 'none'
  if (intendedSerials.length === 0) {
    const ready = [...adbStates].filter(([, state]) => state === 'device')
    if (ready.length !== 1) {
      throw new Error(
        `The run names no Android device and adb reports ${ready.length} ready ` +
          `(${describe([...adbStates])})`
      )
    }
    return [ready[0][0]]
  }
  const unready = intendedSerials
    .map((serial) => [serial, adbStates.get(serial) ?? 'missing'])
    .filter(([, state]) => state !== 'device')
  if (unready.length > 0) {
    throw new Error(
      `Android device not ready for the package manager probe: ${describe(unready)}`
    )
  }
  return intendedSerials
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

/**
 * Every device adb reports, with its state.
 *
 * @param {string} adbBinary
 * @param {typeof runAdb} [run]
 * @returns {Promise<Map<string, string>>}
 */
export async function adbDeviceStates(adbBinary, run = runAdb) {
  const { output } = await run(adbBinary, ['devices'])
  return new Map(
    output
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state)
      .map(([serial, state]) => [serial, state])
  )
}

/** What an unready probe captures, each bounded so a wedged device cannot hang it. */
export const SLOW_PROBE_CAPTURES = [
  ['logcat', ['logcat', '-d', '-t', '4000']],
  ['processes', ['shell', 'ps', '-A', '-o', 'PID,PPID,S,TIME,ARGS']],
  ['package', ['shell', 'dumpsys', 'package']],
  ['activity-processes', ['shell', 'dumpsys', 'activity', 'processes']],
]

/**
 * Saves the device state for an unready probe under `artifactDir`. A write
 * error is logged and skipped: diagnostics never change the probe's outcome.
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
  for (const [name, args] of SLOW_PROBE_CAPTURES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const result = await run(adbBinary, ['-s', serial, ...args], controller.signal)
    clearTimeout(timer)
    saveDiagnostic(
      path.join(artifactDir, `pm-readiness-${serial}-probe-${attempt}-${name}.txt`),
      result.output,
      log,
      `${name} for pm clear probe ${attempt} on ${serial}`
    )
  }
}

/**
 * Writes one diagnostic file, creating its directory. A filesystem error
 * (ENOSPC, EACCES) is logged and swallowed: a capture must never replace the
 * outcome it documents or stop the run that produced it (Story 1.2b R29).
 *
 * @param {string} file
 * @param {string} content
 * @param {(message: string) => void} log
 * @param {string} label
 * @returns {boolean} whether the file was written
 */
export function saveDiagnostic(file, content, log, label) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    log(`Saved ${label} to ${file}`)
    return true
  } catch (error) {
    log(
      `Could not save ${label} to ${file}: ` +
        (error instanceof Error ? error.message : String(error))
    )
    return false
  }
}
