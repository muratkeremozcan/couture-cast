/**
 * Closed timing and environment facts of the Android TalkBack stage, so a flake can be told
 * apart without a rerun: the TalkBack build, how long enabling and the instrumentation took,
 * and the Metro bundles built while it ran (a cold lazy chunk would show here).
 */
export const bundleBuilds = (log) =>
  [...String(log ?? '').matchAll(/Bundled (\d+)ms/g)].map((match) => Number(match[1]))

/** versionName of the installed TalkBack from `dumpsys package`, or null. */
export function talkBackVersion(dumpsys) {
  const name = /versionName=(\S+)/.exec(String(dumpsys ?? ''))?.[1] ?? ''
  return /^[0-9][0-9A-Za-z._-]{0,40}$/.test(name) ? name : null
}

/**
 * Focus-wait latencies the instrumented test prints as closed lines
 * (CC68_FOCUS_LATENCY|<wait>|<ms>|ok or timeout). Anything else in the output is ignored.
 */
export function focusLatencies(output) {
  return [
    ...String(output ?? '').matchAll(
      /^CC68_FOCUS_LATENCY\|([A-Za-z0-9 _.\-/]{1,80})\|(\d{1,6})\|(ok|timeout)$/gm
    ),
  ]
    .slice(0, 40)
    .map((match) => ({ wait: match[1], ms: Number(match[2]), outcome: match[3] }))
}

/**
 * Who held TalkBack focus when a focus wait timed out, from closed lines the instrumented test
 * prints (CC68_FOCUS_HOLDER|<wait>|<testID suffix, unnamed or none>|<active window type>).
 * Only testIDs and fixed window type names pass, so nothing a person typed can reach the log.
 */
export function focusHolders(output) {
  return [
    ...String(output ?? '').matchAll(
      /^CC68_FOCUS_HOLDER\|([A-Za-z0-9 _.\-/]{1,80})\|([A-Za-z0-9_.-]{1,80})\|([a-z_]{1,32})$/gm
    ),
  ]
    .slice(0, 40)
    .map((match) => ({ wait: match[1], holder: match[2], window: match[3] }))
}

const seconds = (ms) =>
  Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null

export function talkbackEvidence({
  version,
  enableMs,
  instrumentMs,
  bundlesBefore = [],
  bundlesAfter = [],
  focusWaits = [],
  focusHolders = [],
}) {
  const during = bundlesAfter.slice(bundlesBefore.length)
  return {
    version: 1,
    talkBackVersion: version ?? null,
    enableSeconds: seconds(enableMs),
    instrumentSeconds: seconds(instrumentMs),
    bundleBuildsDuringStage: during.length,
    bundleMsDuringStage: during.slice(0, 20),
    focusWaits,
    focusHolders,
  }
}
