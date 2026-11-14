// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The port probes against real sockets on this host: holders run in child processes, since the
// probe is synchronous and would block a holder in this one.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
  assert.equal(runner(101).reserve(17234, 'A'), true)
  assert.equal(runner(202).reserve(17234, 'B'), false)
  // Only the holder releases it.
  runner(202).release(17234)
  assert.equal(runner(202).reserve(17234, 'B'), false)
  alive.delete(101)
  assert.equal(runner(202).reserve(17234, 'B'), true)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(reservations, '17234.json'), 'utf8')),
    {
      device: 'B',
      pid: 202,
    }
  )
  runner(202).release(17234)
  assert.equal(fs.existsSync(path.join(reservations, '17234.json')), false)
})

test('only the runner app of this simulator counts as its runner', () => {
  const udid = '679BE700-51A7-489F-89D1-E509778C6C63'
  const app = `/Users/x/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/A/maestro-driver-iosUITests-Runner.app/maestro-driver-iosUITests-Runner`
  assert.equal(isRunnerOf(app, udid), true)
  assert.equal(isRunnerOf(app, '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0'), false)
  assert.equal(isRunnerOf('/usr/bin/java GradleDaemon', udid), false)
})
