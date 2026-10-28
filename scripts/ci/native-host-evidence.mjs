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
  'before-simulator-boot',
  'after-simulator-boot',
  'before-first-flow',
  'after-first-flow',
  'failure',
]
const PLATFORMS = ['ios']
const PHASES = ['none', 'jvm', 'device', 'driver', 'flow']
const COMMAND = /^[A-Za-z0-9._+-]{1,32}$/
const TOP_PROCESSES = 8
const TOP_RSS_PROCESSES = 15

/**
 * The busiest processes from `ps -A -r -o %cpu=,ucomm=` output, by CPU share.
 * A command name outside the closed character set becomes `other`.
 *
 * @param {string} text
 */
export function busiestProcesses(text, limit = TOP_PROCESSES) {
  const rows = []
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
    if (!match) continue
    const name = match[2]
      .trim()
      .replace(/[^A-Za-z0-9._+-]/g, '_')
      .slice(0, 32)
    rows.push({
      command: COMMAND.test(name) ? name : 'other',
      cpuPercent: Number(match[1]),
    })
  }
  return rows.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, limit)
}

/** Top resident processes. ps uses KiB; executable basenames contain no arguments. */
export function residentProcesses(text) {
  return text
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
      if (!match) return []
      const command = path
        .basename(match[3].trim())
        .replace(/[^A-Za-z0-9._+-]/g, '_')
        .slice(0, 32)
      return [
        {
          command: COMMAND.test(command) ? command : 'other',
          rssKB: Number(match[1]),
          cpuPercent: Number(match[2]),
        },
      ]
    })
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
 *   rss?: string
 *   swap?: string
 *   pressure?: string
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
    resident: residentProcesses(input.rss ?? ''),
    ...projectMemory(input.swap ?? '', input.pressure ?? ''),
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
export function projectFirstFlow(log, status) {
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
]
const FLOW_SECONDS = ['totalSeconds', 'jvmSeconds', 'driverSeconds', 'flowSeconds']
const nonNegative = (value) => Number.isFinite(value) && value >= 0
const count = (value) => Number.isSafeInteger(value) && value >= 0
const isoTime = (value) =>
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value

const validProcess = (row) =>
  exactKeys(row, ['command', 'cpuPercent']) &&
  COMMAND.test(row.command) &&
  nonNegative(row.cpuPercent)

const validResident = (row) =>
  exactKeys(row, ['command', 'rssKB', 'cpuPercent']) &&
  COMMAND.test(row.command) &&
  count(row.rssKB) &&
  nonNegative(row.cpuPercent)

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
  sample.resident.every(validResident) &&
  seconds(sample.swapUsedMB) &&
  validPressure(sample.memoryPressureFreePercent)

const validFlow = (flow) =>
  flow === null ||
  (exactKeys(flow, ['status', 'reached', ...FLOW_SECONDS]) &&
    ['passed', 'failed'].includes(flow.status) &&
    PHASES.includes(flow.reached) &&
    FLOW_SECONDS.every((key) => seconds(flow[key])))

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
    value.version !== 1 ||
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
    : { version: 1, platform, samples: [], firstFlow: null, metro: null }
  let recorded
  if (command === 'sample') {
    recorded = projectSample({
      label: argument,
      at: Date.now(),
      loadavg: os.loadavg(),
      cpuCount: os.availableParallelism(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      rss:
        spawnSync('ps', ['-A', '-o', 'rss=,%cpu=,comm='], {
          encoding: 'utf8',
          timeout: 10000,
        }).stdout ?? '',
      swap:
        spawnSync('sysctl', ['vm.swapusage'], { encoding: 'utf8', timeout: 10000 })
          .stdout ?? '',
      pressure:
        spawnSync('memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 10000 })
          .stdout ?? '',
      ps:
        spawnSync('ps', ['-A', '-r', '-o', '%cpu=,ucomm='], { encoding: 'utf8' })
          .stdout ?? '',
    })
    record.samples.push(recorded)
  } else if (command === 'first-flow') {
    // The first record stands: a later failure step never rewrites a passed flow.
    record.firstFlow ??= projectFirstFlow(firstMaestroLog(directory, platform), argument)
    recorded = record.firstFlow
  } else if (command === 'metro') {
    const log = path.join(directory, 'metro.log')
    record.metro = projectMetro(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '')
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
