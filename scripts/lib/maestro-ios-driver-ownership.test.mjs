import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  IOS_DRIVER_PORT,
  reclaimIosDriverPort,
  recordOwnedIosDrivers,
  trackOwnedIosDrivers,
} from './maestro-ios-driver-ownership.mjs'

const driver =
  '/usr/bin/xcodebuild test-without-building -xctestrun /tmp/maestro-driver-ios-config.xctestrun'
const runner = '/Users/ci/Library/Developer/Xcode/maestro-driver-iosUITests-Runner'

/** Process table, pidfile and port state with every lookup and signal recorded. */
function host({ processes = [], pidfile = [], holders = () => [] } = {}) {
  const table = new Map(processes.map((row) => [row.pid, row]))
  const signals = []
  let stored = pidfile
  const io = {
    processTable: () => [...table.values()],
    commandOf: (pid) => table.get(pid)?.command ?? '',
    portHolders: (port) => {
      assert.equal(port, IOS_DRIVER_PORT)
      return holders(table)
    },
    kill: (pid, signal) => {
      signals.push([pid, signal])
      table.delete(pid)
    },
    alive: (pid) => table.has(pid),
    sleep: async () => undefined,
    readPidfile: () => stored,
    writePidfile: (_file, records) => {
      stored = records
    },
  }
  return { io, table, signals, stored: () => stored }
}

describe('reclaimIosDriverPort', () => {
  test('an owned stale driver still running its recorded command is stopped and the port is free', async () => {
    const h = host({
      processes: [{ pid: 4100, ppid: 1, command: driver }],
      pidfile: [{ pid: 4100, command: driver }],
      holders: (table) => (table.has(4100) ? [4100] : []),
    })
    assert.deepEqual(await reclaimIosDriverPort({ pidfile: 'owned.json', io: h.io }), {
      stopped: [4100],
      leftAlone: [],
    })
    assert.deepEqual(h.signals, [[4100, 'SIGTERM']])
    assert.deepEqual(h.stored(), [])
  })

  test('a recorded PID reused by an unrelated process is left alone', async () => {
    const h = host({
      processes: [{ pid: 4100, ppid: 1, command: '/usr/bin/ssh-agent -l' }],
      pidfile: [{ pid: 4100, command: driver }],
    })
    assert.deepEqual(await reclaimIosDriverPort({ pidfile: 'owned.json', io: h.io }), {
      stopped: [],
      leftAlone: [4100],
    })
    assert.deepEqual(h.signals, [])
    assert.equal(h.table.has(4100), true)
    assert.deepEqual(h.stored(), [])
  })

  test('a PID now running another driver command is not treated as the recorded one', async () => {
    const h = host({
      processes: [{ pid: 4100, ppid: 1, command: runner }],
      pidfile: [{ pid: 4100, command: driver }],
      holders: (table) => (table.has(4100) ? [4100] : []),
    })
    await assert.rejects(
      reclaimIosDriverPort({ pidfile: 'owned.json', io: h.io }),
      /ios_driver_port_held: host port 7001 is held by PID 4100/
    )
    assert.deepEqual(h.signals, [])
  })

  test('a foreign process holding port 7001 fails fast with its PID and is never signalled', async () => {
    const h = host({
      processes: [{ pid: 5200, ppid: 1, command: runner }],
      holders: () => [5200],
    })
    await assert.rejects(
      reclaimIosDriverPort({ pidfile: 'owned.json', io: h.io }),
      (error) => {
        assert.equal(
          error.message,
          `ios_driver_port_held: host port 7001 is held by PID 5200 (${runner}), which this runner did not start. Stop that process and rerun.`
        )
        return true
      }
    )
    assert.deepEqual(h.signals, [])
    assert.equal(h.table.has(5200), true)
  })

  test('a driver that ignores SIGTERM through the grace period is killed', async () => {
    const h = host({
      processes: [{ pid: 4100, ppid: 1, command: driver }],
      pidfile: [{ pid: 4100, command: driver }],
    })
    h.io.kill = (pid, signal) => {
      h.signals.push([pid, signal])
      if (signal === 'SIGKILL') h.table.delete(pid)
    }
    await reclaimIosDriverPort({ pidfile: 'owned.json', io: h.io })
    assert.deepEqual(h.signals, [
      [4100, 'SIGTERM'],
      [4100, 'SIGKILL'],
    ])
  })
})

describe('recordOwnedIosDrivers', () => {
  test('records only driver descendants of the Maestro child, once each', () => {
    const h = host({
      processes: [
        { pid: 300, ppid: 1, command: 'node scripts/run-maestro.mjs' },
        { pid: 310, ppid: 300, command: 'java -jar maestro.jar test' },
        { pid: 320, ppid: 310, command: driver },
        { pid: 330, ppid: 320, command: runner },
        { pid: 400, ppid: 1, command: runner },
      ],
    })
    assert.deepEqual(
      recordOwnedIosDrivers({ pidfile: 'owned.json', rootPid: 310, io: h.io }),
      [
        { pid: 320, command: driver },
        { pid: 330, command: runner },
      ]
    )
    assert.deepEqual(
      recordOwnedIosDrivers({ pidfile: 'owned.json', rootPid: 310, io: h.io }),
      []
    )
    assert.deepEqual(h.stored(), [
      { pid: 320, command: driver },
      { pid: 330, command: runner },
    ])
  })

  test('the tracker snapshots on its interval and once more when stopped', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const h = host({ processes: [{ pid: 310, ppid: 1, command: 'maestro test' }] })
    const stop = trackOwnedIosDrivers({
      pidfile: 'owned.json',
      rootPid: 310,
      io: h.io,
      intervalMs: 2_000,
    })
    h.table.set(320, { pid: 320, ppid: 310, command: driver })
    t.mock.timers.tick(2_000)
    assert.deepEqual(h.stored(), [{ pid: 320, command: driver }])
    h.table.set(330, { pid: 330, ppid: 310, command: runner })
    stop()
    assert.deepEqual(h.stored(), [
      { pid: 320, command: driver },
      { pid: 330, command: runner },
    ])
  })
})
