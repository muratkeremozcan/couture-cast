/** Observe cold CoreSimulator startup while an independent worker enforces its setup cap. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { simulatorCollectors } from './native-ios-collectors.mjs'
import { crashReportCollector } from './native-ios-crashes.mjs'

export const RUNTIME_QUERY_CAP_MS = 300000

export function preflightProcesses(text) {
  return text.split('\n').flatMap((line) => {
    const m = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/)
    return m
      ? [
          {
            pid: Number(m[1]),
            ppid: Number(m[2]),
            state: m[3],
            cpuPercent: Number(m[4]),
            rssKB: Number(m[5]),
            command: path
              .basename(m[6].trim())
              .replace(/[^A-Za-z0-9._+-]/g, '_')
              .slice(0, 100),
          },
        ]
      : []
  })
}

export function preflightObserver(
  directory,
  { execute = spawnSync, crashScan = crashReportCollector(null) } = {}
) {
  const record = { version: 1, timeoutMs: RUNTIME_QUERY_CAP_MS, snapshots: [] }
  const began = performance.now()
  return (phase) => {
    const run = (binary, args) => {
      const r = execute(binary, args, {
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGKILL',
      })
      return {
        stdout: r.stdout ?? '',
        exitCode: r.status ?? null,
        errorCode: r.error?.code ?? null,
        stderr: r.stderr ?? '',
      }
    }
    const usage = run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,%cpu=,rss=,comm='])
    const argv = run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='])
    const mounted = run('/sbin/mount', [])
    const processes = preflightProcesses(usage.stdout)
    const elapsedSeconds = Math.round((performance.now() - began) / 10) / 100
    record.snapshots.push({
      phase,
      at: new Date().toISOString(),
      elapsedSeconds,
      load: os.loadavg(),
      processes: processes.filter((r) =>
        /CoreSimulatorService|simdiskimaged|SimulatorTrampoline|SimLaunchHost|^(?:simctl|xcrun|launchd_sim|diagnosticd|ReportCrash)$/.test(
          r.command
        )
      ),
      collectors: simulatorCollectors(
        processes
          .map((r) => `${r.pid} ${r.ppid} ${r.cpuPercent} ${r.command}`)
          .join('\n'),
        argv.stdout,
        0,
        process.pid
      ),
      runtimeMounts: mounted.stdout
        .split('\n')
        .filter((line) => /CoreSimulator|simruntime/i.test(line)),
      probes: Object.fromEntries(
        [
          ['processes', usage],
          ['arguments', argv],
          ['mounts', mounted],
        ].map(([key, r]) => [
          key,
          { exitCode: r.exitCode, errorCode: r.errorCode, stderr: r.stderr },
        ])
      ),
      crashes: crashScan(elapsedSeconds),
    })
    fs.writeFileSync(
      path.join(directory, 'native-ios-preflight.json'),
      JSON.stringify(record, null, 2) + '\n',
      { mode: 0o600 }
    )
  }
}

export async function observedRuntimeQuery({
  directory,
  command,
  observe,
  binary = 'xcrun',
  args = ['simctl', 'list', 'runtimes', '--json'],
  timeoutMs = RUNTIME_QUERY_CAP_MS,
  pollMs = 5000,
}) {
  fs.mkdirSync(directory, { recursive: true })
  observe('before-query')
  const began = performance.now()
  const timingFile = path.join(directory, 'native-ios-runtime-deadline.json')
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./native-ios-flow-deadline.mjs', import.meta.url)),
      'worker',
      timingFile,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.stdin.end(
    JSON.stringify({ binary, args, cwd: process.cwd(), env: process.env, timeoutMs })
  )
  const timer = setInterval(() => observe('during-query'), pollMs)
  let exitCode
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
  } finally {
    clearInterval(timer)
    observe('after-query')
  }
  const timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'))
  return command.completed(
    'list-runtimes',
    binary,
    args,
    {
      status: exitCode,
      signal: timing.timedOut ? 'SIGKILL' : null,
      error: timing.timedOut ? { code: 'ETIMEDOUT' } : null,
      stdout,
      stderr,
    },
    Math.round(performance.now() - began)
  )
}
