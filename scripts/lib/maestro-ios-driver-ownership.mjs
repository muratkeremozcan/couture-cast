// Maestro's iOS driver listens on fixed host port 7001. A driver that outlives its run
// keeps the port, and the next run's first flow dies with
// `Failed to connect to /127.0.0.1:7001`, a failure that looks exactly like a flaky
// device and was recorded as one twice before it was traced here.
//
// The runner records the driver processes its own Maestro child starts. On the next
// start it stops only those, after confirming each PID still runs the same driver
// command, and refuses to start while any other process holds the port.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const IOS_DRIVER_PORT = 7001
const IOS_DRIVER_PATTERNS = [
  'maestro-driver-iosUITests-Runner',
  'maestro-driver-ios-config.xctestrun',
]
const TRACK_INTERVAL_MS = 2_000
const EXIT_GRACE_MS = 5_000
const EXIT_POLL_MS = 100

export const isIosDriverCommand = (command) =>
  IOS_DRIVER_PATTERNS.some((pattern) => command.includes(pattern))

/** One pidfile per checkout, outside the repository and its uploaded artifacts. */
export const iosDriverPidfile = (projectRoot) =>
  path.join(
    os.tmpdir(),
    'couture-cast-maestro',
    `${createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)}-ios-drivers.json`
  )

const parseProcessTable = (text) =>
  text
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      command: command.trim(),
    }))

export const defaultDriverIo = {
  processTable: () =>
    parseProcessTable(
      spawnSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout ?? ''
    ),
  commandOf: (pid) =>
    (
      spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
        .stdout ?? ''
    ).trim(),
  portHolders: (port) =>
    (
      spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
      }).stdout ?? ''
    )
      .split('\n')
      .filter((line) => /^\d+$/.test(line.trim()))
      .map(Number),
  kill: (pid, signal) => process.kill(pid, signal),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error.code === 'EPERM'
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  readPidfile: (file) => {
    try {
      const records = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(records) ? records : []
    } catch {
      return []
    }
  },
  writePidfile: (file, records) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`)
  },
}

/** Adds every driver descended from rootPid to the pidfile with its exact command. */
export function recordOwnedIosDrivers({ pidfile, rootPid, io = defaultDriverIo }) {
  const table = io.processTable()
  const children = new Map()
  for (const row of table) {
    if (!children.has(row.ppid)) children.set(row.ppid, [])
    children.get(row.ppid).push(row)
  }
  const found = []
  const queue = [...(children.get(rootPid) ?? [])]
  while (queue.length) {
    const row = queue.shift()
    if (isIosDriverCommand(row.command))
      found.push({ pid: row.pid, command: row.command })
    queue.push(...(children.get(row.pid) ?? []))
  }
  const records = io.readPidfile(pidfile)
  const known = new Set(records.map((record) => `${record.pid}\0${record.command}`))
  const added = found.filter((record) => !known.has(`${record.pid}\0${record.command}`))
  if (added.length) io.writePidfile(pidfile, [...records, ...added])
  return added
}

/** Snapshots driver descendants while the Maestro child runs; returns a stop function. */
export function trackOwnedIosDrivers({
  pidfile,
  rootPid,
  io = defaultDriverIo,
  intervalMs = TRACK_INTERVAL_MS,
}) {
  const snapshot = () => {
    try {
      recordOwnedIosDrivers({ pidfile, rootPid, io })
    } catch {
      // A failed snapshot leaves the next one to record the driver.
    }
  }
  const timer = setInterval(snapshot, intervalMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    snapshot()
  }
}

async function stop(pid, io) {
  io.kill(pid, 'SIGTERM')
  for (let waited = 0; waited < EXIT_GRACE_MS; waited += EXIT_POLL_MS) {
    if (!io.alive(pid)) return
    await io.sleep(EXIT_POLL_MS)
  }
  if (io.alive(pid)) io.kill(pid, 'SIGKILL')
}

/**
 * Stops this checkout's recorded drivers that still run their recorded command,
 * leaves every other PID alone, and fails fast when anything else holds port 7001.
 */
export async function reclaimIosDriverPort({ pidfile, io = defaultDriverIo }) {
  const stopped = []
  const leftAlone = []
  for (const record of io.readPidfile(pidfile)) {
    const current = io.commandOf(record.pid)
    if (current && current === record.command && isIosDriverCommand(current)) {
      await stop(record.pid, io)
      stopped.push(record.pid)
    } else leftAlone.push(record.pid)
  }
  io.writePidfile(pidfile, [])
  const holders = io.portHolders(IOS_DRIVER_PORT)
  if (holders.length) {
    const pid = holders[0]
    throw new Error(
      `ios_driver_port_held: host port ${IOS_DRIVER_PORT} is held by PID ${pid} (${io.commandOf(pid) || 'unknown command'}), which this runner did not start. Stop that process and rerun.`
    )
  }
  return { stopped, leftAlone }
}
