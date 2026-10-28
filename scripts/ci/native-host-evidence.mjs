#!/usr/bin/env node
/**
 * Closed host evidence for the iOS share-card lane: host load, memory and the
 * busiest processes at named points, how long the first Maestro flow spent in
 * each phase, and Metro's bundle outcome. Every value is a number, a boolean or
 * a name from a closed set, so the record can join the public evidence.
 *
 *   node scripts/ci/native-host-evidence.mjs sample <label> --platform ios
 *   node scripts/ci/native-host-evidence.mjs first-flow <passed|failed> --platform ios
 *   node scripts/ci/native-host-evidence.mjs metro --platform ios
 *
 * Each command updates <harness>/native-host-<platform>.json and prints the part
 * it recorded. public-evidence.mjs validates the file with
 * assertNativeHostEvidence before copying it.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SAMPLE_LABELS = [
  'before-indexing-disable',
  'after-indexing-disable',
  'before-simulator-boot',
  'after-simulator-boot',
  'before-first-flow',
  'after-first-flow',
  'failure',
]
const PLATFORMS = ['ios']
const PHASES = ['none', 'jvm', 'device', 'driver', 'flow']
const COMMAND = /^[A-Za-z0-9._+-]{1,32}$/
const TOP_PROCESSES = 15
const TOP_RSS_PROCESSES = 15

/** Closed per-process projection from ps PID, PPID, RSS KiB, CPU and executable. */
function processUsage(text) {
  return text.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    if (!match) return []
    const command = path
      .basename(match[5].trim())
      .replace(/[^A-Za-z0-9._+-]/g, '_')
      .slice(0, 32)
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: COMMAND.test(command) ? command : 'other',
        rssKB: Number(match[3]),
        cpuPercent: Number(match[4]),
      },
    ]
  })
}

/** The top 15 CPU consumers, identified by process and parent IDs. */
export function busiestProcesses(text, limit = TOP_PROCESSES) {
  return processUsage(text)
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, limit)
}

/** The top 15 resident processes from the same snapshot. */
export function residentProcesses(text) {
  return processUsage(text)
    .sort((a, b) => b.rssKB - a.rssKB)
    .slice(0, TOP_RSS_PROCESSES)
}

/** Read-only macOS probes. Unsupported probes remain explicit null values. */
export function projectMemory(swap, pressure) {
  const used = swap.match(/used\s*=\s*(\d+(?:\.\d+)?)M/)
  const free = pressure.match(/System-wide memory free percentage:\s*(\d+)%/)
  return {
    swapUsedMB: used ? Number(used[1]) : null,
    memoryPressureFreePercent: free ? Number(free[1]) : null,
  }
}

const VM_COUNTERS = {
  pageins: /^Pageins:\s+(\d+)\./m,
  pageouts: /^Pageouts:\s+(\d+)\./m,
  swapins: /^Swapins:\s+(\d+)\./m,
  swapouts: /^Swapouts:\s+(\d+)\./m,
  compressions: /^Pages compressed:\s+(\d+)\./m,
  decompressions: /^Pages decompressed:\s+(\d+)\./m,
}

/**
 * Cumulative paging counters from vm_stat. The difference between two samples is the paging
 * the host did in between, which separates a paging stall from CPU starvation. Null when the
 * probe is unsupported or any counter is missing.
 */
export function projectVm(text) {
  const entries = Object.entries(VM_COUNTERS).map(([key, pattern]) => {
    const match = text.match(pattern)
    return [key, match ? Number(match[1]) : null]
  })
  return entries.every(([, value]) => value !== null) ? Object.fromEntries(entries) : null
}

const round = (/** @type {number} */ value) => Math.round(value * 100) / 100

/**
 * @param {{
 *   label: string
 *   at: number
 *   loadavg: number[]
 *   cpuCount: number
 *   totalmem: number
 *   freemem: number
 *   ps: string
 *   swap?: string
 *   pressure?: string
 *   vm?: string
 * }} input
 */
export function projectSample(input) {
  if (!SAMPLE_LABELS.includes(input.label)) throw new Error('invalid_host_sample_label')
  const [load1, load5, load15] = input.loadavg.map(round)
  return {
    label: input.label,
    at: new Date(input.at).toISOString(),
    cpuCount: input.cpuCount,
    load1,
    load5,
    load15,
    memTotalMB: Math.floor(input.totalmem / 1048576),
    memFreeMB: Math.floor(input.freemem / 1048576),
    busiest: busiestProcesses(input.ps),
    resident: residentProcesses(input.ps),
    ...projectMemory(input.swap ?? '', input.pressure ?? ''),
    vm: projectVm(input.vm ?? ''),
  }
}

/** Seconds of the day for a Maestro `HH:MM:SS.mmm` line stamp. */
function stamp(line) {
  const match = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) /)
  if (!match) return null
  const [, h, m, s, ms] = match.map(Number)
  return h * 3600 + m * 60 + s + ms / 1000
}

/**
 * Where the first Maestro flow spent its time, from its maestro.log: JVM start
 * up to device selection, the XCUITest driver start up to the flow start, and
 * the flow itself up to the last log line. A phase never reached is null.
 *
 * @param {string} log
 * @param {'passed' | 'failed'} status
 */
export function projectFirstFlow(log, status, wall = null) {
  if (!['passed', 'failed'].includes(status)) throw new Error('invalid_first_flow_status')
  const marks = firstFlowMarks(log)
  const span = (from, to) => (from === null || to === null ? null : round(to - from))
  return {
    status,
    reached: PHASES.findLast((phase, index) => index === 0 || marks[phase] !== null),
    totalSeconds: span(marks.jvm, marks.last),
    jvmSeconds: span(marks.jvm, marks.device),
    driverSeconds: span(marks.driver, marks.flow),
    flowSeconds: span(marks.flow, marks.last),
    wall,
  }
}

const PHASE_MARKERS = [
  ['device', 'Selected device'],
  ['driver', 'Install XCUITest runner'],
  ['flow', 'Running flow'],
]

/**
 * The time of the first log line, of the first line of each later phase and of
 * the last line, in seconds. A flow that runs past midnight keeps counting forward.
 *
 * @param {string} log
 */
function firstFlowMarks(log) {
  /** @type {Record<string, number | null>} */
  const marks = { jvm: null, device: null, driver: null, flow: null, last: null }
  let offset = 0
  for (const line of log.split('\n')) {
    const raw = stamp(line)
    if (raw === null) continue
    if (marks.last !== null && raw + offset < marks.last - 43200) offset += 86400
    const at = raw + offset
    marks.jvm ??= at
    for (const [phase, marker] of PHASE_MARKERS)
      if (marks[phase] === null && line.includes(marker)) marks[phase] = at
    marks.last = at
  }
  return marks
}

/**
 * Metro's bundle outcome from its log: how many bundles finished, the last
 * bundle time, and how many lines report an error.
 *
 * @param {string} log
 */
export function projectMetro(log) {
  const bundles = [...log.matchAll(/Bundled (\d+)ms/g)].map((match) => Number(match[1]))
  return {
    bundles: bundles.length,
    lastBundleMs: bundles.at(-1) ?? null,
    errorLines: log.split('\n').filter((line) => /\berror\b/i.test(line)).length,
  }
}

/** Ordered Metro bundle builds: platform, build time, entry and module count only. */
export function projectMetroBundles(log) {
  const safe = (value) => value.replace(/[^A-Za-z0-9._/@+-]/g, '_').slice(0, 200)
  const bundles = [
    ...log.matchAll(
      /(?:(Android|iOS|Web) )?Bundled (\d+)ms (\S+)(?: \((\d+) modules?\))?/g
    ),
  ].map((match, index) => ({
    index,
    platform: match[1] ?? null,
    ms: Number(match[2]),
    entry: safe(match[3]),
    modules: match[4] === undefined ? null : Number(match[4]),
  }))
  return { version: 1, bundles }
}

/** Summarize the owned Metro log and keep its ordered bundle builds beside the host record. */
function recordMetro(directory, platform) {
  const log = path.join(directory, 'metro.log')
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
  // The build order shows which stage triggered each bundle (lazy chunks name their module).
  fs.writeFileSync(
    path.join(directory, `native-${platform}-metro-bundles.json`),
    JSON.stringify(projectMetroBundles(text), null, 2) + '\n',
    { mode: 0o600 }
  )
  return projectMetro(text)
}

const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join()
const seconds = (value) => value === null || (Number.isFinite(value) && value >= 0)

const SAMPLE_KEYS = [
  'label',
  'at',
  'cpuCount',
  'load1',
  'load5',
  'load15',
  'memTotalMB',
  'memFreeMB',
  'busiest',
  'resident',
  'swapUsedMB',
  'memoryPressureFreePercent',
  'vm',
]
const FLOW_SECONDS = ['totalSeconds', 'jvmSeconds', 'driverSeconds', 'flowSeconds']
const nonNegative = (value) => Number.isFinite(value) && value >= 0
const count = (value) => Number.isSafeInteger(value) && value >= 0
const isoTime = (value) =>
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value

const validProcess = (row) =>
  exactKeys(row, ['pid', 'ppid', 'command', 'rssKB', 'cpuPercent']) &&
  COMMAND.test(row.command) &&
  count(row.pid) &&
  count(row.ppid) &&
  count(row.rssKB) &&
  nonNegative(row.cpuPercent)

const validVm = (value) =>
  value === null ||
  (exactKeys(value, Object.keys(VM_COUNTERS)) &&
    Object.values(value).every((counter) => count(counter)))

const validPressure = (value) => value === null || (count(value) && value <= 100)

const validSample = (sample) =>
  exactKeys(sample, SAMPLE_KEYS) &&
  SAMPLE_LABELS.includes(sample.label) &&
  isoTime(sample.at) &&
  Number.isSafeInteger(sample.cpuCount) &&
  sample.cpuCount >= 1 &&
  ['load1', 'load5', 'load15', 'memTotalMB', 'memFreeMB'].every((key) =>
    nonNegative(sample[key])
  ) &&
  Array.isArray(sample.busiest) &&
  sample.busiest.length <= TOP_PROCESSES &&
  sample.busiest.every(validProcess) &&
  Array.isArray(sample.resident) &&
  sample.resident.length <= TOP_RSS_PROCESSES &&
  sample.resident.every(validProcess) &&
  seconds(sample.swapUsedMB) &&
  validPressure(sample.memoryPressureFreePercent) &&
  validVm(sample.vm)

const WALL_KEYS = [
  'timeoutMs',
  'childMs',
  'timedOut',
  'killAfterMs',
  'wrapperMs',
  'workerOverheadMs',
  'setupMs',
  'harnessMs',
]
const validWall = (wall) =>
  wall === null ||
  (exactKeys(wall, WALL_KEYS) &&
    wall.timeoutMs === 120000 &&
    typeof wall.timedOut === 'boolean' &&
    ['childMs', 'wrapperMs', 'workerOverheadMs', 'setupMs', 'harnessMs'].every((key) =>
      count(wall[key])
    ) &&
    (wall.timedOut ? count(wall.killAfterMs) : wall.killAfterMs === null))

const validFlow = (flow) =>
  flow === null ||
  (exactKeys(flow, ['status', 'reached', ...FLOW_SECONDS, 'wall']) &&
    ['passed', 'failed'].includes(flow.status) &&
    PHASES.includes(flow.reached) &&
    FLOW_SECONDS.every((key) => seconds(flow[key])) &&
    validWall(flow.wall))

const validMetro = (metro) =>
  metro === null ||
  (exactKeys(metro, ['bundles', 'lastBundleMs', 'errorLines']) &&
    count(metro.bundles) &&
    (metro.lastBundleMs === null || count(metro.lastBundleMs)) &&
    count(metro.errorLines))

/** Throws unless `value` is exactly the closed host evidence shape. */
export function assertNativeHostEvidence(value) {
  if (
    !exactKeys(value, ['version', 'platform', 'samples', 'firstFlow', 'metro']) ||
    value.version !== 3 ||
    !PLATFORMS.includes(value.platform) ||
    !Array.isArray(value.samples) ||
    value.samples.length > 16 ||
    !value.samples.every(validSample) ||
    !validFlow(value.firstFlow) ||
    !validMetro(value.metro)
  )
    throw new Error('invalid_native_host_evidence')
}

/** @param {string} directory @param {string} platform */
export function firstMaestroLog(directory, platform) {
  const runs = fs
    .readdirSync(directory)
    .map((name) => name.match(new RegExp(`^maestro-${platform}-(\\d+)$`)))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
  for (const run of runs) {
    const log = path.join(directory, run[0], 'maestro.log')
    if (fs.existsSync(log)) return fs.readFileSync(log, 'utf8')
  }
  return ''
}

export function firstMaestroTiming(directory, platform) {
  const runs = fs
    .readdirSync(directory)
    .filter((name) => new RegExp(`^maestro-${platform}-\\d+$`).test(name))
    .sort((a, b) => Number(a.split('-').at(-1)) - Number(b.split('-').at(-1)))
  for (const run of runs) {
    const file = path.join(directory, run, 'flow-timing.json')
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  return null
}

/** The closed private record of one unusable host probe. */
const probeFailure = (label, binary, args, r) => ({
  label,
  binary,
  args,
  exitCode: r.status ?? null,
  signal: r.signal ?? null,
  errorCode: r.error?.code ?? null,
  errorName: r.error?.name ?? null,
  errorMessage: r.error?.message ?? null,
  stderr: r.stderr ?? '',
  stdout: r.stdout ?? '',
  reason: r.error?.message ?? 'host_probe_output_unavailable',
})

/** Print a failed host probe and keep it in the private diagnostics file; never throws. */
function recordProbeFailure(directory, failure) {
  console.log(JSON.stringify({ hostSnapshotFailure: failure }))
  try {
    const diagnosticFile = path.join(directory, 'native-host-snapshot-private.json')
    const failures = fs.existsSync(diagnosticFile)
      ? JSON.parse(fs.readFileSync(diagnosticFile, 'utf8'))
      : []
    failures.push(failure)
    fs.writeFileSync(diagnosticFile, JSON.stringify(failures, null, 2) + '\n', {
      mode: 0o600,
    })
  } catch (error) {
    console.log(
      JSON.stringify({
        hostDiagnosticWriteFailure: {
          errorCode: error.code ?? null,
          errorMessage: error.message,
        },
      })
    )
  }
}

function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--platform')
  const platform = at === -1 ? '' : args.splice(at, 2)[1]
  if (!PLATFORMS.includes(platform)) throw new Error('native_host_platform_required')
  const [command, argument] = args
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, `native-host-${platform}.json`)
  const record = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { version: 3, platform, samples: [], firstFlow: null, metro: null }
  let recorded
  if (command === 'sample') {
    if (!SAMPLE_LABELS.includes(argument)) throw new Error('invalid_host_sample_label')
    const probe = (binary, args, valid = () => true) => {
      let r
      try {
        r = spawnSync(binary, args, {
          encoding: 'utf8',
          timeout: 10000,
          killSignal: 'SIGKILL',
        })
      } catch (error) {
        r = { status: null, error }
      }
      const usable = r.status === 0 && !r.error && valid(r.stdout ?? '')
      if (!usable) {
        const failure = probeFailure(argument, binary, args, r)
        recordProbeFailure(directory, failure)
      }
      return usable ? (r.stdout ?? '') : ''
    }
    const ps = probe(
      'ps',
      ['-A', '-o', 'pid=,ppid=,rss=,%cpu=,comm='],
      (text) => busiestProcesses(text).length > 0
    )
    recorded = projectSample({
      label: argument,
      at: Date.now(),
      loadavg: os.loadavg(),
      cpuCount: os.availableParallelism(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      swap: probe('sysctl', ['vm.swapusage']),
      pressure: probe('memory_pressure', ['-Q']),
      vm: probe('vm_stat', []),
      ps,
    })
    record.samples.push(recorded)
  } else if (command === 'first-flow') {
    // The first record stands: a later failure step never rewrites a passed flow.
    record.firstFlow ??= projectFirstFlow(
      firstMaestroLog(directory, platform),
      argument,
      firstMaestroTiming(directory, platform)
    )
    recorded = record.firstFlow
  } else if (command === 'metro') {
    record.metro = recordMetro(directory, platform)
    recorded = record.metro
  } else {
    console.error(
      'Usage: native-host-evidence.mjs sample <label> | first-flow <passed|failed> | metro --platform ios'
    )
    process.exit(2)
  }
  assertNativeHostEvidence(record)
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ [command]: recorded }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
