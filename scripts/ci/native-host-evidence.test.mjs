import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertNativeHostEvidence,
  busiestProcesses,
  firstMaestroLog,
  projectFirstFlow,
  projectMetro,
  projectSample,
  residentProcesses,
  projectMemory,
} from './native-host-evidence.mjs'

const script = fileURLToPath(new URL('./native-host-evidence.mjs', import.meta.url))

const record = (overrides = {}) => ({
  version: 1,
  platform: 'ios',
  samples: [],
  firstFlow: null,
  metro: null,
  ...overrides,
})

test('the busiest processes keep closed names and their CPU order', () => {
  const rows = busiestProcesses(
    [
      ' 12.5 healthd         ',
      '182.2 chrome-headless-',
      '  0.0 /bin/sh -c x',
      'garbage line',
      ' 41.7 diagnosticd',
    ].join('\n')
  )
  assert.deepEqual(rows, [
    { command: 'chrome-headless-', cpuPercent: 182.2 },
    { command: 'diagnosticd', cpuPercent: 41.7 },
    { command: 'healthd', cpuPercent: 12.5 },
    { command: '_bin_sh_-c_x', cpuPercent: 0 },
  ])
  const many = Array.from({ length: 20 }, (_, index) => `${index} p${index}`).join('\n')
  assert.equal(busiestProcesses(many).length, 8)
  assert.equal(busiestProcesses(many)[0].command, 'p19')
})

test('a host sample is a closed projection of load, memory and processes', () => {
  const sample = projectSample({
    label: 'after-simulator-boot',
    at: Date.UTC(2026, 9, 28, 5, 37, 10),
    loadavg: [343.456, 120.1, 80],
    cpuCount: 3,
    totalmem: 7 * 1024 ** 3,
    freemem: 512 * 1024 ** 2,
    ps: '41.7 diagnosticd',
  })
  assert.deepEqual(sample, {
    label: 'after-simulator-boot',
    at: '2026-10-28T05:37:10.000Z',
    cpuCount: 3,
    load1: 343.46,
    load5: 120.1,
    load15: 80,
    memTotalMB: 7168,
    memFreeMB: 512,
    busiest: [{ command: 'diagnosticd', cpuPercent: 41.7 }],
    resident: [],
    swapUsedMB: null,
    memoryPressureFreePercent: null,
  })
  assert.doesNotThrow(() => assertNativeHostEvidence(record({ samples: [sample] })))
  assert.throws(
    () => projectSample({ ...sample, label: 'whenever', loadavg: [0, 0, 0], ps: '' }),
    /invalid_host_sample_label/
  )
})

const maestroLog = [
  '05:43:22.100 [ INFO] MAESTRO.logSystemInfo: ---- System Info ----',
  '05:43:58.498 [ INFO] maestro.cli.command.TestCommand.runShardSuite: [shard 1] Selected device X',
  '05:44:04.104 [ INFO] xcuitest.installer.LocalXCTestInstaller.start$lambda$3: [Start] Install XCUITest runner on X',
  'a continuation line without a stamp',
  '05:44:51.133 [ INFO] maestro.cli.runner.TestRunner.runSingle: Running flow open-app.yaml...',
  '05:45:02.633 [ INFO] maestro.cli.runner.MaestroCommandRunner: Assert visible COMPLETED',
].join('\n')

test('the first flow splits into JVM, driver and flow time', () => {
  assert.deepEqual(projectFirstFlow(maestroLog, 'passed'), {
    status: 'passed',
    reached: 'flow',
    totalSeconds: 100.53,
    jvmSeconds: 36.4,
    driverSeconds: 47.03,
    flowSeconds: 11.5,
  })
})

test('a first flow cut off early names the last phase it reached', () => {
  const driverOnly = maestroLog.split('\n').slice(0, 3).join('\n')
  assert.deepEqual(projectFirstFlow(driverOnly, 'failed'), {
    status: 'failed',
    reached: 'driver',
    totalSeconds: 42,
    jvmSeconds: 36.4,
    driverSeconds: null,
    flowSeconds: null,
  })
  assert.equal(projectFirstFlow('', 'failed').reached, 'none')
  assert.throws(() => projectFirstFlow(maestroLog, 'maybe'), /invalid_first_flow_status/)
})

test('a first flow across midnight keeps counting forward', () => {
  const log = [
    '23:59:50.000 [ INFO] System Info',
    '00:00:20.000 [ INFO] Selected device X',
  ].join('\n')
  assert.equal(projectFirstFlow(log, 'failed').jvmSeconds, 30)
})

test('Metro reports its bundles and error lines as counts', () => {
  const metro = [
    'Starting Metro Bundler',
    'iOS Bundled 48123ms node_modules/expo-router/entry.js (2301 modules)',
    'ERROR  Something failed',
    'iOS Bundled 812ms node_modules/expo-router/entry.js (1 module)',
  ].join('\n')
  assert.deepEqual(projectMetro(metro), { bundles: 2, lastBundleMs: 812, errorLines: 1 })
  assert.deepEqual(projectMetro(''), { bundles: 0, lastBundleMs: null, errorLines: 0 })
})

test('the evidence validator refuses anything outside the closed shape', () => {
  const sample = projectSample({
    label: 'failure',
    at: 0,
    loadavg: [1, 1, 1],
    cpuCount: 3,
    totalmem: 1,
    freemem: 1,
    ps: '',
  })
  const flow = projectFirstFlow(maestroLog, 'passed')
  const good = record({
    samples: [sample],
    firstFlow: flow,
    metro: projectMetro(''),
  })
  assert.doesNotThrow(() => assertNativeHostEvidence(good))
  for (const bad of [
    { ...good, extra: true },
    { ...good, platform: 'android' },
    { ...good, samples: [{ ...sample, label: 'other' }] },
    { ...good, samples: [{ ...sample, note: 'raw text' }] },
    { ...good, samples: [{ ...sample, busiest: [{ command: 'a b', cpuPercent: 1 }] }] },
    { ...good, samples: [{ ...sample, load1: -1 }] },
    { ...good, firstFlow: { ...flow, status: 'unknown' } },
    { ...good, firstFlow: { ...flow, log: 'raw' } },
    { ...good, metro: { bundles: 1, lastBundleMs: 'fast', errorLines: 0 } },
  ])
    assert.throws(() => assertNativeHostEvidence(bad), /invalid_native_host_evidence/)
})

test('the first Maestro run directory provides the first flow log', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-host-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const [name, log] of [
    ['maestro-ios-200', 'second'],
    ['maestro-ios-100', 'first'],
    ['maestro-android-50', 'other platform'],
  ]) {
    fs.mkdirSync(path.join(directory, name))
    fs.writeFileSync(path.join(directory, name, 'maestro.log'), log)
  }
  assert.equal(firstMaestroLog(directory, 'ios'), 'first')
})

test('the command line appends to one closed record per platform', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-host-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(path.join(directory, 'maestro-ios-1'))
  fs.writeFileSync(path.join(directory, 'maestro-ios-1', 'maestro.log'), maestroLog)
  fs.writeFileSync(path.join(directory, 'metro.log'), 'iOS Bundled 900ms entry.js')
  const run = (...args) =>
    execFileSync(process.execPath, [script, ...args, '--platform', 'ios'], {
      env: { ...process.env, CC68_HARNESS_DIR: directory },
      encoding: 'utf8',
    })
  run('sample', 'before-simulator-boot')
  run('first-flow', 'passed')
  // A later failure step keeps the passed first-flow record.
  run('first-flow', 'failed')
  assert.match(run('metro'), /"bundles":1/)
  const value = JSON.parse(fs.readFileSync(path.join(directory, 'native-host-ios.json')))
  assert.doesNotThrow(() => assertNativeHostEvidence(value))
  assert.equal(value.samples[0].label, 'before-simulator-boot')
  assert.equal(value.firstFlow.status, 'passed')
  assert.equal(value.metro.lastBundleMs, 900)
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, 'sample', 'failure'], {
        env: { ...process.env, CC68_HARNESS_DIR: directory },
        stdio: 'pipe',
      }),
    /native_host_platform_required/
  )
})

test('public evidence publishes a valid host record and refuses an invalid one', (t) => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-host-public-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const evidence = path.join(directory, 'public-evidence')
  const publish = () =>
    spawnSync(process.execPath, ['scripts/e2e-share-card/public-evidence.mjs'], {
      cwd: root,
      env: { ...process.env, CC68_HARNESS_DIR: directory },
      encoding: 'utf8',
    })
  const valid = record({ firstFlow: projectFirstFlow(maestroLog, 'passed') })
  fs.writeFileSync(path.join(directory, 'native-host-ios.json'), JSON.stringify(valid))
  assert.equal(publish().status, 0)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(evidence, 'native-host-ios.json'))),
    valid
  )
  fs.writeFileSync(
    path.join(directory, 'native-host-ios.json'),
    JSON.stringify({ ...valid, log: 'raw maestro text' })
  )
  const refused = publish()
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /invalid_native_host_evidence/)
  assert.deepEqual(fs.readdirSync(evidence), [])
})

test('RSS reports the top 15 executable basenames, sorted by resident KiB', () => {
  const rows = residentProcesses(
    [
      '9000 2.5 /Applications/Xcode.app/Contents/XCBBuildService',
      '10 0.0 /usr/bin/other',
      'bad row',
      ...Array.from({ length: 20 }, (_, i) => `${100 + i} 0.1 p${i}`),
    ].join('\n')
  )
  assert.equal(rows.length, 15)
  assert.deepEqual(rows[0], { command: 'XCBBuildService', rssKB: 9000, cpuPercent: 2.5 })
  assert.equal(rows[1].command, 'p19')
  assert.equal(rows.at(-1).rssKB, 106)
})

test('swap and pressure probes preserve zero and mark unsupported output', () => {
  assert.deepEqual(
    projectMemory(
      'vm.swapusage: total = 2048.00M used = 123.25M free = 1924.75M (encrypted)',
      'System-wide memory free percentage: 7%'
    ),
    { swapUsedMB: 123.25, memoryPressureFreePercent: 7 }
  )
  assert.deepEqual(
    projectMemory('used = 0.00M', 'System-wide memory free percentage: 100%'),
    { swapUsedMB: 0, memoryPressureFreePercent: 100 }
  )
  assert.deepEqual(projectMemory('', ''), {
    swapUsedMB: null,
    memoryPressureFreePercent: null,
  })
  const sample = projectSample({
    label: 'failure',
    at: 0,
    loadavg: [0, 0, 0],
    cpuCount: 1,
    totalmem: 1,
    freemem: 1,
    ps: '',
  })
  for (const bad of [
    { ...sample, swapUsedMB: -1 },
    { ...sample, memoryPressureFreePercent: 101 },
    { ...sample, resident: [{ command: 'ok', rssKB: -1, cpuPercent: 0 }] },
    {
      ...sample,
      resident: [{ command: 'ok', rssKB: 1, cpuPercent: 0, args: 'private' }],
    },
  ])
    assert.throws(
      () => assertNativeHostEvidence(record({ samples: [bad] })),
      /invalid_native_host_evidence/
    )
})
