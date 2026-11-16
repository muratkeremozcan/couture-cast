/**
 * What scripts/run-maestro.mjs saves beside a failed Android flow.
 *
 * CI run 43919975098 (mobile-e2e-android shard 1): garment-capture-flow failed on
 * `app-root-mounted` three times with only Expo Go's system splash on screen and no Expo Go
 * process. The log it saved was the last 4000 lines, about 36 s of UiAutomator noise, so it
 * could not say whether Expo Go died, whether it ever asked Metro for the bundle, or when. The
 * runner now grows every log buffer at setup (ANDROID_LOG_BUFFER), saves the log from the
 * flow's start, the Expo Go process id, and Metro's own output over the flow (createLineLog).
 */
import { EXPO_GO_PACKAGE } from './expo-go-link-endpoint.mjs'

/**
 * Grows every device log buffer at setup, so the log since a flow started is still on the
 * device when the flow fails: the default main buffer held about 36 s of a CI run.
 */
export const ANDROID_LOG_BUFFER = ['logcat', '-b', 'all', '-G', '16M']

/**
 * The logcat arguments that dump every buffer from `sinceMs` (host epoch milliseconds; the
 * emulator's clock is the host's).
 *
 * @param {number} sinceMs
 * @returns {string[]}
 */
export function logcatSinceArgs(sinceMs) {
  return [
    'logcat',
    '-d',
    '-b',
    'all',
    '-v',
    'threadtime',
    '-T',
    (sinceMs / 1000).toFixed(3),
  ]
}

/**
 * `adb shell pidof host.exp.exponent` as text: the pid, or that there is none. pidof exits 1
 * with no output when nothing matches, which answers the question; anything else (no device,
 * an adb error) is a failed capture: null.
 *
 * @param {{ status: number | null, stdout?: string, stderr?: string }} result
 * @returns {string | null}
 */
export function describeExpoGoPid(result) {
  const pid = (result.stdout ?? '').trim()
  if (result.status === 0 && pid) return `${EXPO_GO_PACKAGE} pid ${pid}\n`
  if (result.status === 1 && !pid && !(result.stderr ?? '').trim())
    return `${EXPO_GO_PACKAGE}: no process\n`
  return null
}

/** A capture's own stdout, or null for a failed or empty answer. */
const stdoutOf = (result) => (result.status === 0 && result.stdout ? result.stdout : null)

/**
 * The adb captures for a failed flow: each `args` runs as `adb <args>`, and `describe` turns
 * its result into the file's text, or null when the capture failed.
 *
 * @param {number | undefined} startedAtMs when the flow's first attempt began
 * @returns {{ suffix: string, args: string[], label: string, describe: (result: { status: number | null, stdout?: string, stderr?: string }) => string | null }[]}
 */
export function androidFailureCaptures(startedAtMs) {
  const since = Number.isFinite(startedAtMs)
  return [
    {
      suffix: 'windows',
      args: ['shell', 'dumpsys', 'window', 'windows'],
      label: 'window stack',
      describe: stdoutOf,
    },
    {
      suffix: 'logcat',
      args: since ? logcatSinceArgs(startedAtMs) : ['logcat', '-d', '-t', '4000'],
      label: since ? 'device log since the flow started' : 'device log tail',
      describe: stdoutOf,
    },
    {
      suffix: 'processes',
      args: ['shell', 'ps', '-A', '-o', 'PID,PPID,S,TIME,ARGS'],
      label: 'process list',
      describe: stdoutOf,
    },
    {
      suffix: 'expo-go-pid',
      args: ['shell', 'pidof', EXPO_GO_PACKAGE],
      label: 'Expo Go process id',
      describe: describeExpoGoPid,
    },
  ]
}

/**
 * A rolling record of a child's output by line, each stamped with the time it arrived, so the
 * runner can save what Metro printed over a failed flow (its "Android Bundled" lines are the
 * bundle requests). A partial line waits for its end; the oldest lines go past `maxLines`.
 *
 * @param {{ now?: () => number, maxLines?: number }} [options]
 * @returns {{ write: (chunk: string | Buffer) => void, since: (ms: number) => string }}
 */
export function createLineLog({ now = Date.now, maxLines = 20_000 } = {}) {
  /** @type {{ at: number, text: string }[]} */
  const lines = []
  let pending = ''
  return {
    write(chunk) {
      const parts = (pending + String(chunk)).split('\n')
      pending = parts.pop() ?? ''
      const at = now()
      for (const text of parts) lines.push({ at, text })
      if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
    },
    since(ms) {
      return lines
        .filter(({ at }) => at >= ms)
        .map(({ at, text }) => `${new Date(at).toISOString()} ${text}\n`)
        .join('')
    },
  }
}
