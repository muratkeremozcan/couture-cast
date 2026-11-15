// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 TEA: the host port of one simulator's XCUITest runner, for the runners that call
// Maestro once per step (scripts/lib/maestro-driver-sync.mjs).
//
// Device run 2026-11-14 (iOS live font, Settings): Maestro 2.8 picked a random port per call
// (49907, then 50361). An idle Gradle daemon already listened on 127.0.0.1:50361 through an IPv6
// socket; Maestro's free-port check missed it, the runner failed to bind (errno 48), and every
// status check for 2 min reached the daemon, which accepted and closed ("unexpected end of
// stream"). The same experiment on this host shows why the check missed it: binding 0.0.0.0, ::
// and ::1 on that port all succeed, only 127.0.0.1 fails, and a connect to 127.0.0.1 is accepted
// and closed.
//
// So a port counts as free only when all three agree: lsof lists no listener on any address
// (127.0.0.1, ::1, the wildcards, v4-mapped), a connect to 127.0.0.1 and to ::1 is refused, and a
// bind on each of 127.0.0.1, ::1, 0.0.0.0 and :: succeeds. Each simulator gets its own candidate
// list, derived from its UDID, in a range below every ephemeral range and clear of the 17001
// (Android) and 17101 (iOS native suites) pins; two runners on one host reserve a port through a
// lock file before checking it, so two simulators never share one.
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 17200-17499: under 32768 (Linux) and 49152 (macOS) ephemeral ports, under Dropbox's 17500. */
export const IOS_DRIVER_PORT_FIRST = 17200
export const IOS_DRIVER_PORT_COUNT = 300
/** Candidates tried, in order, before a run refuses to start the runner. */
export const IOS_DRIVER_PORT_CANDIDATES = 8
export const PORT_IN_USE = 'maestro_driver_port_in_use'

const RUNNER = 'maestro-driver-iosUITests-Runner'
const UDID = /^[0-9A-Fa-f-]{36}$/
const LOOPBACKS = ['127.0.0.1', '::1']
const BINDS = ['127.0.0.1', '::1', '0.0.0.0', '::']
/** A runner under host load can take a while to answer; a holder that closes answers at once. */
const STATUS_TIMEOUT_MS = 5_000

/** The ports to try for `device`, in order: a UDID-derived start, then the next ones, wrapping. */
export function iosDriverPortCandidates(device) {
  const start =
    createHash('sha256').update(String(device).toUpperCase()).digest().readUInt32BE(0) %
    IOS_DRIVER_PORT_COUNT
  return Array.from(
    { length: IOS_DRIVER_PORT_CANDIDATES },
    (_, offset) => IOS_DRIVER_PORT_FIRST + ((start + offset) % IOS_DRIVER_PORT_COUNT)
  )
}

/** Whether `command` is the XCUITest runner app of `device` (any runner when it is no UDID). */
export const isRunnerOf = (command, device) =>
  command.includes(RUNNER) && (!UDID.test(device) || command.includes(device))

// Run by `node -e` so the synchronous runners can probe sockets. argv: port, "bind" or "status".
// A connect is classed by what answers: refused, http (a status line), closed (accepted and
// closed or reset: Maestro's "unexpected end of stream"), other (bytes that are not HTTP), silent
// (accepted, nothing within the timeout) or unavailable (no such address on this host).
const PROBE_SOURCE = `
const net = require('node:net')
const port = Number(process.argv[1])
// A host without IPv6 has no ::1 to listen on, so nothing there can hold the port.
const UNREACHABLE = ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH', 'EHOSTUNREACH']
const connect = (host) => new Promise((resolve) => {
  let data = ''
  let done = false
  const socket = net.connect({ host, port })
  const finish = (verdict) => { if (!done) { done = true; socket.destroy(); resolve(verdict) } }
  const answered = () => (data.startsWith('HTTP/') ? 'http' : 'other')
  socket.setTimeout(${STATUS_TIMEOUT_MS})
  socket.on('connect', () => socket.write('GET /status HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n'))
  socket.on('data', (chunk) => { data += chunk; if (data.length >= 5) finish(answered()) })
  socket.on('end', () => finish(data ? answered() : 'closed'))
  socket.on('close', () => finish(data ? answered() : 'closed'))
  socket.on('timeout', () => finish(data ? answered() : 'silent'))
  socket.on('error', (error) => finish(
    error.code === 'ECONNREFUSED' ? 'refused'
      : error.code === 'ECONNRESET' ? 'closed'
      : UNREACHABLE.includes(error.code) ? 'unavailable' : 'error:' + error.code
  ))
})
const bind = (host) => new Promise((resolve) => {
  const server = net.createServer()
  server.once('error', (error) => resolve(
    error.code === 'EADDRINUSE' ? 'in_use'
      : UNREACHABLE.includes(error.code) ? 'unavailable' : 'error:' + error.code
  ))
  server.listen({ host, port }, () => server.close(() => resolve('ok')))
})
;(async () => {
  const result = { connect: {}, bind: {} }
  for (const host of ${JSON.stringify(LOOPBACKS)}) result.connect[host] = await connect(host)
  if (process.argv[2] === 'bind')
    for (const host of ${JSON.stringify(BINDS)}) result.bind[host] = await bind(host)
  process.stdout.write(JSON.stringify(result))
})()
`

/** Link errors of a filesystem without hard links, where no lock can be placed atomically. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'ENOSYS', 'EXDEV'])
/**
 * Takeover generations of one dead lock walked before the takeover fails as
 * maestro_driver_port_takeover_runaway (r52 P3-1): every dead generation is a crashed runner's
 * leftover, so a real host never comes near it.
 */
const MARKER_RUNAWAY = 1000

/** Every host call is bounded: a hung lsof, ps, pgrep or probe fails its call at 30 s. */
const SPAWN_OPTIONS = { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }
const boundedSpawn = (command, args) => spawnSync(command, args, SPAWN_OPTIONS)

/** `lsof -F ptn` records: one listener per address a process listens on. */
function parseLsof(text) {
  const listeners = []
  let pid
  let type
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('t')) type = line.slice(1)
    else if (line.startsWith('n')) listeners.push({ pid, type, address: line.slice(1) })
  }
  return listeners
}

/**
 * The host side of the iOS driver port, every call through `spawn(command, args)`, which returns
 * spawnSync's result. `reservations` is the directory of port lock files shared by every runner
 * on the host.
 */
export function createIosDriverPortIo({
  spawn = boundedSpawn,
  reservations = path.join(os.tmpdir(), 'couture-cast-maestro', 'ios-driver-ports'),
  pid = process.pid,
  alive = (other) => {
    try {
      process.kill(other, 0)
      return true
    } catch (error) {
      return error.code === 'EPERM'
    }
  },
  files = fs,
  markerLimit = MARKER_RUNAWAY,
} = {}) {
  const lockOf = (port) => path.join(reservations, `${port}.json`)
  /** The token of each port lock this io holds, so only its own lock is ever released. */
  const held = new Map()
  const readOrNull = (file) => {
    try {
      return files.readFileSync(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  const parsed = (raw) => {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  /**
   * Links `source` to `target`, which fails when `target` exists: true when linked, false when
   * it exists. A filesystem without hard links fails as maestro_driver_port_lock_unsupported
   * (r49 P3-2), since no lock could be placed atomically there.
   */
  const place = (source, target) => {
    try {
      files.linkSync(source, target)
      return true
    } catch (error) {
      if (error.code === 'EEXIST') return false
      if (LINK_UNSUPPORTED.has(error.code))
        throw Object.assign(
          new Error(
            `maestro_driver_port_lock_unsupported: ${error.code} linking in ${reservations}`
          ),
          { code: 'maestro_driver_port_lock_unsupported', cause: error }
        )
      throw error
    }
  }
  /**
   * Whether a lock or takeover marker's runner is alive (r49 P2-3): another process by its pid,
   * this process by its token, so a record of this process under another token (another io, or
   * this one's earlier reservation) is live and only a record whose token this io holds is its
   * own. A record that cannot be read is no runner's.
   */
  const liveRecord = (record, own) =>
    record !== null &&
    typeof record === 'object' &&
    (record.pid === pid
      ? typeof record.token === 'string' && record.token !== own
      : Number.isSafeInteger(record.pid) && record.pid > 0 && alive(record.pid))
  /**
   * Takes over the lock of `port` from a dead runner (r49 P2-3): true when this runner's record
   * (`temporary`) replaced it, false when the lock is live, changed, or another runner is taking
   * it over. Markers are named after the lock's exact content and a generation, and each holds
   * its runner's pid and token, placed whole by a link: one runner places a generation, so one
   * wins, and a generation whose runner died passes the takeover to the next, until one places
   * or a live marker is found (r52 P3-1: a cap left the port dead for good), MARKER_RUNAWAY at
   * most. Dead markers are removed only by the winner, since removing one elsewhere could let
   * two runners win. The winner reads the lock again and, while it still holds that content,
   * renames its own record over it, so the lock is never absent. It then removes its marker and
   * the dead generations below it; a late runner that places a marker for content the lock no
   * longer holds finds it changed and removes its own.
   */
  const takeOver = (port, temporary, token) => {
    const lock = lockOf(port)
    const raw = readOrNull(lock)
    if (raw === null || liveRecord(parsed(raw), held.get(port))) return false
    const base = `${port}.takeover.${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
    const markerTemporary = path.join(reservations, `${port}.${pid}.${token}.marker.tmp`)
    files.writeFileSync(markerTemporary, `${JSON.stringify({ pid, token })}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    const dead = []
    try {
      for (let generation = 0; ; generation += 1) {
        if (generation >= markerLimit)
          throw Object.assign(
            new Error(
              `maestro_driver_port_takeover_runaway: ${generation} dead takeover markers for port ${port} in ${reservations}`
            ),
            { code: 'maestro_driver_port_takeover_runaway' }
          )
        const marker = path.join(reservations, `${base}.${generation}`)
        if (!place(markerTemporary, marker)) {
          const other = readOrNull(marker)
          if (other === null || liveRecord(parsed(other), token)) return false
          dead.push(marker)
          continue
        }
        try {
          if (readOrNull(lock) !== raw) return false
          files.renameSync(temporary, lock)
          for (const each of dead) files.rmSync(each, { force: true })
          return true
        } finally {
          files.rmSync(marker, { force: true })
        }
      }
    } finally {
      files.rmSync(markerTemporary, { force: true })
    }
  }
  return {
    /** Every process listening on `port` on any address, with its full command; null if unknown. */
    listeners(port) {
      const listed = spawn('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fptn'])
      // lsof exits 1 when nothing matches; no binary or a timeout leaves the probes to decide.
      if (listed.error || listed.signal) return null
      const listeners = parseLsof(String(listed.stdout ?? ''))
      for (const listener of listeners)
        listener.command = String(
          spawn('ps', ['-o', 'command=', '-p', String(listener.pid)]).stdout ?? ''
        ).trim()
      return listeners
    },
    /** Connects to both loopbacks; with `bind`, also binds every address. */
    probe(port, { bind = false } = {}) {
      const probed = spawn(process.execPath, [
        '-e',
        PROBE_SOURCE,
        String(port),
        bind ? 'bind' : 'status',
      ])
      if (probed.status !== 0 || probed.error)
        throw new Error(
          `maestro_driver_port_probe_failed:${port}:${probed.error?.code ?? probed.status}`
        )
      return JSON.parse(probed.stdout)
    },
    /**
     * Claims `port` for `device` unless a live runner holds its lock. A lock appears whole or
     * not at all: written to a temporary file, then linked into place, which fails when a lock
     * exists, and a lock is never absent while it is taken over. A lock whose runner died (or
     * that cannot be read) is taken over by one runner only (r48 P2-3, r49 P2-3): see takeOver.
     * A runner that loses, or finds another runner's lock by then, reads the lock afresh, three
     * times at most.
     */
    reserve(port, device) {
      files.mkdirSync(reservations, { recursive: true, mode: 0o700 })
      const lock = lockOf(port)
      const own = held.get(port)
      if (own !== undefined && parsed(readOrNull(lock))?.token === own) return true
      const token = randomUUID()
      const temporary = path.join(reservations, `${port}.${pid}.${token}.tmp`)
      const mine = () => {
        const holder = parsed(readOrNull(lock))
        return holder?.pid === pid && holder?.token === token
      }
      files.writeFileSync(temporary, `${JSON.stringify({ device, pid, token })}\n`, {
        flag: 'wx',
        mode: 0o600,
      })
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (place(temporary, lock) || takeOver(port, temporary, token)) {
            if (!mine()) return false
            held.set(port, token)
            return true
          }
          const holder = parsed(readOrNull(lock))
          if (liveRecord(holder, own)) return false
        }
        return false
      } finally {
        files.rmSync(temporary, { force: true })
      }
    },
    release(port) {
      const token = held.get(port)
      held.delete(port)
      if (token === undefined) return
      const holder = parsed(readOrNull(lockOf(port)))
      if (holder?.pid === pid && holder?.token === token)
        files.rmSync(lockOf(port), { force: true })
    },
    kill(other) {
      spawn('kill', ['-TERM', String(other)])
    },
    /**
     * SIGTERM of the xcodebuild runner(s) of this simulator only, as stopIosDriver in
     * scripts/ci/native-ios-maestro-driver.mjs does for the native suites, with every call
     * bounded (the Test Store driver loads only bounded spawns).
     */
    stop(device) {
      if (!UDID.test(device)) return { stopped: 0 }
      const listed = spawn('pgrep', ['-f', `xcodebuild test-without-building.*${device}`])
      const pids = String(listed.stdout ?? '')
        .split('\n')
        .map(Number)
        .filter((other) => Number.isSafeInteger(other) && other > 1 && other !== pid)
      if (pids.length) spawn('kill', ['-TERM', ...pids.map(String)])
      return { stopped: pids.length }
    },
  }
}

/**
 * Why `port` is not free, or null when it is. `probe` is a bind probe; `listeners` may be null
 * (lsof unavailable), and then the probes alone decide.
 */
export function portBusyReason({ port, listeners, probe }) {
  const reasons = []
  for (const { pid, address, command } of listeners ?? [])
    reasons.push(`${address} pid ${pid} ${String(command).slice(0, 120)}`)
  for (const [host, verdict] of Object.entries(probe.connect))
    if (verdict !== 'refused' && verdict !== 'unavailable')
      reasons.push(`connect ${host} ${verdict}`)
  for (const [host, verdict] of Object.entries(probe.bind ?? {}))
    if (verdict !== 'ok' && verdict !== 'unavailable')
      reasons.push(`bind ${host} ${verdict}`)
  return reasons.length ? `${port} ${reasons.join(', ')}` : null
}
