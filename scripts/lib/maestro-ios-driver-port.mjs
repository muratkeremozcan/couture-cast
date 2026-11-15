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
} = {}) {
  const lockOf = (port) => path.join(reservations, `${port}.json`)
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
     * Claims `port` for `device` unless a live runner of another device holds its lock. A lock
     * appears whole or not at all: written to a temporary file, then linked into place, which
     * fails when a lock exists. A lock whose runner died (or that cannot be read) is taken over
     * by one runner only (r48 P2-3): each runner wanting it creates a takeover marker named
     * after that lock's exact content, exclusively, so one wins; the winner reads the lock again
     * and, while it still holds that content, renames its own record over it. A runner that
     * loses, or finds another runner's lock by then, reads the lock afresh. A marker whose
     * runner died between the two steps keeps that lock, and the port is skipped.
     */
    reserve(port, device) {
      fs.mkdirSync(reservations, { recursive: true, mode: 0o700 })
      const token = randomUUID()
      const record = `${JSON.stringify({ device, pid, token })}\n`
      const lock = lockOf(port)
      const temporary = path.join(reservations, `${port}.${pid}.${token}.tmp`)
      const read = () => {
        try {
          return fs.readFileSync(lock, 'utf8')
        } catch (error) {
          if (error.code === 'ENOENT') return null
          throw error
        }
      }
      const holderOf = (raw) => {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }
      const mine = () => {
        const holder = holderOf(read())
        return holder?.pid === pid && holder?.token === token
      }
      fs.writeFileSync(temporary, record, { flag: 'wx', mode: 0o600 })
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            fs.linkSync(temporary, lock)
            return mine()
          } catch (error) {
            if (error.code !== 'EEXIST') throw error
          }
          const raw = read()
          if (raw === null) continue
          const holder = holderOf(raw)
          if (holder && holder.pid !== pid && alive(holder.pid)) return false
          // A lock its runner left behind when it died, or this runner's own.
          const marker = path.join(
            reservations,
            `${port}.takeover.${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
          )
          try {
            fs.writeFileSync(marker, `${pid}\n`, { flag: 'wx', mode: 0o600 })
          } catch (error) {
            if (error.code !== 'EEXIST') throw error
            continue
          }
          try {
            if (read() !== raw) continue
            fs.renameSync(temporary, lock)
            return mine()
          } finally {
            fs.rmSync(marker, { force: true })
          }
        }
        return false
      } finally {
        fs.rmSync(temporary, { force: true })
      }
    },
    release(port) {
      try {
        if (JSON.parse(fs.readFileSync(lockOf(port), 'utf8')).pid === pid)
          fs.rmSync(lockOf(port), { force: true })
      } catch {
        // Already gone.
      }
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
