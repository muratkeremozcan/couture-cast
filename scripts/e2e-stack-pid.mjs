import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The ownership record the local E2E stack launcher
 * (scripts/start-api-e2e-with-workers.mjs) writes, so the Playwright global
 * teardown can stop that stack's workers before it resets the database they poll.
 *
 * Story 6.2b peer review (CX8): one shared pid file let two checkouts, or two
 * runs on different ports, overwrite each other's record, so one run's teardown
 * could stop the other's stack and a launcher's exit could delete the other's
 * record. The record is now keyed by repository root and web port, carries a
 * per-run token, and is only acted on when the pid still runs the launcher.
 */
export const E2E_STACK_LAUNCHER = 'start-api-e2e-with-workers'

/** The record path for the stack serving `webPort` from the checkout at `repoRoot`. */
export function e2eStackRecordPath(repoRoot, webPort, directory = os.tmpdir()) {
  let root = path.resolve(repoRoot)
  try {
    root = fs.realpathSync(root)
  } catch {
    // An unresolvable root still gets a stable key from its absolute path.
  }
  const key = crypto
    .createHash('sha256')
    .update(`${root}\0${String(webPort)}`)
    .digest('hex')
    .slice(0, 16)
  return path.join(directory, `couture-cast-e2e-stack-${key}.json`)
}

/** Writes this run's record and returns it. */
export function writeE2eStackRecord(recordPath, pid = process.pid) {
  const record = {
    pid,
    startedAt: new Date().toISOString(),
    token: crypto.randomBytes(16).toString('hex'),
  }
  fs.writeFileSync(recordPath, `${JSON.stringify(record)}\n`)
  return record
}

/** The record at `recordPath`, or null when it is absent or malformed. */
export function readE2eStackRecord(recordPath) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    return Number.isInteger(record?.pid) &&
      record.pid > 0 &&
      typeof record.token === 'string' &&
      record.token.length > 0
      ? record
      : null
  } catch {
    return null
  }
}

/** Removes the record only while it still belongs to the run holding `token`. */
export function removeE2eStackRecordIfOwned(recordPath, token) {
  if (readE2eStackRecord(recordPath)?.token !== token) return false
  fs.rmSync(recordPath, { force: true })
  return true
}

/** The command line of `pid`, or null when no such process runs. */
export function processCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** Whether `pid` is still the E2E stack launcher, and not a process that reused its pid. */
export function isE2eStackLauncher(pid, readCommand = processCommand) {
  return readCommand(pid)?.includes(E2E_STACK_LAUNCHER) === true
}

/**
 * Stops the stack the record at `recordPath` names and waits for it to exit. A
 * record whose pid no longer runs the launcher is stale: nothing is signalled,
 * and the record is removed if nobody replaced it meanwhile.
 */
export async function stopE2eStack(
  recordPath,
  { timeoutMs = 10_000, readCommand = processCommand } = {}
) {
  const record = readE2eStackRecord(recordPath)
  if (!record) return 'no-record'
  if (!isE2eStackLauncher(record.pid, readCommand)) {
    removeE2eStackRecordIfOwned(recordPath, record.token)
    return 'stale-record'
  }
  try {
    process.kill(record.pid, 'SIGTERM')
  } catch {
    return 'already-exited'
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(record.pid, 0)
    } catch {
      return 'stopped'
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 'still-running'
}
