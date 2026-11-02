import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOST_LOAD_POLICY,
  INSTALL_CLIENT_TIMEOUT_MS,
  finishOwnedStartup,
  settleHostLoad,
} from './native-ios-startup-probe.mjs'

const device = 'A63391DE-17A2-4B16-9C93-16B986580C99'
function fixture(prepareForFlow, gateFailure = false) {
  const events = []
  return {
    events,
    input: {
      device,
      prepareForFlow,
      appPath: '/owned/client.app',
      command: (operation, _binary, args, options) => {
        events.push({ operation, args, options })
      },
      sample: (label) => {
        events.push({ operation: label })
      },
      quiesce: async (owned) => {
        assert.equal(owned, device)
        events.push({ operation: 'gate' })
        if (gateFailure) throw new Error('ios_quiesce_cap_hit')
      },
      settleHost: async () => {
        events.push({ operation: 'host-load' })
      },
    },
  }
}

test('the native-flow mode installs the real client before gating and retains the ready exact device', async () => {
  const f = fixture(true)
  await finishOwnedStartup(f.input)
  assert.deepEqual(
    f.events.map((e) => e.operation),
    [
      'boot-device',
      'bootstatus',
      'after-simulator-boot',
      'install-client',
      'gate',
      'host-load',
      'before-first-flow',
    ]
  )
  assert.deepEqual(f.events.find((e) => e.operation === 'install-client').args, [
    'simctl',
    'install',
    device,
    '/owned/client.app',
  ])
})

test('a failed gate prevents flow readiness and deletes only the owned device', async () => {
  const f = fixture(true, true)
  await assert.rejects(finishOwnedStartup(f.input), /ios_quiesce_cap_hit/)
  assert.equal(
    f.events.some((e) => e.operation === 'before-first-flow'),
    false
  )
  assert.deepEqual(f.events.at(-1).args, ['simctl', 'delete', device])
  assert.equal(f.events.at(-1).options.fatal, false)
})

test('startup-only probes always delete their device and never install or execute a native flow', async () => {
  const f = fixture(false)
  await finishOwnedStartup(f.input)
  assert.equal(
    f.events.some((e) => e.operation === 'install-client'),
    false
  )
  assert.equal(f.events.at(-1).operation, 'delete-device')
})

test('failed postboot diagnostics still reach the unchanged CPU gate and native-flow readiness', async () => {
  const f = fixture(true)
  f.input.sample = () => {
    throw Object.assign(new Error('ps failed'), {
      code: 'EACCES',
      stderr: 'exact ps stderr',
    })
  }
  await finishOwnedStartup(f.input)
  assert.equal(
    f.events.some((e) => e.operation === 'gate'),
    true
  )
  assert.equal(
    f.events.some((e) => e.operation === 'install-client'),
    true
  )
  assert.equal(
    f.events.some((e) => e.operation === 'delete-device'),
    false
  )
})

// Runs 28 to 33 installed this 140 MB client in 24 to 33 s. On a fresh shard host (load 312 to 516,
// 170 MB free) the same install passed the 60 s default and was killed: owned_simulator_command_failed:
// install-client:ETIMEDOUT. The install is one bounded attempt with the budget bootstatus has.
test('the client install has its own budget of at least five times the slowest measured install', async () => {
  const f = fixture(true)
  await finishOwnedStartup(f.input)
  const timeout = f.events.find((e) => e.operation === 'install-client').options?.timeout
  assert.equal(timeout, INSTALL_CLIENT_TIMEOUT_MS)
  assert.ok(INSTALL_CLIENT_TIMEOUT_MS >= 5 * 32_897)
  assert.equal(f.events.find((e) => e.operation === 'bootstatus').options.timeout, 300000)
})

function loadClock(loads) {
  let t = 0
  const sleeps = []
  return {
    sleeps,
    loadavg: () => loads[Math.min(sleeps.length, loads.length - 1)],
    sleep: async (ms) => {
      sleeps.push(ms)
      t += ms
    },
    now: () => t,
  }
}

test('a quiet host starts the first flow after one confirming sample', async () => {
  const clock = loadClock([35, 36])
  const record = await settleHostLoad(clock)
  assert.equal(clock.sleeps.length, 1)
  assert.deepEqual(record, {
    maxLoad1: 80,
    startLoad1: 35,
    load1: 36,
    waitedSeconds: 5,
    outcome: 'settled',
  })
})

test('a single low reading between high ones does not count as settled', async () => {
  const clock = loadClock([136, 79, 130, 78, 70])
  const record = await settleHostLoad(clock)
  assert.equal(clock.sleeps.length, 4)
  assert.equal(record.load1, 70)
  assert.equal(record.outcome, 'settled')
})

test('a saturated host waits until load1 falls to the bound', async () => {
  // The decay a failed first flow saw: 136 at start, 59 two minutes later.
  const clock = loadClock([136, 120, 101, 88, 80, 74])
  const record = await settleHostLoad(clock)
  assert.equal(clock.sleeps.length, 5)
  assert.ok(clock.sleeps.every((ms) => ms === HOST_LOAD_POLICY.pollSeconds * 1000))
  assert.equal(record.outcome, 'settled')
  assert.equal(record.startLoad1, 136)
  assert.equal(record.load1, 74)
  assert.equal(record.waitedSeconds, 25)
})

test('a host that never settles starts after the cap and says so', async () => {
  const clock = loadClock([200])
  const record = await settleHostLoad(clock)
  assert.equal(record.outcome, 'cap')
  assert.equal(record.waitedSeconds, HOST_LOAD_POLICY.maxWaitSeconds)
})

test('startup-only probes never wait on host load', async () => {
  const f = fixture(false)
  await finishOwnedStartup(f.input)
  assert.equal(
    f.events.some((e) => e.operation === 'host-load'),
    false
  )
})
