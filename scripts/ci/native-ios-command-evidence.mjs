/** Full startup-command diagnostics remain in the requested CI diagnostic artifact. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export function simulatorCommandRecorder(directory, execute = spawnSync) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, 'native-ios-startup-private.json')
  const record = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { version: 1, commands: [] }
  const completed = (
    operation,
    binary,
    args,
    result,
    durationMs,
    { fatal = true } = {}
  ) => {
    const row = {
      operation,
      binary,
      args,
      durationMs,
      exitCode: result.status,
      signal: result.signal ?? null,
      errorCode: result.error?.code ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
    record.commands.push(row)
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify({ simulatorCommand: row }))
    if (fatal && (result.status !== 0 || result.error))
      throw new Error(
        `owned_simulator_command_failed:${operation}:${row.errorCode ?? row.exitCode}`
      )
    return row
  }
  const command = (operation, binary, args, { timeout = 60000, fatal = true } = {}) => {
    const began = performance.now()
    const result = execute(binary, args, {
      encoding: 'utf8',
      timeout,
      killSignal: 'SIGKILL',
    })
    return completed(
      operation,
      binary,
      args,
      result,
      Math.round(performance.now() - began),
      { fatal }
    )
  }
  command.completed = completed
  return command
}

export function simulatorJobs(text) {
  return text.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+|-)\s+-?\d+\s+(\S+)$/)
    return m && m[1] !== '-' ? [{ pid: Number(m[1]), label: m[2] }] : []
  })
}

export function simulatorManager(text, jobs, reported) {
  const rows = text.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    return m
      ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: path.basename(m[4]) }]
      : []
  })
  const spring = rows.find(
    (r) => r.command === 'SpringBoard' && jobs.some((job) => job.pid === r.pid)
  )
  const manager = rows.find(
    (r) => r.pid === spring?.ppid && r.command === 'launchd_sim'
  )?.pid
  if (manager) return manager
  if (
    rows.some((r) => r.pid === reported && r.command === 'launchd_sim') &&
    rows.some((r) => r.ppid === reported && r.command === 'SpringBoard')
  )
    return reported
  throw new Error('owned_simulator_manager_required')
}

export function extractionService(text, jobs, manager) {
  const owned = text.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    return m && Number(m[2]) === manager && path.basename(m[4]) === 'STExtractionService'
      ? [Number(m[1])]
      : []
  })
  return jobs.find(
    (job) => owned.includes(job.pid) && /^[A-Za-z0-9._:-]+$/.test(job.label)
  )
}
