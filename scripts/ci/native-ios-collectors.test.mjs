import assert from 'node:assert/strict'
import test from 'node:test'
import { simulatorCollectors } from './native-ios-collectors.mjs'

const usage = `
1 0 0 /sbin/launchd
10 1 0 /runner/Runner.Worker
11 10 0 /bin/bash
12 11 0 /usr/local/bin/node
100 1 0 launchd_sim
101 100 0 /sim/SpringBoard
102 100 32 /sim/diagnosticd
103 1 30 /usr/libexec/diagnosticd
104 1 0 /System/Library/CoreServices/ReportCrash
110 12 1 /usr/bin/xcrun
111 110 1 /usr/bin/simctl
112 111 1 /sim/usr/bin/log
120 10 1 /usr/bin/log
130 12 1 /usr/bin/java
140 12 1 /usr/local/bin/node
150 1 0 /other/launchd_sim
151 150 1 /other/log
`
const commands = `
1 0 /sbin/launchd
10 1 /runner/Runner.Worker
11 10 /bin/bash -e /tmp/job.sh
12 11 node scripts/ci/native-ios-startup-probe.mjs
100 1 launchd_sim
101 100 /sim/SpringBoard
102 100 /sim/diagnosticd
103 1 /usr/libexec/diagnosticd
104 1 /System/Library/CoreServices/ReportCrash
110 12 xcrun simctl spawn OWNED log stream --predicate secret-predicate
111 110 simctl spawn OWNED log stream --predicate secret-predicate
112 111 /sim/usr/bin/log stream --predicate secret-predicate
120 10 /usr/bin/log collect --output secret-path
130 12 /usr/bin/java -cp /tools/maestro/lib/maestro.jar token=secret-value
140 12 node scripts/collect-logs.mjs --token secret-value
150 1 /other/launchd_sim
151 150 /other/log stream
`

test('every log client, Maestro and harness collector retains its parent chain and ownership', () => {
  const rows = simulatorCollectors(usage, commands, 100, 12)
  assert.deepEqual(
    rows.map((r) => r.pid),
    [12, 102, 103, 104, 110, 111, 112, 120, 130, 140, 151]
  )
  const client = rows.find((r) => r.pid === 112)
  assert.equal(client.kind, 'log-stream')
  assert.equal(client.ownedByHarness, true)
  assert.deepEqual(
    client.parents.map((r) => r.pid),
    [111, 110, 12, 11, 10, 1]
  )
  assert.equal(rows.find((r) => r.pid === 102).ownedSimulator, true)
  assert.equal(rows.find((r) => r.pid === 103).ownedSimulator, false)
  assert.equal(rows.find((r) => r.pid === 151).ownedSimulator, false)
  assert.equal(rows.find((r) => r.pid === 120).ownedByHarness, false)
  assert.equal(rows.find((r) => r.pid === 130).kind, 'maestro')
  assert.equal(rows.find((r) => r.pid === 140).kind, 'harness-collector')
  assert.doesNotMatch(
    JSON.stringify(rows),
    /secret|predicate|token|output|\/sim|\/runner/
  )
})

test('simctl diagnose and log show/config are visible without recording arbitrary arguments', () => {
  const rows = simulatorCollectors(
    '1 0 0 /sbin/launchd\n2 1 0 /usr/bin/xcrun\n3 1 0 /usr/bin/log\n4 1 0 /usr/bin/log',
    '1 0 /sbin/launchd\n2 1 xcrun simctl diagnose --output secret\n3 1 log show --predicate secret\n4 1 log config --mode level:off',
    100,
    12
  )
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['simctl-diagnose', 'log-show', 'log-config']
  )
  assert.doesNotMatch(JSON.stringify(rows), /secret|predicate|level:off/)
})

test('a cyclic or disappearing parent cannot hang collection or erase a visible client', () => {
  const rows = simulatorCollectors(
    '',
    '2 3 log stream\n3 2 shell\n4 999 log collect',
    100,
    12
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows[0].parents.map((r) => r.pid),
    [3]
  )
  assert.deepEqual(rows[1].parents, [])
})
