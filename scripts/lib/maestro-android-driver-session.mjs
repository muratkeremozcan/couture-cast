/**
 * Story 6.7b R18: every Android flow starts its own Maestro driver, on a port
 * the device cannot be using, with no earlier invocation's session in the way.
 *
 * CI run 40150172453 (shard 1, job 121039877849) lost two flows to one driver
 * failure. Maestro 2.8.0 picks the driver port as a free *host* ephemeral port
 * (`TestCommand.selectPort`, a `ServerSocket(0)`) and has the driver listen on
 * the same number *on the device*. The device draws its own outgoing ports from
 * the same 32768-60999 range, and for `sanity.yaml` the number was taken there:
 * the driver logged `BindException: Address already in use` for [::]:46091 and
 * exited, and Maestro waited out its startup timeout ("Maestro Android driver
 * did not start up in time ... (driver port 46091)"). Passing
 * `--driver-host-port` with a port below every ephemeral range (Linux and
 * Android 32768+, macOS 49152+) removes that collision: no outgoing socket on the
 * device is ever given it.
 *
 * The next flow then failed in 134 ms with `DeviceServerDiedException` during
 * `deviceInfo`. Maestro records each invocation in `~/.maestro/sessions` as
 * `<PLATFORM>_<device>_<session id>=<heartbeat ms>`, refreshed every 5 s, and an
 * invocation that finds another session on its device with a heartbeat under
 * 21 s old skips starting a driver and attaches to that session's port instead
 * (`MaestroSessionManager.newSession`, `SessionStore.hasActiveSessionForDevice`).
 * The shutdown hook that removes the record is registered only after the driver
 * opens, so an invocation whose driver never started leaves its record behind,
 * and any invocation in the next 21 s attaches to a driver that does not exist.
 * Reproduced locally with Maestro 2.8.0: a driver kept from starting left
 * `ANDROID_emulator-5554_<id>` in the file, and the next `maestro test` failed in
 * 78 ms with the same exception. Before each flow the runner now waits for such a
 * record to age out, which takes at most 21 s and only after a failed start; a
 * record whose heartbeat is still moving belongs to a live Maestro (Studio,
 * another run) and stops the flow with a named cause.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Below the Linux, Android and macOS ephemeral ranges, and unused by the stack. */
export const MAESTRO_ANDROID_DRIVER_PORT = 17001
export const DRIVER_HOST_PORT_ARG = '--driver-host-port'

/** Maestro 2.8.0 `SessionStore`: a heartbeat under this age is an active session. */
export const MAESTRO_SESSION_ACTIVE_MS = 21_000
/** Maestro 2.8.0 refreshes a live session's heartbeat this often. */
export const MAESTRO_HEARTBEAT_INTERVAL_MS = 5_000

export const MAESTRO_SESSIONS_FILE = path.join(os.homedir(), '.maestro', 'sessions')

/**
 * The sessions Maestro would treat as active on `device`, from the text of its
 * sessions file, newest heartbeat first.
 *
 * @param {string} text
 * @param {{ platform: string, device?: string, nowMs: number }} options
 * @returns {{ sessionId: string, heartbeatMs: number, ageMs: number }[]}
 */
export function activeMaestroSessions(text, { platform, device, nowMs }) {
  // Without a device (adb's single default device) every record of the platform counts.
  const prefix = `${platform.toUpperCase()}_${device ? `${device}_` : ''}`
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix) && line.includes('='))
    .map((line) => {
      const separator = line.lastIndexOf('=')
      const key = line.slice(0, separator)
      return {
        sessionId: key.slice(key.lastIndexOf('_') + 1),
        heartbeatMs: Number(line.slice(separator + 1)),
      }
    })
    .filter(({ heartbeatMs }) => Number.isFinite(heartbeatMs))
    .map((session) => ({ ...session, ageMs: nowMs - session.heartbeatMs }))
    .filter(({ ageMs }) => ageMs < MAESTRO_SESSION_ACTIVE_MS)
    .sort((left, right) => left.ageMs - right.ageMs)
}

/**
 * Waits until no other Maestro session counts as active on `device`. A record
 * whose heartbeat stays put was left by an invocation that has exited, and is
 * waited out; one whose heartbeat moves is a live Maestro, and throws.
 *
 * @param {{
 *   device?: string,
 *   platform?: string,
 *   read?: () => string,
 *   log: (message: string) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<{ waitedMs: number }>}
 */
export async function waitForStaleMaestroSessions({
  device,
  platform = 'ANDROID',
  read = () => readSessionsFile(MAESTRO_SESSIONS_FILE),
  log,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = now()
  const name = device ?? 'the default adb device'
  /** @type {Map<string, number>} first heartbeat seen per session */
  const seen = new Map()
  let logged = false
  for (;;) {
    const active = activeMaestroSessions(read(), { platform, device, nowMs: now() })
    if (active.length === 0) return { waitedMs: now() - startedAt }
    for (const { sessionId, heartbeatMs } of active) {
      const first = seen.get(sessionId)
      if (first === undefined) seen.set(sessionId, heartbeatMs)
      else if (heartbeatMs !== first) {
        throw new Error(
          `Another Maestro session (${sessionId}) is live on ${name}: its heartbeat ` +
            "is still moving, so this flow would attach to that session's driver. " +
            'Stop the other Maestro (Studio or another run) first.'
        )
      }
    }
    // Sorted newest first, so the first record is the last to expire.
    const remainingMs = MAESTRO_SESSION_ACTIVE_MS - active[0].ageMs
    if (!logged) {
      log(
        `Waiting ${Math.ceil(remainingMs / 1000)} s for the Maestro session record ` +
          `${active.map(({ sessionId }) => sessionId).join(', ')} on ${name} to expire: ` +
          'its invocation exited before its driver started, and a new invocation would ' +
          'attach to that missing driver'
      )
      logged = true
    }
    // Wake at least once per heartbeat interval, so a live session is caught moving.
    await sleep(Math.min(remainingMs + 50, MAESTRO_HEARTBEAT_INTERVAL_MS + 500))
  }
}

/**
 * @param {string} file
 * @returns {string}
 */
export function readSessionsFile(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return ''
    throw error
  }
}

const TCP_STATES = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
}

/**
 * The device sockets bound to local `port`, from `/proc/net/tcp` and
 * `/proc/net/tcp6`, other than TIME_WAIT (which a listener with SO_REUSEADDR, as
 * the driver's gRPC server opens, may bind over).
 *
 * @param {string} procNetText
 * @param {number} port
 * @returns {string[]} one `<local> -> <remote> <state>` entry per socket
 */
export function devicePortHolders(procNetText, port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0')
  return procNetText
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => /^\d+:$/.test(fields[0] ?? ''))
    .filter((fields) => (fields[1] ?? '').toUpperCase().endsWith(`:${hex}`))
    .map((fields) => ({
      local: fields[1],
      remote: fields[2],
      state: TCP_STATES[(fields[3] ?? '').toUpperCase()] ?? fields[3],
    }))
    .filter(({ state }) => state !== 'TIME_WAIT')
    .map(({ local, remote, state }) => `${local} -> ${remote} ${state}`)
}

/**
 * Waits until no device socket other than TIME_WAIT holds `port`, polling
 * `readProcNet` (the text of `/proc/net/tcp` and `/proc/net/tcp6`). Sockets a
 * stopped driver leaves closing clear within seconds; anything still there at
 * `timeoutMs` (an `adb reverse` or a listener someone started) would make the
 * driver's bind fail, so it throws naming the sockets.
 *
 * @param {{
 *   readProcNet: () => Promise<string>,
 *   port: number,
 *   device: string,
 *   timeoutMs?: number,
 *   intervalMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 * @returns {Promise<void>}
 */
export async function waitForDevicePortFree({
  readProcNet,
  port,
  device,
  timeoutMs = 10_000,
  intervalMs = 1_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const startedAt = now()
  for (;;) {
    const holders = devicePortHolders(await readProcNet(), port)
    if (holders.length === 0) return
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `device port ${port} on ${device} is still in use after ${timeoutMs} ms ` +
          `(${holders.join('; ')}), so the Maestro driver could not listen on it`
      )
    }
    await sleep(intervalMs)
  }
}
