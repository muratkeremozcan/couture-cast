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
  compressorMB,
  firstMaestroLog,
  projectFirstFlow,
  projectMetro,
  projectMetroBundles,
  projectSample,
  residentProcesses,
  residentRollup,
  projectMemory,
  projectVm,
} from './native-host-evidence.mjs'

const script = fileURLToPath(new URL('./native-host-evidence.mjs', import.meta.url))

const record = (overrides = {}) => ({
  version: 3,
  platform: 'ios',
  samples: [],
  firstFlow: null,
  metro: null,
  ...overrides,
})

test('the busiest processes keep closed names and their CPU order', () => {
  const rows = busiestProcesses(
    [
      '10 1 2048 12.5 /usr/libexec/healthd',
      '11 1 8192 182.2 chrome-headless-',
      '12 1 1024 0.0 bad name',
      'garbage line',
      '13 1 4096 41.7 diagnosticd',
    ].join('\n')
  )
  assert.deepEqual(rows, [
    { pid: 11, ppid: 1, command: 'chrome-headless-', rssKB: 8192, cpuPercent: 182.2 },
    { pid: 13, ppid: 1, command: 'diagnosticd', rssKB: 4096, cpuPercent: 41.7 },
    { pid: 10, ppid: 1, command: 'healthd', rssKB: 2048, cpuPercent: 12.5 },
    { pid: 12, ppid: 1, command: 'bad_name', rssKB: 1024, cpuPercent: 0 },
  ])
  const many = Array.from(
    { length: 20 },
    (_, index) => `${index + 1} 1 10 ${index} p${index}`
  ).join('\n')
  assert.equal(busiestProcesses(many).length, 15)
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
    ps: '13 1 4096 41.7 diagnosticd',
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
    busiest: [
      { pid: 13, ppid: 1, command: 'diagnosticd', rssKB: 4096, cpuPercent: 41.7 },
    ],
    resident: [
      { pid: 13, ppid: 1, command: 'diagnosticd', rssKB: 4096, cpuPercent: 41.7 },
    ],
    rssTotalMB: 4,
    simulatorRssMB: null,
    compressorMB: null,
    swapUsedMB: null,
    memoryPressureFreePercent: null,
    vm: null,
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
    wall: null,
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
    wall: null,
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
  const wall = {
    timeoutMs: 120000,
    childMs: 50000,
    timedOut: false,
    killAfterMs: null,
    wrapperMs: 50030,
    workerOverheadMs: 30,
    setupMs: 10,
    harnessMs: 50040,
  }
  fs.writeFileSync(
    path.join(directory, 'maestro-ios-1', 'flow-timing.json'),
    JSON.stringify(wall)
  )
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
  assert.deepEqual(value.firstFlow.wall, wall)
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

test('RSS reports the top 25 executable basenames, sorted by resident KiB', () => {
  const rows = residentProcesses(
    [
      '20 1 9000 2.5 /Applications/Xcode.app/Contents/XCBBuildService',
      '21 1 10 0.0 /usr/bin/other',
      'bad row',
      ...Array.from({ length: 20 }, (_, i) => `${100 + i} 1 ${100 + i} 0.1 p${i}`),
    ].join('\n')
  )
  assert.equal(rows.length, 22)
  assert.deepEqual(rows[0], {
    pid: 20,
    ppid: 1,
    command: 'XCBBuildService',
    rssKB: 9000,
    cpuPercent: 2.5,
  })
  assert.equal(rows[1].command, 'p19')
  assert.equal(rows.at(-1).rssKB, 10)
})

test('a run with ten locale passes and both failure samples stays within the sample bound', () => {
  const sample = projectSample({
    label: 'locale-loop',
    at: 0,
    loadavg: [0, 0, 0],
    cpuCount: 1,
    totalmem: 1,
    freemem: 1,
    ps: '',
  })
  assert.doesNotThrow(() =>
    assertNativeHostEvidence(record({ samples: Array(22).fill(sample) }))
  )
  assert.throws(() =>
    assertNativeHostEvidence(record({ samples: Array(33).fill(sample) }))
  )
})

test('in-flow sample labels are accepted', () => {
  for (const label of ['locale-loop', 'flow-failure'])
    assert.equal(
      projectSample({
        label,
        at: 0,
        loadavg: [0, 0, 0],
        cpuCount: 1,
        totalmem: 1,
        freemem: 1,
        ps: '',
      }).label,
      label
    )
})

const REAL_VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   145816.
Pages active:                                 947782.
Pages inactive:                               933859.
Pages speculative:                             14366.
Pages throttled:                                   0.
Pages wired down:                             306485.
Pages purgeable:                               17319.
"Translation faults":                    36575066354.
Pages copy-on-write:                      4493603714.
Pages zero filled:                       19835266833.
Pages reactivated:                         916493019.
Pages purged:                               56354017.
File-backed pages:                            571700.
Anonymous pages:                             1324307.
Pages stored in compressor:                  1377537.
Pages occupied by compressor:                 754476.
Decompressions:                            577146434.
Compressions:                              709108739.
Pageins:                                   425077635.
Pageouts:                                     420779.
Swapins:                                      421818.
Swapouts:                                     977766.
`

test('the real vm_stat output format (captured on macOS) yields every counter', () => {
  const vm = projectVm(REAL_VM_STAT)
  assert.deepEqual(Object.keys(vm), [
    'pageins',
    'pageouts',
    'swapins',
    'swapouts',
    'compressions',
    'decompressions',
  ])
  assert.equal(vm.pageins, Number(REAL_VM_STAT.match(/^Pageins:\s+(\d+)/m)[1]))
  assert.equal(
    vm.decompressions,
    Number(REAL_VM_STAT.match(/^Decompressions:\s+(\d+)/m)[1])
  )
  // Run 23 recorded null in every sample because the counters were matched under invented names.
  if (process.platform === 'darwin') {
    const live = spawnSync('vm_stat', [], { encoding: 'utf8' })
    assert.notEqual(projectVm(live.stdout), null)
  }
})

test('vm_stat paging counters are cumulative integers and any missing counter makes the probe unsupported', () => {
  const text = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Decompressions:                          400.',
    'Compressions:                           1000.',
    'Pageins:                                  25.',
    'Pageouts:                                  0.',
    'Swapins:                                   7.',
    'Swapouts:                                 11.',
  ].join('\n')
  assert.deepEqual(projectVm(text), {
    pageins: 25,
    pageouts: 0,
    swapins: 7,
    swapouts: 11,
    compressions: 1000,
    decompressions: 400,
  })
  assert.equal(projectVm(text.replace(/^Swapins.*$/m, '')), null)
  assert.equal(projectVm(''), null)
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
    { ...sample, vm: { pageins: -1 } },
    {
      ...sample,
      vm: { pageins: 1, pageouts: 1, swapins: 1, swapouts: 1, compressions: 1 },
    },
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

test('every workflow host sample label is accepted by the real sampler CLI', (t) => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/pr-share-card-native.yml'),
    'utf8'
  )
  const labels = [
    ...new Set(
      [
        ...workflow.matchAll(
          /native-host-evidence\.mjs sample ([a-z-]+) --platform ios/g
        ),
      ].map((match) => match[1])
    ),
  ]
  assert.ok(labels.includes('before-first-flow'))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-host-labels-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const label of labels) {
    const result = spawnSync(
      process.execPath,
      [script, 'sample', label, '--platform', 'ios'],
      {
        env: { ...process.env, CC68_HARNESS_DIR: directory },
        encoding: 'utf8',
      }
    )
    assert.equal(result.status, 0, `${label}: ${result.stderr}`)
  }
  const evidence = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-host-ios.json'), 'utf8')
  )
  assert.deepEqual(
    evidence.samples.map((sample) => sample.label),
    labels
  )
})

test('a failed host snapshot records its exact error and the real shell proceeds to the next stage', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-host-failed-snapshot-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  for (const [name, body] of [
    ['ps', 'echo snapshot-refused >&2\nexit 23'],
    ['sysctl', 'echo "vm.swapusage: used = 0.00M"'],
    ['memory_pressure', 'echo "System-wide memory free percentage: 50%"'],
  ])
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o700 })
  const r = spawnSync(
    '/bin/sh',
    [
      '-c',
      '"$CC68_NODE" "$CC68_PROBE" sample after-simulator-boot --platform ios && printf "NEXT_FLOW_STAGE\\n"',
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CC68_HARNESS_DIR: directory,
        CC68_NODE: process.execPath,
        CC68_PROBE: script,
      },
      encoding: 'utf8',
    }
  )
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /NEXT_FLOW_STAGE/)
  const failures = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-host-snapshot-private.json'), 'utf8')
  )
  assert.equal(failures[0].exitCode, 23)
  assert.equal(failures[0].stderr, 'snapshot-refused\n')
  assert.equal(failures[0].binary, 'ps')
  const record = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-host-ios.json'), 'utf8')
  )
  assert.deepEqual(record.samples[0].busiest, [])
  assert.equal(record.samples[0].label, 'after-simulator-boot')
  assertNativeHostEvidence(record)
})

test('first-flow evidence keeps child deadline, setup and worker bootstrap separate', () => {
  const wall = {
    timeoutMs: 120000,
    childMs: 120004,
    timedOut: true,
    killAfterMs: 120001,
    wrapperMs: 120040,
    workerOverheadMs: 36,
    setupMs: 20,
    harnessMs: 120060,
  }
  const firstFlow = projectFirstFlow(maestroLog, 'failed', wall)
  assert.doesNotThrow(() => assertNativeHostEvidence(record({ firstFlow })))
  assert.equal(firstFlow.wall.childMs, 120004)
  for (const bad of [
    { ...wall, timeoutMs: 148000 },
    { ...wall, timedOut: 'yes' },
    { ...wall, workerOverheadMs: -1 },
    { ...wall, env: 'private' },
  ])
    assert.throws(
      () => assertNativeHostEvidence(record({ firstFlow: { ...firstFlow, wall: bad } })),
      /invalid_native_host_evidence/
    )
})

test('Metro bundle builds are listed in order by entry without any other log text', () => {
  const log = [
    'iOS Bundled 4522ms node_modules/expo-router/entry.js (1874 modules)',
    'secret token abc123 in a log line',
    'iOS Bundled 13848ms node_modules/expo-media-library/build/MediaLibrary.js (3 modules)',
    'Bundled 90ms apps/mobile/x y.js',
  ].join('\n')
  const { bundles } = projectMetroBundles(log)
  assert.deepEqual(bundles, [
    {
      index: 0,
      platform: 'iOS',
      ms: 4522,
      entry: 'node_modules/expo-router/entry.js',
      modules: 1874,
    },
    {
      index: 1,
      platform: 'iOS',
      ms: 13848,
      entry: 'node_modules/expo-media-library/build/MediaLibrary.js',
      modules: 3,
    },
    { index: 2, platform: null, ms: 90, entry: 'apps/mobile/x', modules: null },
  ])
  assert.doesNotMatch(JSON.stringify(bundles), /secret|abc123/)
  assert.deepEqual(projectMetroBundles('').bundles, [])
})

test('the shipped sample command records non-null paging counters from the real vm_stat', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-real-vm-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const run = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./native-host-evidence.mjs', import.meta.url)),
      'sample',
      'locale-loop',
      '--platform',
      'ios',
    ],
    { env: { ...process.env, CC68_HARNESS_DIR: directory }, encoding: 'utf8' }
  )
  assert.equal(run.status, 0, run.stderr)
  const written = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-host-ios.json'), 'utf8')
  )
  const [sample] = written.samples
  assert.equal(sample.label, 'locale-loop')
  // vm_stat exists only on macOS; the hosted lane is macOS, so there it must never be null.
  if (process.platform === 'darwin') {
    assert.notEqual(sample.vm, null)
    for (const value of Object.values(sample.vm)) assert.ok(Number.isSafeInteger(value))
  }
})

const PS_WITH_SIMULATOR = [
  '    1     0  13456   0.0 /sbin/launchd',
  '  900     1   7200   0.1 /Library/Developer/CoreSimulator/launchd_sim',
  '  901   900 183424  24.8 /Library/Developer/CoreSimulator/SpringBoard',
  '  902   900  95000   0.0 /Library/Developer/CoreSimulator/PosterBoard',
  '  903     1  50000   0.0 /usr/bin/node',
].join('\n')

test('the resident roll-up sums every process and the owned simulator children', () => {
  assert.deepEqual(residentRollup(PS_WITH_SIMULATOR), {
    rssTotalMB: Math.round((13456 + 7200 + 183424 + 95000 + 50000) / 1024),
    simulatorRssMB: Math.round((183424 + 95000) / 1024),
  })
  assert.deepEqual(residentRollup(''), { rssTotalMB: null, simulatorRssMB: null })
  assert.equal(
    residentRollup('  903     1  50000   0.0 /usr/bin/node').simulatorRssMB,
    null
  )
})

test('compressor memory is read from the real vm_stat page size and page count', () => {
  assert.equal(compressorMB(REAL_VM_STAT), Math.round((754476 * 16384) / 1048576))
  assert.equal(compressorMB('Pageins: 1.'), null)
  if (process.platform === 'darwin') {
    const live = spawnSync('vm_stat', [], { encoding: 'utf8' })
    assert.ok(compressorMB(live.stdout) >= 0)
  }
})

test('the shipped sample command records the roll-ups and keeps an in-flow sample apart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-host-'))
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CC68_HARNESS_DIR: directory },
    })
  const main = run('sample', 'locale-loop', '--platform', 'ios')
  assert.equal(main.status, 0, main.stderr)
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'native-host-ios.json')))
  const [sample] = record.samples
  assert.ok(sample.resident.length <= 25 && sample.resident.length > 10)
  assert.ok(sample.rssTotalMB > 0)
  if (process.platform === 'darwin') {
    assert.ok(Number.isFinite(sample.compressorMB), 'compressor MB must be a real number')
    assert.notEqual(sample.vm, null)
  }
  assertNativeHostEvidence(record)

  const inFlow = run(
    'sample',
    'in-flow',
    '--flow',
    'maestro/story68/cancel.yaml',
    '--platform',
    'ios'
  )
  assert.equal(inFlow.status, 0, inFlow.stderr)
  const written = JSON.parse(
    fs.readFileSync(path.join(directory, 'native-host-ios-inflow.json'))
  )
  assert.equal(written.flow, 'maestro/story68/cancel.yaml')
  assert.equal(written.sample.label, 'in-flow')
  const after = JSON.parse(fs.readFileSync(path.join(directory, 'native-host-ios.json')))
  assert.equal(after.samples.length, 1, 'an in-flow sample never touches the main record')
  assert.notEqual(run('sample', 'in-flow', '--platform', 'ios').status, 0)
  assert.notEqual(
    run('sample', 'in-flow', '--flow', '../etc/passwd', '--platform', 'ios').status,
    0
  )
})
