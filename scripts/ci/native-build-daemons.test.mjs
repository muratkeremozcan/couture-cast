import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  buildServices,
  ownedBuildServices,
  sameProcess,
} from './native-build-daemons.mjs'

test('cleanup accepts exact build-service names and parses their start identity', () => {
  const rows = buildServices(
    ' 42 Wed Oct 28 10:00:00 2026 /Applications/Xcode.app/Contents/XCBBuildService\n43 Wed Oct 28 10:00:01 2026 /Applications/Xcode.app/Contents/SWBBuildService\n44 Wed Oct 28 10:00:00 2026 /usr/bin/xcodebuild\n45 Wed Oct 28 10:00:00 2026 /tmp/XCBBuildService-helper\n1 Wed Oct 28 10:00:00 2026 /tmp/XCBBuildService\nbad'
  )
  assert.deepEqual(
    rows.map((row) => row.pid),
    [42, 43]
  )
  assert.deepEqual(
    buildServices('46 Wed Oct 28 10:00:00 2026 /Applications/Xcode.app/ibtoold').map(
      (row) => row.pid
    ),
    [46]
  )
  assert.equal(rows[0].startedAt, Date.parse('Wed Oct 28 10:00:00 2026'))
})

test('only new build services started after the owned build boundary qualify', () => {
  const old = { pid: 42, startedAt: 10, executable: '/x/XCBBuildService' }
  const before = { at: 20, services: [old] }
  const owned = { ...old, pid: 43, startedAt: 30 }
  assert.deepEqual(
    ownedBuildServices(before, [
      old,
      owned,
      { ...old, pid: 44, startedAt: 19 },
      { ...old, startedAt: 30 },
    ]),
    [owned]
  )
  assert.equal(sameProcess(owned, { ...owned }), true)
  assert.equal(sameProcess(owned, { ...owned, startedAt: 40 }), false)
  assert.equal(
    sameProcess(owned, { ...owned, executable: '/other/SWBBuildService' }),
    false
  )
})

test('local sessions cannot mark or stop services even with a hosted environment flag', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/ci/native-build-daemons.mjs', 'stop'],
    {
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'false',
        RUNNER_ENVIRONMENT: 'github-hosted',
      },
      encoding: 'utf8',
    }
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /build_service_cleanup_requires_github_hosted_macos/)
})
