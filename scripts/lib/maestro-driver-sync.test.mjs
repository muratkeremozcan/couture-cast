// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  createSyncMaestro,
  waitForPortFree,
  waitOutStaleSessions,
} from './maestro-driver-sync.mjs'
import {
  createIosDriverPortIo,
  iosDriverPortCandidates,
} from './maestro-ios-driver-port.mjs'

const PACKAGES = 'package:dev.mobile.maestro\npackage:dev.mobile.maestro.test\n'
const INSTRUMENTATION =
  'instrumentation:dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner (target=dev.mobile.maestro)\n'

/** A device whose driver packages come and go as adb and Maestro act on them. */
function fakeDevice({ failures = [], installsOnFailure = true, outputs = [] } = {}) {
  const state = { installed: true, adb: [], maestro: [], log: [] }
  const adb = (args) => {
    state.adb.push(args.join(' '))
    if (args[2] === 'uninstall') state.installed = false
    if (args.join(' ') === 'shell pm list packages dev.mobile.maestro')
      return state.installed ? PACKAGES : ''
    if (args.join(' ') === 'shell pm list instrumentation')
      return state.installed ? INSTRUMENTATION : ''
    return ''
  }
  const maestro = (args, options) => {
    state.maestro.push({ args, options })
    const failure = failures.shift()
    const output = outputs.shift()
    // Maestro installs the driver when it is missing, and with --no-reinstall-driver keeps it;
    // a driver that dies at start can leave it half installed.
    if (!failure || installsOnFailure) state.installed = true
    if (failure) {
      const error = new Error(failure)
      if (output) Object.defineProperty(error, 'output', { value: output })
      throw error
    }
    return 'ok'
  }
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb,
    maestro,
    read: () => '',
    log: (message) => state.log.push(message),
  })
  return { state, run }
}

const flow = ['--device', 'emulator-5554', 'test', '-e', 'A=1', 'flow.yaml']
const read = ['--device', 'emulator-5554', 'hierarchy']

test('the first invocation removes the driver; later ones reuse it without reinstalling', () => {
  const { state, run } = fakeDevice()
  run(flow, { timeout: 240_000 })
  run(read)
  run(flow)
  // Only the first invocation uninstalls, the instrumentation app first.
  assert.deepEqual(
    state.adb.filter((call) => call.includes('uninstall')),
    [
      'shell pm uninstall dev.mobile.maestro.test',
      'shell pm uninstall dev.mobile.maestro',
    ]
  )
  assert.deepEqual(state.maestro[0].args, [
    '--device',
    'emulator-5554',
    'test',
    '--no-reinstall-driver',
    '--driver-host-port',
    '17001',
    '-e',
    'A=1',
    'flow.yaml',
  ])
  assert.deepEqual(state.maestro[0].options, { timeout: 240_000 })
  // hierarchy has no port option in Maestro 2.8.
  assert.deepEqual(state.maestro[1].args, [
    '--device',
    'emulator-5554',
    'hierarchy',
    '--no-reinstall-driver',
  ])
  // Every invocation first stops the driver an earlier one left running.
  assert.equal(
    state.adb.filter((call) => call === 'shell am force-stop dev.mobile.maestro').length,
    3
  )
})

test('a driver that went missing between invocations fails at once, and the next starts fresh', () => {
  const { state, run } = fakeDevice()
  run(flow)
  state.installed = false
  assert.throws(() => run(flow), /maestro_driver_not_ready:package dev\.mobile\.maestro/)
  assert.equal(state.maestro.length, 1)
  run(flow)
  assert.equal(state.adb.filter((call) => call.includes('uninstall')).length, 4)
})

test('a hierarchy read whose driver did not start is read once more; a flow is not rerun', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const reader = fakeDevice({ failures: [died] })
  assert.equal(reader.run(read), 'ok')
  assert.equal(reader.state.maestro.length, 2)
  assert.match(reader.state.log[0], /maestro_hierarchy_retry: DeviceServerDiedException/)
  // A second failure is the run's to report.
  const twice = fakeDevice({ failures: [died, died] })
  assert.throws(() => twice.run(read), /DeviceServerDiedException/)
  assert.equal(twice.state.maestro.length, 2)
  // A flow changes the app, so it is never repeated.
  const flowRun = fakeDevice({ failures: [died] })
  assert.throws(() => flowRun.run(flow), /DeviceServerDiedException/)
  assert.equal(flowRun.state.maestro.length, 1)
  // Any other hierarchy failure is not a driver start.
  const other = fakeDevice({ failures: ['live_font_hierarchy_invalid'] })
  assert.throws(() => other.run(read), /live_font_hierarchy_invalid/)
  assert.equal(other.state.maestro.length, 1)
})

// --- iOS: one XCUITest runner per simulator (Story 6.15 TEA, 2026-11-14 Settings swipe flake) ---

const SIM = '679BE700-51A7-489F-89D1-E509778C6C63'
const SIM_B = '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0'
const runnerCommand = (udid) =>
  `/Users/ci/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/A1/maestro-driver-iosUITests-Runner.app/maestro-driver-iosUITests-Runner`
const GRADLE =
  '/Library/Java/JavaVirtualMachines/jdk-23.jdk/Contents/Home/bin/java org.gradle.launcher.daemon.bootstrap.GradleDaemon'
const iosFlow = (udid) => ['--device', udid, 'test', '-e', 'A=1', 'swipe-up.yaml']
const iosRead = (udid) => ['--device', udid, 'hierarchy']

/**
 * A macOS host as the iOS lifecycle sees it through `spawn`: processes, their listening sockets
 * and what a connect to each gets, lsof, ps, pgrep and kill, and the Node port probe. Its Maestro
 * behaves as 2.8 does on iOS (LocalXCTestInstaller, read with javap from maestro-ios-driver.jar):
 * without --no-reinstall-driver it uninstalls the runner of the simulator and starts a new one,
 * and its exit (the shutdown hook's close()) uninstalls it again, killing the runner it started;
 * with the flag it reuses a runner that answers on --driver-host-port, starts one with
 * `xcodebuild test-without-building` when none does, and leaves it running at exit. A runner
 * that cannot bind its port never passes the status check.
 */
function fakeMac(t) {
  const reservations = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-driver-ports-'))
  t.after(() => fs.rmSync(reservations, { recursive: true, force: true }))
  const host = {
    reservations,
    spawned: [],
    calls: [],
    logs: [],
    slept: [],
    exits: [],
    processes: new Map(),
    nextPid: 5000,
    // A hook run inside the next Maestro call, before it returns.
    during: null,
  }
  /** `host` is 127.0.0.1, ::1, or * (both stacks, as a dual-stack wildcard socket). */
  host.start = (command, sockets = []) => {
    const pid = host.nextPid++
    host.processes.set(pid, { command, sockets })
    return pid
  }
  const socketsOn = (port) =>
    [...host.processes].flatMap(([pid, { command, sockets }]) =>
      sockets
        .filter((socket) => socket.port === port)
        .map((socket) => ({ pid, command, ...socket }))
    )
  host.socketsOn = socketsOn
  const reaches = (socket, address) => socket.host === address || socket.host === '*'
  const lsofName = (socket) =>
    socket.host === '*'
      ? `*:${socket.port}`
      : socket.host === '::1'
        ? `[::1]:${socket.port}`
        : `127.0.0.1:${socket.port}`
  const wildcard = (address) => address === '0.0.0.0' || address === '::'
  const probe = (args) => {
    if (host.probeFails) return { status: 1, stdout: '' }
    const sockets = socketsOn(Number(args[2]))
    const connect = {}
    for (const address of ['127.0.0.1', '::1'])
      connect[address] = sockets.find((s) => reaches(s, address))?.answer ?? 'refused'
    const bind = {}
    if (args[3] === 'bind')
      for (const address of ['127.0.0.1', '::1', '0.0.0.0', '::'])
        bind[address] = sockets.some(
          (s) => s.host === address || (s.host === '*' && wildcard(address))
        )
          ? 'in_use'
          : 'ok'
    return { status: 0, stdout: JSON.stringify({ connect, bind }) }
  }
  const lsof = (args) => {
    const sockets = socketsOn(Number(args[1].slice('-iTCP:'.length)))
    const family = (s) => (s.host === '127.0.0.1' && !s.v6 ? 'IPv4' : 'IPv6')
    const stdout = sockets
      .map((s) => `p${s.pid}\nf3\nt${family(s)}\nn${lsofName(s)}\n`)
      .join('')
    return { status: sockets.length ? 0 : 1, stdout }
  }
  const pgrep = (args) => {
    const pattern = new RegExp(args[1])
    const pids = [...host.processes]
      .filter(([, p]) => pattern.test(p.command))
      .map(([pid]) => pid)
    return { status: pids.length ? 0 : 1, stdout: pids.map((pid) => `${pid}\n`).join('') }
  }
  const kill = (args) => {
    for (const pid of args.slice(1).map(Number)) {
      const killed = host.processes.get(pid)
      host.processes.delete(pid)
      // The runner app goes with the xcodebuild that runs it.
      if (killed?.runner) host.processes.delete(killed.runner)
    }
    return { status: 0, stdout: '' }
  }
  const commands = {
    lsof,
    pgrep,
    kill,
    ps: (args) => ({
      status: 0,
      stdout: `${host.processes.get(Number(args.at(-1)))?.command ?? ''}\n`,
    }),
    xcodebuild: () => ({ status: 0, stdout: '' }),
  }
  host.spawn = (command, args = []) => {
    const node = command === process.execPath
    host.spawned.push(
      node ? `node -e <probe> ${args.slice(2).join(' ')}` : [command, ...args].join(' ')
    )
    if (node) return probe(args)
    if (!commands[command]) throw new Error(`unexpected spawn: ${command}`)
    return commands[command](args)
  }
  host.maestro = (args) => {
    host.calls.push(args)
    const device = args[args.indexOf('--device') + 1]
    const port = Number(args[args.indexOf('--driver-host-port') + 1])
    const reinstall = !args.includes('--no-reinstall-driver')
    // uninstall(): the runner app of this simulator and the xcodebuild that runs it.
    const uninstall = () => {
      for (const [pid, { command }] of [...host.processes])
        if (command === runnerCommand(device) || command.includes(`id=${device}`))
          host.processes.delete(pid)
    }
    if (reinstall) uninstall()
    const answering = socketsOn(port).some(
      (s) => s.answer === 'http' && s.command === runnerCommand(device)
    )
    if (!answering) {
      // startXCTestRunner: install and start the runner with xcodebuild.
      const xcodebuild = [
        'test-without-building',
        '-xctestrun',
        `/var/folders/T/${device}/maestro-driver-ios-config.xctestrun`,
        '-destination',
        `id=${device}`,
      ]
      host.spawn('xcodebuild', xcodebuild)
      const build = host.start(`xcodebuild ${xcodebuild.join(' ')}`)
      if (socketsOn(port).some((s) => s.host === '127.0.0.1' || s.host === '*')) {
        // errno 48: the runner never listens and the status check never passes.
        throw Object.assign(
          new Error('live_font_command_failed:maestro swipe-up.yaml:ETIMEDOUT:'),
          {
            output: 'IOException: unexpected end of stream',
          }
        )
      }
      host.processes.get(build).runner = host.start(runnerCommand(device), [
        { port, host: '*', answer: 'http' },
      ])
    }
    const during = host.during
    host.during = null
    try {
      during?.()
      return args.includes('hierarchy') ? '{"id":"root"}' : 'ok'
    } finally {
      // close(): with reinstallDriver set, Maestro uninstalls the runner as it exits.
      if (reinstall) uninstall()
    }
  }
  host.run = (device, { pid = process.pid, alive = () => true } = {}) =>
    createSyncMaestro({
      platform: 'ios',
      device,
      adb: () => assert.fail('no adb on iOS'),
      maestro: host.maestro,
      log: (message) => host.logs.push(message),
      ios: {
        io: createIosDriverPortIo({ spawn: host.spawn, reservations, pid, alive }),
        onExit: (fn) => host.exits.push(fn),
        now: () => host.slept.reduce((sum, ms) => sum + ms, 0),
        sleep: (ms) => host.slept.push(ms),
      },
    })
  host.xcodebuilds = () => host.spawned.filter((line) => line.startsWith('xcodebuild '))
  return host
}

test('iOS: a second Maestro call on the same simulator starts no xcodebuild; hierarchy reads reuse the runner', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  const [port] = iosDriverPortCandidates(SIM)
  run(iosFlow(SIM), { timeout: 240_000 })
  assert.equal(mac.xcodebuilds().length, 1)
  const before = mac.spawned.length
  assert.equal(run(iosRead(SIM)), '{"id":"root"}')
  run(iosFlow(SIM))
  // Red: neither later call started an xcodebuild; only the status checks ran.
  assert.equal(mac.xcodebuilds().length, 1)
  assert.deepEqual(mac.spawned.slice(before), [
    `node -e <probe> ${port} status`,
    `node -e <probe> ${port} status`,
  ])
  // Every call pins the port and passes --no-reinstall-driver: the first starts the runner and
  // leaves it running, later ones reuse it.
  assert.deepEqual(mac.calls, [
    [
      '--device',
      SIM,
      '--driver-host-port',
      String(port),
      'test',
      '--no-reinstall-driver',
      '-e',
      'A=1',
      'swipe-up.yaml',
    ],
    [
      '--device',
      SIM,
      '--driver-host-port',
      String(port),
      'hierarchy',
      '--no-reinstall-driver',
    ],
    [
      '--device',
      SIM,
      '--driver-host-port',
      String(port),
      'test',
      '--no-reinstall-driver',
      '-e',
      'A=1',
      'swipe-up.yaml',
    ],
  ])
  // The first call checked the port free on every address before Maestro started.
  assert.deepEqual(mac.spawned.slice(0, 4), [
    `pgrep -f xcodebuild test-without-building.*${SIM}`,
    `lsof -nP -iTCP:${port} -sTCP:LISTEN -Fptn`,
    `node -e <probe> ${port} bind`,
    `xcodebuild test-without-building -xctestrun /var/folders/T/${SIM}/maestro-driver-ios-config.xctestrun -destination id=${SIM}`,
  ])
})

// Nightly run 43707223465 and dispatches 43740466527, 43746880534: the first call of a run had
// no --no-reinstall-driver, so Maestro's exit killed the runner it started and every later call
// found it gone and started another, 374 restarts in one 120 min proof.
test('iOS: Maestro 2.8 kills a runner started without --no-reinstall-driver; the run keeps one for every call', (t) => {
  const bare = fakeMac(t)
  const [port] = iosDriverPortCandidates(SIM)
  bare.maestro(['--device', SIM, '--driver-host-port', String(port), 'test', 'a.yaml'])
  assert.deepEqual(
    [...bare.processes.values()],
    [],
    'no runner outlives a reinstall call'
  )
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  for (let call = 0; call < 5; call += 1) run(call % 2 ? iosRead(SIM) : iosFlow(SIM))
  // Red before the fix: five xcodebuilds and four maestro_ios_driver_gone lines.
  assert.equal(mac.xcodebuilds().length, 1)
  assert.deepEqual(
    mac.logs.filter((line) => line.startsWith('maestro_ios_driver_')),
    []
  )
  assert.ok(mac.calls.every((args) => args.includes('--no-reinstall-driver')))
  assert.ok(
    [...mac.processes.values()].some(({ command }) => command === runnerCommand(SIM)),
    'the runner is still up after the last call'
  )
})

test('iOS: the port is derived from the UDID, and two simulators get distinct ports even when theirs collide', (t) => {
  // Deterministic, inside the safe range, and distinct for the two simulators of a local run.
  assert.deepEqual(
    iosDriverPortCandidates(SIM),
    iosDriverPortCandidates(SIM.toLowerCase())
  )
  for (const port of [...iosDriverPortCandidates(SIM), ...iosDriverPortCandidates(SIM_B)])
    assert.ok(port >= 17200 && port < 17500, String(port))
  assert.equal(new Set(iosDriverPortCandidates(SIM)).size, 8)
  assert.notEqual(iosDriverPortCandidates(SIM)[0], iosDriverPortCandidates(SIM_B)[0])
  // Two UDIDs whose derived ports collide.
  const seen = new Map()
  let pair
  for (let n = 0; !pair; n += 1) {
    const udid = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0').toUpperCase()}`
    const first = iosDriverPortCandidates(udid)[0]
    if (seen.has(first)) pair = [seen.get(first), udid]
    else seen.set(first, udid)
  }
  const [a, b] = pair
  const [shared, next] = iosDriverPortCandidates(a)
  // Both runners reserve before they check, so the second skips the first's port even before the
  // first's runner listens on it.
  const mac = fakeMac(t)
  const first = mac.run(a, { pid: 101 })
  const second = mac.run(b, { pid: 202 })
  mac.during = () => second(iosFlow(b))
  first(iosFlow(a))
  assert.equal(mac.calls[0][3], String(shared))
  assert.equal(mac.calls[1][3], String(iosDriverPortCandidates(b)[1]))
  assert.equal(iosDriverPortCandidates(b)[1], next)
  assert.match(
    mac.logs.join('\n'),
    new RegExp(
      `maestro_ios_driver_port: ${next} after ${shared} reserved by another runner`
    )
  )
  // A runner the reservation does not cover (an earlier run's) is seen listening and skipped.
  const other = fakeMac(t)
  other.start(runnerCommand(a), [{ port: shared, host: '*', answer: 'http' }])
  other.run(b)(iosFlow(b))
  assert.equal(other.calls[0][3], String(next))
})

test('iOS: a failed flow stops its runner and the next call starts a fresh one', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  run(iosFlow(SIM))
  mac.during = () => {
    throw new Error('live_font_command_failed:maestro swipe-up.yaml:1:Assertion is false')
  }
  assert.throws(() => run(iosFlow(SIM)), /Assertion is false/)
  // The runner and its xcodebuild are gone, stopped through pgrep and kill of this simulator only.
  assert.deepEqual([...mac.processes.values()], [])
  assert.ok(mac.spawned.includes(`pgrep -f xcodebuild test-without-building.*${SIM}`))
  assert.ok(mac.spawned.some((line) => /^kill -TERM \d+$/.test(line)))
  run(iosFlow(SIM))
  assert.ok(mac.calls[2].includes('--no-reinstall-driver'))
  assert.equal(mac.xcodebuilds().length, 2)
  assert.equal(mac.calls[2][3], mac.calls[0][3], 'the same port, free again')
})

test('iOS: a pinned port held on IPv6 only moves to the next candidate; none free refuses with maestro_driver_port_in_use', (t) => {
  const ports = iosDriverPortCandidates(SIM)
  const mac = fakeMac(t)
  // Only ::1: invisible to a 127.0.0.1 check, as qemu and netsimd listen on this host.
  mac.start('/opt/qemu-system-aarch64', [
    { port: ports[0], host: '::1', answer: 'closed' },
  ])
  // The Gradle daemon of the 2026-11-14 run: an IPv6 socket on 127.0.0.1.
  mac.start(GRADLE, [{ port: ports[1], host: '127.0.0.1', v6: true, answer: 'closed' }])
  mac.run(SIM)(iosFlow(SIM))
  assert.equal(mac.calls[0][3], String(ports[2]))
  const log = mac.logs.join('\n')
  assert.match(log, new RegExp(`${ports[0]} \\[::1\\]:${ports[0]} pid \\d+ /opt/qemu`))
  assert.match(
    log,
    new RegExp(
      `${ports[1]} 127\\.0\\.0\\.1:${ports[1]} pid \\d+ .*GradleDaemon.*connect 127\\.0\\.0\\.1 closed`
    )
  )
  // Every candidate held: nothing starts and the refusal names each.
  const full = fakeMac(t)
  for (const port of ports)
    full.start('/usr/sbin/other', [{ port, host: '::1', answer: 'closed' }])
  assert.throws(
    () => full.run(SIM)(iosFlow(SIM)),
    (error) =>
      error.code === 'maestro_driver_port_in_use' &&
      error.message.startsWith('maestro_driver_port_in_use:') &&
      ports.every((port) => error.message.includes(`[::1]:${port}`))
  )
  assert.deepEqual(full.calls, [])
  assert.deepEqual(full.xcodebuilds(), [])
  // A holder lsof cannot see (another user's) is still found by the probes.
  const hidden = fakeMac(t)
  const real = hidden.spawn
  hidden.spawn = (command, args) =>
    command === 'lsof' ? { status: 1, stdout: '' } : real(command, args)
  hidden.start('/usr/sbin/root-owned', [
    { port: ports[0], host: '::1', answer: 'closed' },
  ])
  hidden.run(SIM)(iosFlow(SIM))
  assert.equal(hidden.calls[0][3], String(ports[1]))
})

test('iOS: a status check that is accepted and closed fails at once with maestro_driver_port_in_use', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  const [port] = iosDriverPortCandidates(SIM)
  run(iosFlow(SIM))
  // The runner died and a Gradle daemon took its port.
  mac.spawn('kill', ['-TERM', ...[...mac.processes.keys()].map(String)])
  mac.start(GRADLE, [{ port, host: '127.0.0.1', v6: true, answer: 'closed' }])
  assert.throws(
    () => run(iosFlow(SIM)),
    new RegExp(
      `^Error: maestro_driver_port_in_use:${port} 127\\.0\\.0\\.1:${port} pid \\d+ .*GradleDaemon, connect 127\\.0\\.0\\.1 closed$`
    )
  )
  // No Maestro call, no 2 min of polling, no wait at all.
  assert.equal(mac.calls.length, 1)
  assert.deepEqual(mac.slept, [])
  // The next call starts a fresh runner on the next free candidate.
  run(iosFlow(SIM))
  assert.equal(mac.calls[1][3], String(iosDriverPortCandidates(SIM)[1]))
  assert.ok(mac.calls[1].includes('--no-reinstall-driver'))
})

test('iOS: a failed call whose port another process holds says so, keeping the output', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  const [port] = iosDriverPortCandidates(SIM)
  run(iosFlow(SIM))
  mac.during = () => {
    mac.start('/usr/bin/nc -l ::1', [{ port, host: '::1', answer: 'closed' }])
    throw Object.assign(
      new Error('live_font_command_failed:maestro swipe-up.yaml:ETIMEDOUT:'),
      {
        output: 'whole output',
      }
    )
  }
  assert.throws(
    () => run(iosFlow(SIM)),
    (error) =>
      error.code === 'maestro_driver_port_in_use' &&
      error.message.startsWith(`maestro_driver_port_in_use:${port} [::1]:${port} pid`) &&
      error.message.endsWith(
        '; live_font_command_failed:maestro swipe-up.yaml:ETIMEDOUT:'
      ) &&
      error.output === 'whole output'
  )
})

// r48 P2-3: a port probe that throws in the failure path hid the Maestro failure behind it.
test('iOS: a failed call whose port probe throws keeps the Maestro failure', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  run(iosFlow(SIM))
  const failure = Object.assign(new Error('real_maestro_failure'), {
    output: 'whole output',
  })
  mac.during = () => {
    mac.probeFails = true
    throw failure
  }
  assert.throws(
    () => run(iosFlow(SIM)),
    (error) => error === failure
  )
  assert.ok(
    mac.logs.some((line) => line.startsWith('maestro_driver_port_probe_failed:')),
    mac.logs.join('\n')
  )
  // The runner is still stopped, so the next call starts a fresh one.
  mac.probeFails = false
  const before = mac.xcodebuilds().length
  run(iosFlow(SIM))
  assert.equal(mac.xcodebuilds().length, before + 1)
})

test('iOS: a runner that went away is restarted on its port; exit stops it and frees the port', (t) => {
  const mac = fakeMac(t)
  const run = mac.run(SIM)
  const [port] = iosDriverPortCandidates(SIM)
  run(iosFlow(SIM))
  const lock = path.join(mac.reservations, `${port}.json`)
  const { device, pid } = JSON.parse(fs.readFileSync(lock, 'utf8'))
  assert.deepEqual({ device, pid }, { device: SIM, pid: process.pid })
  mac.spawn('kill', ['-TERM', ...[...mac.processes.keys()].map(String)])
  run(iosFlow(SIM))
  assert.ok(mac.calls[1].includes('--no-reinstall-driver'))
  assert.equal(mac.calls[1][3], String(port))
  assert.match(mac.logs.join('\n'), new RegExp(`maestro_ios_driver_gone: ${port}`))
  // This simulator's runner left by an earlier run is stopped and waited for, not skipped.
  const leftover = fakeMac(t)
  leftover.start(runnerCommand(SIM), [{ port, host: '*', answer: 'http' }])
  leftover.run(SIM)(iosFlow(SIM))
  assert.equal(leftover.calls[0][3], String(port))
  // Exit: the runner is stopped and the reservation released.
  assert.equal(mac.exits.length, 1)
  mac.exits[0]()
  assert.deepEqual([...mac.processes.values()], [])
  assert.equal(fs.existsSync(lock), false)
})

test('a stale session record is waited out; a live one stops the run', () => {
  let clock = 100_000
  const slept = []
  const staleRecord = 'ANDROID_emulator-5554_abc=90000\n'
  waitOutStaleSessions({
    device: 'emulator-5554',
    read: () => staleRecord,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms)
      clock += ms
    },
  })
  assert.ok(slept.length >= 1)
  assert.ok(clock - 90_000 >= 21_000, 'waited until the record aged out')
  let beat = 99_000
  assert.throws(
    () =>
      waitOutStaleSessions({
        device: 'emulator-5554',
        read: () => `ANDROID_emulator-5554_live=${beat}\n`,
        now: () => beat + 1_000,
        sleep: () => {
          beat += 5_000
        },
      }),
    /maestro_session_live:live/
  )
  // Another device's record does not hold this one.
  waitOutStaleSessions({
    device: 'emulator-5554',
    read: () => 'ANDROID_emulator-5556_x=99999\n',
    now: () => 100_000,
    sleep: () => assert.fail('no wait for another device'),
  })
})

test('before an invocation, a session record a failed start left is waited out', () => {
  // The failed start left its record at 95 s; the next invocation comes at 100 s.
  let clock = 100_000
  const calls = []
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb: () => '',
    maestro: (args) => calls.push({ args, at: clock }),
    read: () => 'ANDROID_emulator-5554_dead=95000\n',
    now: () => clock,
    sleep: (ms) => {
      clock += ms
    },
    log: () => undefined,
  })
  run(flow)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].at - 95_000 >= 21_000, `ran at ${calls[0].at}`)
})

// Antigravity r29 P2: a first run that died before installing the driver must not leave the next
// one checking a driver that was never there.
test('a run that died before installing the driver makes the next one start fresh', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const reader = fakeDevice({ failures: [died], installsOnFailure: false })
  assert.equal(reader.run(read), 'ok')
  assert.equal(reader.state.maestro.length, 2)
  // Both attempts started from a removed driver.
  assert.equal(reader.state.adb.filter((call) => call.includes('uninstall')).length, 4)
  const flows = fakeDevice({ failures: [died], installsOnFailure: false })
  assert.throws(() => flows.run(flow), /DeviceServerDiedException/)
  assert.equal(flows.run(flow), 'ok')
  assert.equal(flows.state.adb.filter((call) => call.includes('uninstall')).length, 4)
})

test('only the hierarchy subcommand is retried, read from its position', () => {
  const died = "DeviceServerDiedException: Device server died during 'deviceInfo'"
  const named = fakeDevice({ failures: [died] })
  const args = ['--device', 'emulator-5554', 'test', '-e', 'hierarchy', 'flow.yaml']
  assert.throws(() => named.run(args), /DeviceServerDiedException/)
  assert.equal(named.state.maestro.length, 1)
})

test('a driver start cause past the kept tail of the message is read from the whole output', () => {
  const long = fakeDevice({
    failures: [
      'live_font_command_failed:maestro hierarchy:1:...tail of a long traceback',
    ],
    outputs: ["DeviceServerDiedException: Device server died during 'deviceInfo'\n..."],
  })
  assert.equal(long.run(read), 'ok')
  assert.equal(long.state.maestro.length, 2)
})

test('maestro test waits for its pinned port to be free; hierarchy does not', () => {
  const held = '  1: 0100007F:4269 00000000:0000 0A 00000000:00000000\n'
  let reads = 0
  let installed = false
  const run = createSyncMaestro({
    platform: 'android',
    device: 'emulator-5554',
    adb: (args) => {
      if (args.includes('/proc/net/tcp')) return reads++ < 2 ? held : ''
      if (args.includes('uninstall')) installed = false
      if (args.includes('packages')) return installed ? PACKAGES : ''
      if (args.includes('instrumentation')) return installed ? INSTRUMENTATION : ''
      return ''
    },
    maestro: () => {
      installed = true
      return 'ok'
    },
    read: () => '',
    sleep: () => undefined,
    log: () => undefined,
  })
  run(read)
  assert.equal(reads, 0)
  run(flow)
  assert.equal(reads, 3)
  let clock = 0
  assert.throws(
    () =>
      waitForPortFree({
        adb: () => held,
        port: 17001,
        now: () => clock,
        sleep: (ms) => {
          clock += ms
        },
      }),
    /maestro_driver_port_busy:17001/
  )
  // A device that hides its socket table is not checked.
  waitForPortFree({
    adb: () => {
      throw new Error('permission denied')
    },
    port: 17001,
    log: () => undefined,
  })
})
