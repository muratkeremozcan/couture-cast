import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INSTALL_CLIENT_TIMEOUT_MS,
  finishOwnedStartup,
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
