import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { crashMetadata, crashReportCollector } from './native-ios-crashes.mjs'

const device = 'A63391DE-17A2-4B16-9C93-16B986580C99'
const report = (at, processName = 'CrashLoop') =>
  JSON.stringify({ app_name: processName, timestamp: at, secret: 'private' }) +
  '\n' +
  JSON.stringify({
    procName: processName,
    pid: 102,
    parentProc: 'launchd_sim',
    parentPid: 100,
    captureTime: at,
    exception: { type: 'EXC_CRASH', signal: 'SIGABRT' },
    termination: { namespace: 'SIGNAL', code: 6 },
    arbitrary: 'private',
  })

test('Apple two-part IPS and legacy reports preserve crash identity and time without arbitrary fields', () => {
  const row = crashMetadata(report('2026-10-28T12:00:00Z'))
  assert.equal(row.processName, 'CrashLoop')
  assert.equal(row.timestamp, '2026-10-28T12:00:00.000Z')
  assert.equal(row.pid, 102)
  assert.equal(row.parentPid, 100)
  assert.equal(row.signal, 'SIGABRT')
  assert.equal(row.terminationCode, 6)
  assert.doesNotMatch(JSON.stringify(row), /private|secret|arbitrary/)
  const legacy = crashMetadata(
    'Process: LegacyCrash [44]\nDate/Time: 2026-10-28 12:01:00 +0000\nException Type: EXC_BAD_ACCESS (SIGSEGV)'
  )
  assert.equal(legacy.processName, 'LegacyCrash')
  assert.equal(legacy.pid, 44)
  assert.equal(legacy.timestamp, '2026-10-28T12:01:00.000Z')
  assert.equal(crashMetadata('incomplete').parsed, false)
})

test('successive gate scans count distinct crashes in both exact roots, retain timestamps and avoid duplicate counts', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-crash-reports-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const simulator = path.join(
    home,
    'Library/Developer/CoreSimulator/Devices',
    device,
    'data/Library/Logs/DiagnosticReports'
  )
  const host = path.join(home, 'Library/Logs/DiagnosticReports')
  fs.mkdirSync(simulator, { recursive: true })
  fs.mkdirSync(path.join(host, 'Retired'), { recursive: true })
  fs.writeFileSync(path.join(simulator, 'one.ips'), report('2026-10-28T12:00:00Z'))
  fs.writeFileSync(
    path.join(host, 'Retired', 'host.ips'),
    report('2026-10-28T12:00:01Z', 'HostCrash')
  )
  fs.symlinkSync(host, path.join(simulator, 'outside'))
  const scan = crashReportCollector(device, { home })
  assert.equal(scan(0).reports.length, 2)
  assert.equal(scan(5).reports.length, 2)
  fs.writeFileSync(path.join(simulator, 'two.ips'), report('2026-10-28T12:00:10Z'))
  const last = scan(10)
  assert.equal(last.reports.length, 3)
  const count = last.counts.find((r) => r.source === 'simulator')
  assert.equal(count.count, 2)
  assert.equal(count.firstTimestamp, '2026-10-28T12:00:00.000Z')
  assert.equal(count.lastTimestamp, '2026-10-28T12:00:10.000Z')
  assert.equal(
    last.reports.find((r) => r.timestamp === count.lastTimestamp).observedSeconds,
    10
  )
  assert.doesNotMatch(JSON.stringify(last), /private|secret|arbitrary|cc68-crash-reports/)
})

test('missing roots remain explicit and device path traversal is rejected', () => {
  assert.throws(() => crashReportCollector('../other'), /owned_device_uuid_required/)
  const scan = crashReportCollector(device, { home: '/this-path-does-not-exist-cc68' })
  assert.deepEqual(
    scan(0).sources.map((r) => r.errorCode),
    ['ENOENT', 'ENOENT']
  )
})
