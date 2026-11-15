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
//
// On iOS (device run 2026-11-14, Settings swipe ETIMEDOUT): Maestro restarted the XCUITest runner
// on every call (uninstall, install, `xcodebuild test-without-building` on a random port), and
// one restart drew a port an idle Gradle daemon held, so its status check polled that daemon for
// 2 min. So, on iOS, as the native suites do (scripts/ci/native-ios-maestro-driver.mjs), one
// runner serves the whole run on one pinned port, on a port of this simulator's own
// (scripts/lib/maestro-ios-driver-port.mjs) because two simulators run at once: the first call,
// and the first after a failure, start a runner on a port proven free on every address; every
// call after a completed one passes --no-reinstall-driver, after a status check of that port. A
// runner that answers is reused (no xcodebuild starts); a port that accepts and closes, or answers
// with something that is not HTTP, is another process's, and the call fails at once with
// maestro_driver_port_in_use. Any failed call stops the runner, so the next starts a fresh one.
// Hierarchy reads go through the same runner.
import {
  PORT_IN_USE,
  createIosDriverPortIo,
  iosDriverPortCandidates,
  isRunnerOf,
  portBusyReason,
} from './maestro-ios-driver-port.mjs'
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
  devicePortHolders,
  readSessionsFile,
} from './maestro-android-driver-session.mjs'

/** What Maestro 2.8 prints when its Android driver never came up or went away. */
export const DRIVER_START_FAILURE =
  /DeviceServerDiedException|did not start up in time|BindException|Address already in use/

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Where the subcommand (`test` or `hierarchy`) sits in a Maestro command line. */
function subcommandAt(args) {
  const at = args.findIndex((arg) => arg === 'test' || arg === 'hierarchy')
  if (at < 0) throw new Error('maestro_subcommand_required')
  return at
}

/**
 * Waits until no device socket other than TIME_WAIT holds `port` (run-maestro.mjs R18:
 * sockets a stopped driver leaves closing clear within seconds). A device that hides its socket
 * table cannot be checked, and the call goes on; anything still holding the port at `timeoutMs`
 * would make the driver's bind fail, so it throws naming the sockets.
 */
export function waitForPortFree({
  adb,
  port,
  timeoutMs = 10_000,
  intervalMs = 1_000,
  now = Date.now,
  sleep = sleepSync,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const startedAt = now()
  for (;;) {
    let table
    try {
      table = adb(['shell', 'cat', '/proc/net/tcp', '/proc/net/tcp6'])
    } catch (error) {
      log(`maestro_driver_port_unchecked: ${String(error.message).split('\n')[0]}`)
      return
    }
    const holders = devicePortHolders(table, port)
    if (holders.length === 0) return
    if (now() - startedAt >= timeoutMs)
      throw new Error(`maestro_driver_port_busy:${port}:${holders.join('; ')}`)
    sleep(intervalMs)
  }
}

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

/** How long a runner of this simulator that was told to stop may keep its port. */
const IOS_RUNNER_EXIT_MS = 10_000

/** The coded refusal: its message and `code` both lead with maestro_driver_port_in_use. */
const portInUse = (detail, cause) =>
  Object.assign(new Error(`${PORT_IN_USE}:${detail}`, cause ? { cause } : undefined), {
    code: PORT_IN_USE,
  })

/**
 * The iOS runner lifecycle of one simulator: `run(args, options)` as createSyncMaestro returns.
 * `io` is the host side (createIosDriverPortIo), whose `stop(device)` stops the simulator's
 * xcodebuild runner, and `onExit(fn)` runs `fn` when the process exits.
 */
export function createIosDriver({
  device,
  maestro,
  io = createIosDriverPortIo(),
  onExit = (fn) => process.once('exit', fn),
  now = Date.now,
  sleep = sleepSync,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const candidates = iosDriverPortCandidates(device)
  let port = null
  let reusable = false
  let exitHooked = false

  /** Stops this simulator's runner: its xcodebuild, then a runner app that outlives it. */
  const stopRunner = () => {
    reusable = false
    io.stop(device)
    if (port === null) return
    for (const listener of io.listeners(port) ?? [])
      if (isRunnerOf(listener.command, device)) io.kill(listener.pid)
  }

  /** Null once `candidate` is free; this simulator's own runner is given time to let go. */
  const busyReason = (candidate) => {
    const deadline = now() + IOS_RUNNER_EXIT_MS
    for (;;) {
      const listeners = io.listeners(candidate)
      const reason = portBusyReason({
        port: candidate,
        listeners,
        probe: io.probe(candidate, { bind: true }),
      })
      if (reason === null) return null
      const own =
        listeners?.length > 0 &&
        listeners.every((listener) => isRunnerOf(listener.command, device))
      if (!own || now() >= deadline) return reason
      for (const listener of listeners) io.kill(listener.pid)
      sleep(500)
    }
  }

  /** Reserves the first free candidate (the current port first) for a fresh runner. */
  const selectPort = () => {
    io.stop(device)
    const order =
      port === null ? candidates : [port, ...candidates.filter((c) => c !== port)]
    const busy = []
    for (const candidate of order) {
      if (!io.reserve(candidate, device)) {
        busy.push(`${candidate} reserved by another runner`)
        continue
      }
      const reason = busyReason(candidate)
      if (reason === null) {
        if (port !== null && port !== candidate) io.release(port)
        port = candidate
        if (!exitHooked) {
          exitHooked = true
          onExit(() => {
            io.stop(device)
            if (port !== null) io.release(port)
          })
        }
        if (busy.length) log(`maestro_ios_driver_port: ${port} after ${busy.join('; ')}`)
        return
      }
      io.release(candidate)
      busy.push(reason)
    }
    port = null
    throw portInUse(busy.join('; '))
  }

  /** The command line with the pinned port (a global option) and, on reuse, no reinstall. */
  const withDriverArgs = (args, reuse) => {
    const at = subcommandAt(args)
    return [
      ...args.slice(0, at),
      DRIVER_HOST_PORT_ARG,
      String(port),
      args[at],
      ...(reuse ? [NO_REINSTALL_DRIVER_ARG] : []),
      ...args.slice(at + 1),
    ]
  }

  /** What holds the port other than this simulator's runner, or null when nothing does. */
  const heldBy = (status) => {
    const listeners = io.listeners(port)
    const foreign = (listeners ?? []).filter(
      (listener) => !isRunnerOf(listener.command, device)
    )
    if (!foreign.length && !['closed', 'other'].includes(status)) return null
    return portBusyReason({
      port,
      listeners: foreign,
      probe: { connect: { '127.0.0.1': status } },
    })
  }

  const prepare = (args) => {
    if (reusable) {
      // Maestro's own status check, made first: a runner that answers is reused as it is.
      const status = io.probe(port).connect['127.0.0.1']
      if (status === 'http') return withDriverArgs(args, true)
      if (status !== 'refused' && status !== 'silent') {
        const held = heldBy(status) ?? `${port} connect 127.0.0.1 ${status}`
        stopRunner()
        throw portInUse(held)
      }
      // Gone, or wedged: a fresh runner, on this port while it is free.
      log(`maestro_ios_driver_${status === 'refused' ? 'gone' : 'unresponsive'}: ${port}`)
      stopRunner()
    }
    selectPort()
    return withDriverArgs(args, false)
  }

  return function run(args, options) {
    const driverArgs = prepare(args)
    try {
      const result = maestro(driverArgs, options)
      reusable = true
      return result
    } catch (error) {
      // Who holds the port, read before the stop; then the next call starts a fresh runner. A
      // probe that fails here is logged and leaves the Maestro failure as the error (r48 P2-3).
      let held = null
      try {
        held = heldBy(io.probe(port).connect['127.0.0.1'])
      } catch (probeError) {
        log(probeError.message)
      }
      stopRunner()
      if (!held) throw error
      const wrapped = portInUse(`${held}; ${error.message}`, error)
      Object.defineProperty(wrapped, 'output', { value: error.output ?? error.message })
      throw wrapped
    }
  }
}

/**
 * A runner's Maestro driver lifecycle. `adb(args)` runs adb on the device and returns stdout,
 * throwing on failure; `maestro(args)` runs Maestro and throws an Error on failure, with its whole
 * output as `error.output` (or in the message). Returns `run(args, options)`, which runs one Maestro command line (its
 * subcommand `test` or `hierarchy`) with the driver handled, passes `options` through to
 * `maestro`, and returns stdout. On iOS, `ios` overrides createIosDriver's options.
 */
export function createSyncMaestro({
  platform,
  device,
  adb,
  maestro,
  read,
  now,
  sleep,
  ios,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  if (platform === 'ios')
    return createIosDriver({
      device,
      maestro,
      ...(now ? { now } : {}),
      ...(sleep ? { sleep } : {}),
      log,
      ...ios,
    })
  let installed = false

  /** Whether both driver packages are on the device and the instrumentation is registered. */
  const driverComplete = () => {
    try {
      return (
        missingMaestroDriverParts(
          adb(['shell', 'pm', 'list', 'packages', 'dev.mobile.maestro']),
          adb(['shell', 'pm', 'list', 'instrumentation'])
        ).length === 0
      )
    } catch {
      return false
    }
  }

  const prepare = (subcommand) => {
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
    // maestro test binds the pinned port on the device; hierarchy has no port option.
    if (subcommand === 'test')
      waitForPortFree({ adb, port: MAESTRO_ANDROID_DRIVER_PORT, now, sleep, log })
  }

  const withDriverArgs = (args) => {
    const at = subcommandAt(args)
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
    prepare(args[subcommandAt(args)])
    let result
    try {
      result = maestro(withDriverArgs(args), options)
    } catch (error) {
      // A run that failed may have died before it installed the driver (Antigravity r29): reuse
      // it next time only if it is complete, else the next invocation starts fresh.
      installed = driverComplete()
      throw error
    }
    installed = true
    return result
  }

  return function run(args, options) {
    if (platform !== 'android') return maestro(args, options)
    try {
      return once(args, options)
    } catch (error) {
      // The whole output when the caller kept it: a long traceback can push the cause out of a
      // message that keeps only the tail.
      const output = String(error.output ?? error.message)
      if (args[subcommandAt(args)] !== 'hierarchy' || !DRIVER_START_FAILURE.test(output))
        throw error
      log(`maestro_hierarchy_retry: ${String(error.message).split('\n')[0]}`)
      return once(args, options)
    }
  }
}
