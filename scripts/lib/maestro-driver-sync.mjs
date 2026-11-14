// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 TEA: the Maestro driver of the runners that call Maestro once per step with
// spawnSync (the live font proof and the Test Store journey), on the rules run-maestro.mjs
// learned in Story 6.7 R62 and 6.7b R18 (scripts/lib/maestro-driver-reuse.mjs and
// scripts/lib/maestro-android-driver-session.mjs), in those runners' synchronous style.
//
// Device run 2026-11-13 (leg 1, Android API 36): a four-screen proof is about 300 Maestro
// sessions. Each one reinstalled the driver (about 1,400 app UIDs per run, until a 25 h
// emulator could not assign dev.mobile.maestro a UID), and twice, at the third screen, a session
// died with DeviceServerDiedException during deviceInfo and the next one failed the same way.
// That is the R62 reinstall stall and the R18 cascade: Maestro 2.8 draws each driver port from
// the ephemeral range the device uses for its own sockets, a driver that cannot bind never
// starts, and the session record it leaves makes the next invocation within 21 s attach to a
// driver that does not exist.
//
// So, on Android: the first invocation starts from a removed driver and installs it; every later
// one passes --no-reinstall-driver after checking both driver packages and the instrumentation
// are still there; before each, the driver an earlier one left running is stopped and a stale
// session record is waited out (a live one stops the run). `maestro test` pins the driver to a
// port below every ephemeral range. `maestro hierarchy` has no port option in 2.8, so a hierarchy
// read whose driver failed to start is read once more, after the stale record ages out: the read
// changes nothing on the device, and each retry is logged.
import {
  MAESTRO_DRIVER_PACKAGES,
  NO_REINSTALL_DRIVER_ARG,
  missingMaestroDriverParts,
} from './maestro-driver-reuse.mjs'
import {
  DRIVER_HOST_PORT_ARG,
  MAESTRO_ANDROID_DRIVER_PORT,
  MAESTRO_HEARTBEAT_INTERVAL_MS,
  MAESTRO_SESSION_ACTIVE_MS,
  MAESTRO_SESSIONS_FILE,
  activeMaestroSessions,
  readSessionsFile,
} from './maestro-android-driver-session.mjs'

/** What Maestro 2.8 prints when its Android driver never came up or went away. */
export const DRIVER_START_FAILURE =
  /DeviceServerDiedException|did not start up in time|BindException|Address already in use/

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Waits until no Maestro session counts as active on `device`. A record whose heartbeat stays
 * put belongs to an invocation that exited before its driver started and is waited out; one
 * whose heartbeat moves is a live Maestro, and throws.
 */
export function waitOutStaleSessions({
  device,
  read = () => readSessionsFile(MAESTRO_SESSIONS_FILE),
  now = Date.now,
  sleep = sleepSync,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const seen = new Map()
  for (;;) {
    const active = activeMaestroSessions(read(), {
      platform: 'ANDROID',
      device,
      nowMs: now(),
    })
    if (active.length === 0) return
    for (const { sessionId, heartbeatMs } of active) {
      const first = seen.get(sessionId)
      if (first === undefined) seen.set(sessionId, heartbeatMs)
      else if (first !== heartbeatMs) throw new Error(`maestro_session_live:${sessionId}`)
    }
    const remainingMs = MAESTRO_SESSION_ACTIVE_MS - active[0].ageMs
    log(`maestro_session_stale: waiting ${Math.ceil(remainingMs / 1000)} s`)
    sleep(Math.min(remainingMs + 50, MAESTRO_HEARTBEAT_INTERVAL_MS + 500))
  }
}

/**
 * A runner's Maestro driver lifecycle. `adb(args)` runs adb on the device and returns stdout,
 * throwing on failure; `maestro(args)` runs Maestro and throws an Error whose message carries
 * its output on failure. Returns `run(args, options)`, which runs one Maestro command line (its
 * subcommand `test` or `hierarchy`) with the driver handled, passes `options` through to
 * `maestro`, and returns stdout.
 */
export function createSyncMaestro({
  platform,
  device,
  adb,
  maestro,
  read,
  now,
  sleep,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  let installed = false

  const prepare = () => {
    if (!installed) {
      // The first invocation installs a driver of this Maestro version from nothing.
      for (const name of [...MAESTRO_DRIVER_PACKAGES].reverse()) {
        try {
          adb(['shell', 'pm', 'uninstall', name])
        } catch {
          // Not installed; the listing below decides.
        }
      }
      const listing = adb(['shell', 'pm', 'list', 'packages', 'dev.mobile.maestro'])
      const left = MAESTRO_DRIVER_PACKAGES.filter((name) =>
        listing.split(/\r?\n/).some((line) => line.trim() === `package:${name}`)
      )
      if (left.length) throw new Error(`maestro_driver_not_removed:${left.join(',')}`)
    } else {
      const missing = missingMaestroDriverParts(
        adb(['shell', 'pm', 'list', 'packages', 'dev.mobile.maestro']),
        adb(['shell', 'pm', 'list', 'instrumentation'])
      )
      if (missing.length) {
        installed = false
        throw new Error(`maestro_driver_not_ready:${missing.join('; ')}`)
      }
    }
    // A driver an earlier invocation left running holds its port until it is stopped.
    adb(['shell', 'am', 'force-stop', 'dev.mobile.maestro'])
    waitOutStaleSessions({ device, read, now, sleep, log })
  }

  const withDriverArgs = (args) => {
    const at = args.findIndex((arg) => arg === 'test' || arg === 'hierarchy')
    if (at < 0) throw new Error('maestro_subcommand_required')
    const extra =
      args[at] === 'test'
        ? [
            NO_REINSTALL_DRIVER_ARG,
            DRIVER_HOST_PORT_ARG,
            String(MAESTRO_ANDROID_DRIVER_PORT),
          ]
        : [NO_REINSTALL_DRIVER_ARG]
    return [...args.slice(0, at + 1), ...extra, ...args.slice(at + 1)]
  }

  const once = (args, options) => {
    prepare()
    try {
      return maestro(withDriverArgs(args), options)
    } finally {
      // Whatever the outcome, this invocation installed the driver if it was missing; the next
      // one checks it is complete before reusing it.
      installed = true
    }
  }

  return function run(args, options) {
    if (platform !== 'android') return maestro(args, options)
    try {
      return once(args, options)
    } catch (error) {
      const hierarchyRead = args.includes('hierarchy')
      if (!hierarchyRead || !DRIVER_START_FAILURE.test(String(error.message))) throw error
      log(`maestro_hierarchy_retry: ${String(error.message).split('\n')[0]}`)
      return once(args, options)
    }
  }
}
