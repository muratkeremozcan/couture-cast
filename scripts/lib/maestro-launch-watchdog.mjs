/**
 * Story 6.7b R18: a Maestro `launchApp` that stops making progress fails within
 * {@link LAUNCH_APP_STALL_MS}, named by the step it stopped in and what the
 * device was doing then.
 *
 * Before R18 a stalled launch held its flow until the 360 s flow cap, and the
 * only record was the debug log's last line, "Clearing app state" (CI runs
 * 40048980057, 40067302049, 40081299288, 40100370340). The APK pull those
 * stalls point to is gone (scripts/lib/maestro-android-permissions.mjs). What is
 * left of a launch on Android is a few short adb shell commands (`am force-stop`,
 * `pm clear`, one `pm grant` per permission, `am start`), so a launch that runs
 * this long is stuck, and the runner says where. Across the 456 CI launches in
 * runs 40045496619 to 40145652214 the slowest unstalled one took 5.2 s; locally a
 * clear-state launch took 7 to 62 s with the pull and 1.2 to 1.7 s without it.
 */

export const LAUNCH_APP_STALL_MS = 90_000

const LAUNCH_START = /onCommandStart: (Launch app .*) RUNNING\s*$/
const LAUNCH_END = /onCommand(?:Finished|Failed|Skipped): Launch app /

/**
 * Maestro's own markers inside a `launchApp`, newest first, and the step each
 * one means is running. Maestro logs nothing when it starts stopping the app or
 * granting permissions, and only failed grants are logged, so each step is
 * named by the marker that precedes it.
 */
const LAUNCH_STEPS = [
  [/Launching app /, 'starting the app (am start)'],
  [
    /setPermissionInternal: /,
    'granting permissions (one pm grant per permission, after a logged failed grant)',
  ],
  [
    /Clearing app state /,
    'clearing app state or granting permissions (pm clear, then one pm grant per permission)',
  ],
]
const BEFORE_CLEAR =
  'stopping the app or checking it is installed (am force-stop, pm list packages)'

/** Failed-grant lines carry a whole exception message; the head says enough. */
const clip = (line) => (line.length > 240 ? `${line.slice(0, 240)}...` : line)

/**
 * The `launchApp` still running at the end of Maestro's debug log, with the step
 * it is in, or `undefined` when the newest launch has finished or none started.
 *
 * @param {string} logText
 * @returns {{ line: number, command: string, step: string, lastLine: string } | undefined}
 */
export function openLaunchApp(logText) {
  const lines = logText.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (LAUNCH_END.test(lines[index])) return undefined
    const match = LAUNCH_START.exec(lines[index])
    if (!match) continue
    const after = lines.slice(index + 1).filter((line) => line.trim() !== '')
    let step = BEFORE_CLEAR
    search: for (let at = after.length - 1; at >= 0; at -= 1) {
      for (const [marker, name] of LAUNCH_STEPS) {
        if (marker.test(after[at])) {
          step = name
          break search
        }
      }
    }
    const last =
      after.findLast((line) => /^\d\d:\d\d:\d\d\.\d{3} /.test(line)) ?? lines[index]
    return { line: index, command: match[1], step, lastLine: clip(last.trim()) }
  }
  return undefined
}

/**
 * Watches successive reads of one attempt's debug log and reports a `launchApp`
 * that has stayed open for `boundMs`, timed from the first read that saw it.
 *
 * @param {{ boundMs?: number, now?: () => number }} [options]
 */
export function createLaunchStallDetector({
  boundMs = LAUNCH_APP_STALL_MS,
  now = Date.now,
} = {}) {
  /** @type {{ key: string, sinceMs: number } | undefined} */
  let current
  return {
    /**
     * @param {string} logText
     * @returns {(NonNullable<ReturnType<typeof openLaunchApp>> & { elapsedMs: number }) | undefined}
     */
    observe(logText) {
      const open = openLaunchApp(logText)
      if (!open) {
        current = undefined
        return undefined
      }
      const key = `${open.line}:${open.command}`
      if (current?.key !== key) current = { key, sinceMs: now() }
      const elapsedMs = now() - current.sinceMs
      return elapsedMs >= boundMs ? { ...open, elapsedMs } : undefined
    },
  }
}

/**
 * The error a launch-stall kill fails its flow with. It carries no `timedOut`,
 * so `runMobileE2EFlow` does not retry it: the message already names the stalled
 * step and the device state, and a rerun would hide a stall that should be fixed.
 * Flows killed at the 360 s flow cap keep their single retry.
 *
 * @param {string} message from {@link describeLaunchStall}
 * @returns {Error & { stalled: true }}
 */
export function launchStallError(message) {
  return Object.assign(new Error(message), { stalled: /** @type {const} */ (true) })
}

const DEVICE_COMMAND = /(?:^|[\s/])(?:pm|am)\s+\S|\bcmd\s+(?:package|activity)\b/

/**
 * The package and activity manager commands running on the device, from
 * `ps -A -o PID,S,ARGS` (the header line is skipped).
 *
 * @param {string} psOutput
 * @returns {string[]}
 */
export function deviceCommandsInFlight(psOutput) {
  return psOutput
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => DEVICE_COMMAND.test(line))
}

/**
 * The failure for a stalled launch: the command, how long, the step, Maestro's
 * last log line, and what the device was running. With no package or activity
 * manager command left on the device, the device has answered and Maestro is
 * waiting on its own side of adb.
 *
 * @param {{ command: string, step: string, lastLine: string, elapsedMs: number }} stall
 * @param {{ device: string, commands?: string[], captureError?: string }} evidence
 * @returns {string}
 */
export function describeLaunchStall(stall, { device, commands, captureError }) {
  const seconds = Math.round(stall.elapsedMs / 1000)
  let onDevice
  if (captureError) onDevice = `the process list could not be read (${captureError})`
  else if (commands && commands.length > 0)
    onDevice = `still running: ${commands.join('; ')}`
  else {
    onDevice =
      'no package or activity manager command is running, so Maestro is waiting on its adb connection'
  }
  return (
    `Maestro's "${stall.command}" stalled for ${seconds} s while ${stall.step}; ` +
    `last Maestro log line: ${stall.lastLine}; on ${device} ${onDevice}`
  )
}
