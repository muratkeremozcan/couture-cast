#!/usr/bin/env node
/** Wait for the selected disposable simulator's startup services to settle. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const CPU_TARGETS = ['STExtractionService', 'healthappd', 'diagnosticd']
export const QUIESCE_POLICY = Object.freeze({
  thresholdPercent: 5,
  stableSeconds: 30,
  maxSeconds: 600,
  pollMs: 5000,
})

export function simulatorCpu(text, managerPid) {
  const rows = text.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    return m
      ? [
          {
            pid: Number(m[1]),
            ppid: Number(m[2]),
            cpu: Number(m[3]),
            command: path.basename(m[4].trim()),
          },
        ]
      : []
  })
  if (!rows.some((row) => row.pid === managerPid && row.command === 'launchd_sim'))
    throw new Error('owned_simulator_manager_missing')
  const owned = new Set([managerPid])
  let added
  do {
    added = false
    for (const row of rows)
      if (owned.has(row.ppid) && !owned.has(row.pid)) {
        owned.add(row.pid)
        added = true
      }
  } while (added)
  if (!rows.some((row) => owned.has(row.pid) && row.command === 'SpringBoard'))
    throw new Error('owned_simulator_springboard_missing')
  return Object.fromEntries(
    CPU_TARGETS.map((name) => [
      name,
      Math.max(
        0,
        ...rows
          .filter((row) => owned.has(row.pid) && row.command === name)
          .map((row) => row.cpu)
      ),
    ])
  )
}

export async function waitForSimulatorCpu({
  sample,
  now = () => performance.now(),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  policy = QUIESCE_POLICY,
  record = () => undefined,
}) {
  const began = now()
  let quietSince = null
  const result = {
    version: 1,
    platform: 'ios',
    thresholdPercent: policy.thresholdPercent,
    stableRequiredSeconds: policy.stableSeconds,
    maxWaitSeconds: policy.maxSeconds,
    outcome: 'waiting',
    elapsedSeconds: 0,
    samples: [],
  }
  const save = () => {
    result.elapsedSeconds = Math.round((now() - began) / 10) / 100
    record(result)
  }
  while (result.outcome === 'waiting') {
    if (now() - began > policy.maxSeconds * 1000) {
      result.outcome = 'cap_hit'
      save()
      return result
    }
    let cpu
    try {
      cpu = await sample(Math.max(1, policy.maxSeconds * 1000 - (now() - began)))
    } catch {
      result.outcome = 'sample_failed'
      save()
      return result
    }
    const at = now()
    result.samples.push({ elapsedSeconds: Math.round((at - began) / 10) / 100, cpu })
    if (
      CPU_TARGETS.every(
        (name) =>
          Number.isFinite(cpu[name]) &&
          cpu[name] >= 0 &&
          cpu[name] <= policy.thresholdPercent
      )
    )
      quietSince ??= at
    else quietSince = null
    if (
      at - began <= policy.maxSeconds * 1000 &&
      quietSince !== null &&
      at - quietSince >= policy.stableSeconds * 1000
    ) {
      result.outcome = 'settled'
      save()
      return result
    }
    if (at - began >= policy.maxSeconds * 1000) result.outcome = 'cap_hit'
    save()
    if (result.outcome === 'cap_hit') return result
    await pause(Math.min(policy.pollMs, policy.maxSeconds * 1000 - (now() - began)))
  }
  return result
}

const keys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...expected].sort().join()
const nonnegative = (value) => Number.isFinite(value) && value >= 0
const validHeader = (value) =>
  keys(value, [
    'version',
    'platform',
    'thresholdPercent',
    'stableRequiredSeconds',
    'maxWaitSeconds',
    'outcome',
    'elapsedSeconds',
    'samples',
  ]) &&
  value.version === 1 &&
  value.platform === 'ios' &&
  value.thresholdPercent === 5 &&
  value.stableRequiredSeconds === 30 &&
  value.maxWaitSeconds === 600 &&
  ['waiting', 'settled', 'cap_hit', 'sample_failed'].includes(value.outcome) &&
  nonnegative(value.elapsedSeconds)
const validSample = (s) =>
  keys(s, ['elapsedSeconds', 'cpu']) &&
  nonnegative(s.elapsedSeconds) &&
  keys(s.cpu, CPU_TARGETS) &&
  CPU_TARGETS.every((name) => nonnegative(s.cpu[name]))
function settledEvidence(value) {
  if (value.outcome !== 'settled') return true
  const last = value.samples.at(-1)
  let firstQuiet = null
  for (const s of value.samples) {
    if (CPU_TARGETS.every((name) => s.cpu[name] <= value.thresholdPercent))
      firstQuiet ??= s
    else firstQuiet = null
  }
  return (
    !!last &&
    !!firstQuiet &&
    last.elapsedSeconds - firstQuiet.elapsedSeconds >= 30 &&
    value.elapsedSeconds <= 600
  )
}
export function assertNativeQuiesceEvidence(value) {
  if (
    !validHeader(value) ||
    !Array.isArray(value.samples) ||
    value.samples.length > 130 ||
    !value.samples.every(validSample) ||
    !settledEvidence(value)
  )
    throw new Error('invalid_native_quiesce_evidence')
}

function execute(args, timeout = 15000) {
  const r = spawnSync('xcrun', args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
  if (r.status !== 0) throw new Error('owned_simulator_command_failed')
  return r.stdout
}

async function main() {
  if (
    process.platform !== 'darwin' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('quiesce_requires_disposable_macos')
  const device = process.argv[2]
  const devices = Object.values(
    JSON.parse(execute(['simctl', 'list', 'devices', '--json'])).devices
  ).flat()
  const selected = devices.find((d) => d.udid === device)
  if (!selected || !selected.name.startsWith('cc68-') || selected.state !== 'Booted')
    throw new Error('owned_booted_simulator_required')
  // This changes logging inside the exact owned simulator only.
  execute(['simctl', 'spawn', device, 'log', 'config', '--mode', 'level:off'])
  console.log(JSON.stringify({ simulatorLoggingLevel: 'off' }))
  const manager = Number(
    execute(['simctl', 'spawn', device, 'launchctl', 'managerpid']).trim()
  )
  if (!Number.isSafeInteger(manager) || manager <= 1)
    throw new Error('owned_simulator_manager_required')
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const result = await waitForSimulatorCpu({
    sample: (remaining) => {
      const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,%cpu=,comm='], {
        encoding: 'utf8',
        timeout: Math.min(5000, remaining),
        killSignal: 'SIGKILL',
      })
      if (r.status !== 0) throw new Error('simulator_cpu_snapshot_failed')
      return simulatorCpu(r.stdout, manager)
    },
    record: (value) => {
      assertNativeQuiesceEvidence(value)
      fs.writeFileSync(
        path.join(directory, 'native-quiesce-ios.json'),
        JSON.stringify(value, null, 2) + '\n',
        { mode: 0o600 }
      )
      console.log(
        JSON.stringify({
          quiesce: {
            outcome: value.outcome,
            elapsedSeconds: value.elapsedSeconds,
            cpu: value.samples.at(-1)?.cpu ?? null,
          },
        })
      )
    },
  })
  if (result.outcome !== 'settled') throw new Error(`ios_quiesce_${result.outcome}`)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
