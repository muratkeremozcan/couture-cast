// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The port probes against real sockets on this host: holders run in child processes, since the
// probe is synchronous and would block a holder in this one.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  createIosDriverPortIo,
  isRunnerOf,
  portBusyReason,
} from './maestro-ios-driver-port.mjs'

const io = createIosDriverPortIo()

/** A child listening on `host`, accepting then closing, or answering HTTP; resolves its port. */
async function holder(t, host, { http = false } = {}) {
  const source = `
    const net = require('node:net')
    const server = net.createServer((socket) => {
      ${http ? "socket.end('HTTP/1.1 200 OK\\r\\ncontent-length: 2\\r\\n\\r\\nok')" : 'socket.destroy()'}
    })
    server.listen({ host: ${JSON.stringify(host)}, port: 0 }, () => console.log(server.address().port))
  `
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => child.kill('SIGKILL'))
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())))
    child.once('exit', (code) => reject(new Error(`holder exited ${code}`)))
  })
  return { port, pid: child.pid }
}

const ipv6 = await new Promise((resolve) => {
  const server = net.createServer()
  server.once('error', () => resolve(false))
  server.listen({ host: '::1', port: 0 }, () => server.close(() => resolve(true)))
})

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const inspect = (port) => ({
  port,
  listeners: io.listeners(port),
  probe: io.probe(port, { bind: true }),
})

test('a port nothing holds on any address is free', async () => {
  const port = await freePort()
  const state = inspect(port)
  assert.equal(portBusyReason(state), null, JSON.stringify(state))
  assert.equal(io.probe(port).connect['127.0.0.1'], 'refused')
})

// The 2026-11-14 holder: a Java (Gradle daemon) IPv6 socket on 127.0.0.1 that accepts and closes.
test('an IPv6 socket on 127.0.0.1 that accepts and closes is busy, though wildcard binds pass', async (t) => {
  if (!ipv6) return t.skip('no IPv6 on this host')
  const { port, pid } = await holder(t, '::ffff:127.0.0.1')
  const state = inspect(port)
  assert.equal(state.probe.connect['127.0.0.1'], 'closed')
  assert.equal(state.probe.bind['127.0.0.1'], 'in_use')
  if (process.platform === 'darwin') {
    // Why a wildcard free-port check misses it: these binds all succeed beside it on macOS.
    for (const host of ['0.0.0.0', '::', '::1'])
      assert.equal(state.probe.bind[host], 'ok', host)
  }
  if (state.listeners !== null)
    assert.ok(
      state.listeners.some((listener) => listener.pid === pid),
      JSON.stringify(state.listeners)
    )
  assert.match(
    portBusyReason(state),
    new RegExp(`^${port} .*connect 127\\.0\\.0\\.1 closed`)
  )
})

test('a listener on ::1 only is busy, though 127.0.0.1 refuses', async (t) => {
  if (!ipv6) return t.skip('no IPv6 on this host')
  const { port, pid } = await holder(t, '::1')
  const state = inspect(port)
  assert.equal(state.probe.connect['127.0.0.1'], 'refused')
  assert.equal(state.probe.connect['::1'], 'closed')
  assert.equal(state.probe.bind['::1'], 'in_use')
  if (state.listeners !== null)
    assert.deepEqual(
      state.listeners.map(({ pid: holderPid, type, address }) => ({
        holderPid,
        type,
        address,
      })),
      [{ holderPid: pid, type: 'IPv6', address: `[::1]:${port}` }]
    )
  assert.match(portBusyReason(state), /connect ::1 closed/)
})

test('a status check tells an HTTP runner from a holder that closes', async (t) => {
  const runner = await holder(t, '127.0.0.1', { http: true })
  assert.equal(io.probe(runner.port).connect['127.0.0.1'], 'http')
  const closer = await holder(t, '127.0.0.1')
  assert.equal(io.probe(closer.port).connect['127.0.0.1'], 'closed')
})

test('a port reservation holds against another live runner and is reclaimed from a dead one', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const alive = new Set([101, 202])
  const runner = (pid) =>
    createIosDriverPortIo({ reservations, pid, alive: (other) => alive.has(other) })
  const a = runner(101)
  const b = runner(202)
  assert.equal(a.reserve(17234, 'A'), true)
  assert.equal(b.reserve(17234, 'B'), false)
  // Only the holder releases it.
  b.release(17234)
  assert.equal(b.reserve(17234, 'B'), false)
  alive.delete(101)
  assert.equal(b.reserve(17234, 'B'), true)
  const { device, pid } = JSON.parse(
    fs.readFileSync(path.join(reservations, '17234.json'), 'utf8')
  )
  assert.deepEqual({ device, pid }, { device: 'B', pid: 202 })
  // Reserving a port it holds keeps its lock.
  assert.equal(b.reserve(17234, 'B'), true)
  b.release(17234)
  assert.equal(fs.existsSync(path.join(reservations, '17234.json')), false)
})

// r49 P2-3: a lock is its runner's by pid and token. Two io of one process never share a port,
// and only the io that holds a lock releases it.
test('a lock of this process under another token is live, and only its own io releases it', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const first = createIosDriverPortIo({ reservations, pid: 303, alive: () => false })
  const second = createIosDriverPortIo({ reservations, pid: 303, alive: () => false })
  assert.equal(first.reserve(17240, 'DEV-1'), true)
  assert.equal(second.reserve(17240, 'DEV-2'), false)
  second.release(17240)
  const lock = path.join(reservations, '17240.json')
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).device, 'DEV-1')
  first.release(17240)
  assert.equal(fs.existsSync(lock), false)
  // A lock of this pid with no token is an earlier process's (pid reuse): left behind.
  fs.writeFileSync(lock, `${JSON.stringify({ device: 'OLD', pid: 303 })}\n`)
  assert.equal(second.reserve(17240, 'DEV-2'), true)
  second.release(17240)
})

// r49 P2-3 (probe 3b): a runner killed after placing its takeover marker blocked the port for
// good. A marker records its runner's pid and token; a dead one passes the takeover on.
test('a takeover marker whose runner died passes the takeover to the next generation', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const lock = path.join(reservations, '17205.json')
  const raw = `${JSON.stringify({ device: 'DEAD', pid: 999999 })}\n`
  fs.writeFileSync(lock, raw)
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  const marker = (generation) =>
    path.join(reservations, `17205.takeover.${hash}.${generation}`)
  fs.writeFileSync(marker(0), `${JSON.stringify({ pid: 888888, token: 'gone' })}\n`)
  const live = new Set([101, 777])
  const runner = createIosDriverPortIo({
    reservations,
    pid: 101,
    alive: (other) => live.has(other),
  })
  assert.equal(runner.reserve(17205, 'DEV-A'), true)
  assert.deepEqual(fs.readdirSync(reservations), ['17205.json'])
  runner.release(17205)
  // A live runner's marker stops the takeover: it is that runner's to finish.
  fs.writeFileSync(lock, raw)
  fs.writeFileSync(marker(0), `${JSON.stringify({ pid: 777, token: 'busy' })}\n`)
  assert.equal(runner.reserve(17205, 'DEV-A'), false)
  assert.equal(fs.readFileSync(lock, 'utf8'), raw)
  // r52 P3-1: five dead generations no longer block the port; the winner removes them all.
  fs.rmSync(marker(0))
  const dead = `${JSON.stringify({ pid: 888888, token: 'gone' })}\n`
  for (const generation of [0, 1, 2, 3, 4]) fs.writeFileSync(marker(generation), dead)
  assert.equal(runner.reserve(17205, 'DEV-A'), true)
  assert.deepEqual(fs.readdirSync(reservations), ['17205.json'])
  runner.release(17205)
  // A runaway walk fails with its own error and leaves the lock and the dead markers.
  fs.writeFileSync(lock, raw)
  for (const generation of [0, 1, 2]) fs.writeFileSync(marker(generation), dead)
  const capped = createIosDriverPortIo({
    reservations,
    pid: 101,
    alive: (other) => live.has(other),
    markerLimit: 3,
  })
  assert.throws(() => capped.reserve(17205, 'DEV-A'), {
    code: 'maestro_driver_port_takeover_runaway',
  })
  assert.equal(fs.readFileSync(lock, 'utf8'), raw)
  assert.equal(fs.readdirSync(reservations).length, 4)
})

// r49 mutant M14b: a takeover that removed the dead lock and linked a new one left the port
// without a lock in between, where any runner could claim it.
test('a lock is never absent while it is taken over', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const lock = path.join(reservations, '17206.json')
  fs.writeFileSync(lock, `${JSON.stringify({ device: 'DEAD', pid: 999999 })}\n`)
  const absent = []
  let watching = false
  const files = new Proxy(fs, {
    get(target, name) {
      const value = target[name]
      if (typeof value !== 'function') return value
      return (...args) => {
        if (watching && !fs.existsSync(lock)) absent.push(String(name))
        if (name === 'linkSync' && String(args[1]).includes('.takeover.')) watching = true
        const result = value.apply(target, args)
        if (watching && !fs.existsSync(lock)) absent.push(`after ${String(name)}`)
        return result
      }
    },
  })
  const runner = createIosDriverPortIo({
    reservations,
    pid: 101,
    alive: () => false,
    files,
  })
  assert.equal(runner.reserve(17206, 'DEV-A'), true)
  assert.equal(watching, true, 'the takeover ran')
  assert.deepEqual(absent, [])
})

// r49 P3-2: a filesystem without hard links fails with its own error.
test('a filesystem without hard links fails as maestro_driver_port_lock_unsupported', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  for (const code of ['EPERM', 'EOPNOTSUPP']) {
    const files = {
      ...fs,
      linkSync: () => {
        throw Object.assign(new Error(code), { code })
      },
    }
    const runner = createIosDriverPortIo({ reservations, pid: 101, files })
    assert.throws(() => runner.reserve(17207, 'DEV-A'), {
      code: 'maestro_driver_port_lock_unsupported',
      message: new RegExp(`^maestro_driver_port_lock_unsupported: ${code}`),
    })
    assert.deepEqual(fs.readdirSync(reservations), [])
  }
})

// r48 P2-3 (probe F4): two runners that both found a dead runner's lock both removed it and
// both held the port. Runner B takes the stale lock while runner A is between reading it and
// taking it over.
test('a stale lock is taken over by one runner only', (t) => {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const lock = path.join(reservations, '17234.json')
  fs.writeFileSync(lock, `${JSON.stringify({ device: 'DEV-X', pid: 111111 })}\n`)
  const live = new Set([101, 202])
  const runnerB = createIosDriverPortIo({
    reservations,
    pid: 202,
    alive: (other) => live.has(other),
  })
  let raced = false
  let resB
  const runnerA = createIosDriverPortIo({
    reservations,
    pid: 101,
    alive: (other) => {
      if (other === 111111 && !raced) {
        raced = true
        resB = runnerB.reserve(17234, 'DEV-B')
      }
      return live.has(other)
    },
  })
  const resA = runnerA.reserve(17234, 'DEV-A')
  assert.equal(raced, true)
  assert.deepEqual([resA, resB], [false, true])
  assert.deepEqual(
    (({ device, pid }) => ({ device, pid }))(JSON.parse(fs.readFileSync(lock, 'utf8'))),
    { device: 'DEV-B', pid: 202 }
  )
  // No takeover marker or temporary file is left behind.
  assert.deepEqual(fs.readdirSync(reservations), ['17234.json'])
  // A lock with unreadable content counts as left behind and is taken over too.
  fs.writeFileSync(lock, '{"dev')
  live.delete(202)
  assert.equal(runnerA.reserve(17234, 'DEV-A'), true)
  assert.deepEqual(fs.readdirSync(reservations), ['17234.json'])
  runnerA.release(17234)
  assert.deepEqual(fs.readdirSync(reservations), [])
})

// r48 mutant M9a: stop must never search for runners by anything but a UDID, since the device
// goes into a pgrep pattern.
test('stop searches for runners of a UDID only', () => {
  const spawned = []
  const stopper = createIosDriverPortIo({
    spawn: (command, args) => {
      spawned.push([command, ...args].join(' '))
      return { status: 1, stdout: '' }
    },
  })
  for (const device of [
    'DEV-A',
    '.*',
    '',
    '679BE700-51A7-489F-89D1-E509778C6C6',
    undefined,
  ])
    assert.deepEqual(stopper.stop(device), { stopped: 0 })
  assert.deepEqual(spawned, [])
  stopper.stop('679BE700-51A7-489F-89D1-E509778C6C63')
  assert.deepEqual(spawned, [
    'pgrep -f xcodebuild test-without-building.*679BE700-51A7-489F-89D1-E509778C6C63',
  ])
})

test('only the runner app of this simulator counts as its runner', () => {
  const udid = '679BE700-51A7-489F-89D1-E509778C6C63'
  const app = `/Users/x/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/A/maestro-driver-iosUITests-Runner.app/maestro-driver-iosUITests-Runner`
  assert.equal(isRunnerOf(app, udid), true)
  assert.equal(isRunnerOf(app, '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0'), false)
  assert.equal(isRunnerOf('/usr/bin/java GradleDaemon', udid), false)
})
