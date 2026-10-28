#!/usr/bin/env node
/** Wait for the selected disposable simulator's startup services to settle. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  simulatorCommandRecorder,
  simulatorJobs,
  simulatorManager,
  extractionService,
} from './native-ios-command-evidence.mjs'
import { simulatorCollectors } from './native-ios-collectors.mjs'
import { crashReportCollector } from './native-ios-crashes.mjs'

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
  onSampleFailure = () => undefined,
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
    } catch (error) {
      onSampleFailure(error)
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

/** Two read-only snapshots retain exact command failures and project only safe client identities. */
export function sampleSimulatorCpu(
  manager,
  remaining,
  { execute = spawnSync, onCollectors = () => undefined, harnessPid = process.pid } = {}
) {
  const began = performance.now()
  const snapshot = (operation, fields) => {
    const started = performance.now()
    let result
    try {
      result = execute('ps', ['-A', '-ww', '-o', fields], {
        encoding: 'utf8',
        timeout: Math.max(1, Math.floor(Math.min(5000, remaining - (started - began)))),
        killSignal: 'SIGKILL',
      })
    } catch (error) {
      result = { status: null, error }
    }
    const diagnostic = {
      operation,
      reason: 'simulator_cpu_snapshot_failed',
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      errorCode: result.error?.code ?? null,
      errorName: result.error?.name ?? null,
      errorMessage: result.error?.message ?? null,
      durationMs: Math.round(performance.now() - started),
      // Command arguments from the collector inventory are never retained.
      stdout: operation === 'cpu-processes' ? (result.stdout ?? '') : '',
      stderr: result.stderr ?? '',
    }
    if (result.status !== 0 || result.error) {
      const error = new Error(diagnostic.reason)
      error.diagnostic = diagnostic
      throw error
    }
    return { result, diagnostic }
  }
  const cpu = snapshot('cpu-processes', 'pid=,ppid=,%cpu=,comm=')
  let values
  try {
    values = simulatorCpu(cpu.result.stdout, manager)
  } catch (error) {
    error.diagnostic = { ...cpu.diagnostic, reason: error.message }
    throw error
  }
  const clients = snapshot('collector-processes', 'pid=,ppid=,args=')
  onCollectors(
    simulatorCollectors(cpu.result.stdout, clients.result.stdout, manager, harnessPid)
  )
  return values
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

export function probeSimulatorTuning(device, execute) {
  const simctl = (operation, args, options) =>
    execute(operation, 'xcrun', ['simctl', ...args], options)
  simctl('log-level-off', ['spawn', device, 'log', 'config', '--mode', 'level:off'], {
    fatal: false,
  })
  const reported = simctl('manager-pid', ['spawn', device, 'launchctl', 'managerpid'], {
    fatal: false,
  })
  const listed = simctl('list-services', ['spawn', device, 'launchctl', 'list'], {
    fatal: false,
  })
  const ps = execute('simulator-processes', 'ps', ['-A', '-o', 'pid=,ppid=,%cpu=,comm='])
  const jobs = simulatorJobs(listed.stdout)
  const manager = simulatorManager(
    ps.stdout,
    jobs,
    reported.exitCode === 0 ? Number(reported.stdout.trim()) : null
  )
  const service = extractionService(ps.stdout, jobs, manager)
  if (service) {
    // The PID domain is the verified simulator bootstrap namespace, with the exact listed label.
    simctl(
      'bootout-extraction-service',
      ['spawn', device, 'launchctl', 'bootout', `pid/${manager}/${service.label}`],
      { fatal: false }
    )
  } else console.log(JSON.stringify({ extractionBootout: 'no_matching_owned_label' }))
  return manager
}

export async function quiesceOwnedSimulator(device, command) {
  if (
    process.platform !== 'darwin' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('quiesce_requires_disposable_macos')
  const directory = path.resolve(
    process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
  )
  const execute = command ?? simulatorCommandRecorder(directory)
  const simctl = (operation, args, options) =>
    execute(operation, 'xcrun', ['simctl', ...args], options)
  const devices = Object.values(
    JSON.parse(simctl('list-devices', ['list', 'devices', '--json']).stdout).devices
  ).flat()
  const selected = devices.find((d) => d.udid === device)
  if (!selected || !selected.name.startsWith('cc68-') || selected.state !== 'Booted')
    throw new Error('owned_booted_simulator_required')
  const manager = probeSimulatorTuning(device, execute)
  const collectors = { version: 1, managerPid: manager, snapshots: [] }
  const crashScan = crashReportCollector(device)
  const crashes = { version: 1, snapshots: [], reports: [] }
  const began = performance.now()
  const result = await waitForSimulatorCpu({
    sample: (remaining) =>
      sampleSimulatorCpu(manager, remaining, {
        onCollectors: (clients) => {
          collectors.snapshots.push({
            elapsedSeconds: Math.round((performance.now() - began) / 10) / 100,
            collectors: clients,
          })
          fs.writeFileSync(
            path.join(directory, 'native-ios-collectors.json'),
            JSON.stringify(collectors, null, 2) + '\n',
            { mode: 0o600 }
          )
        },
      }),
    onSampleFailure: (error) => {
      const diagnostic = error.diagnostic ?? {
        reason: error.message,
        errorName: error.name,
        errorCode: error.code ?? null,
      }
      fs.writeFileSync(
        path.join(directory, 'native-ios-sampler-private.json'),
        JSON.stringify(diagnostic, null, 2) + '\n',
        { mode: 0o600 }
      )
      console.log(JSON.stringify({ simulatorSamplingFailure: diagnostic }))
    },
    record: (value) => {
      assertNativeQuiesceEvidence(value)
      const crash = crashScan(value.elapsedSeconds)
      crashes.snapshots.push({
        elapsedSeconds: value.elapsedSeconds,
        sources: crash.sources,
        counts: crash.counts,
      })
      crashes.reports = crash.reports
      fs.writeFileSync(
        path.join(directory, 'native-ios-crashes.json'),
        JSON.stringify(crashes, null, 2) + '\n',
        { mode: 0o600 }
      )
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
  return result
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await quiesceOwnedSimulator(process.argv[2])
