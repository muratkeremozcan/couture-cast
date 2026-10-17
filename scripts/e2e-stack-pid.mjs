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
 * record. The record is keyed by repository root and web port and carries a
 * per-run token that guards its removal.
 *
 * Story 6.2b second peer review (CX8b): a record left by a launcher that died
 * abruptly names a pid the OS can hand to another launcher, including another
 * checkout's, whose command line also names the launcher script. The record
 * therefore carries the launcher's OS process start time and its absolute script
 * path, and the teardown re-reads both from the live process immediately before
 * signalling. A different start time, or a command line without this checkout's
 * absolute launcher path as a whole argument, means the pid is not the launcher
 * that wrote the record, and nothing is signalled.
 */
export const E2E_STACK_LAUNCHER = 'start-api-e2e-with-workers'
const LAUNCHER_RELATIVE_PATH = `scripts/${E2E_STACK_LAUNCHER}.mjs`

function realpathOr(filePath) {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return filePath
  }
}

/** The absolute launcher script path of the checkout at `repoRoot`, symlinks resolved. */
export function e2eStackLauncherPath(repoRoot) {
  return realpathOr(path.join(path.resolve(repoRoot), LAUNCHER_RELATIVE_PATH))
}

/** The record path for the stack serving `webPort` from the checkout at `repoRoot`. */
export function e2eStackRecordPath(repoRoot, webPort, directory = os.tmpdir()) {
  const root = realpathOr(path.resolve(repoRoot))
  const key = crypto
    .createHash('sha256')
    .update(`${root}\0${String(webPort)}`)
    .digest('hex')
    .slice(0, 16)
  return path.join(directory, `couture-cast-e2e-stack-${key}.json`)
}

function ps(field, pid) {
  try {
    const value = execFileSync('ps', ['-ww', '-o', `${field}=`, '-p', String(pid)], {
      encoding: 'utf8',
      // A fixed locale keeps `lstart` in one format for the writer and the reader.
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return value || null
  } catch {
    return null
  }
}

/**
 * What the OS reports for `pid` now: its start time (`ps -o lstart`) and its
 * full command line, or null when no such process runs.
 */
export function readProcessIdentity(pid) {
  const startedAt = ps('lstart', pid)
  const command = ps('command', pid)
  return startedAt && command ? { startedAt, command } : null
}

/**
 * Whether `command` carries `argument` as one whole argument: bounded by the
 * start or end of the line or by whitespace. A plain substring test would accept
 * `/elsewhere/repo/scripts/...` for `/repo/scripts/...`.
 */
export function commandHasArgument(command, argument) {
  if (typeof command !== 'string' || typeof argument !== 'string' || !argument) {
    return false
  }
  let from = 0
  for (;;) {
    const index = command.indexOf(argument, from)
    if (index < 0) return false
    const before = index === 0 ? ' ' : command[index - 1]
    const after = command[index + argument.length] ?? ' '
    if (/\s/.test(before) && /\s/.test(after)) return true
    from = index + 1
  }
}

/**
 * Why the live process is not the launcher `record` describes for the checkout
 * whose launcher is `expectedLauncherPath`, or null when it is.
 */
export function launcherIdentityMismatch(record, liveIdentity, expectedLauncherPath) {
  if (!liveIdentity) return 'not-running'
  if (record.launcherPath !== expectedLauncherPath) return 'launcher-path-mismatch'
  if (liveIdentity.startedAt !== record.processStartedAt) return 'start-time-mismatch'
  if (!commandHasArgument(liveIdentity.command, expectedLauncherPath)) {
    return 'command-mismatch'
  }
  return null
}

/**
 * Writes this run's record and returns it, or returns null without writing when
 * the launcher's own live identity would not verify: a launcher started through
 * a relative script path has a command line the teardown could never match.
 */
export function writeE2eStackRecord(
  recordPath,
  { pid = process.pid, launcherPath, readIdentity = readProcessIdentity }
) {
  const identity = readIdentity(pid)
  const record = {
    pid,
    processStartedAt: identity?.startedAt ?? null,
    launcherPath,
    writtenAt: new Date().toISOString(),
    token: crypto.randomBytes(16).toString('hex'),
  }
  if (launcherIdentityMismatch(record, identity, launcherPath) !== null) return null
  fs.writeFileSync(recordPath, `${JSON.stringify(record)}\n`)
  return record
}

/** The record at `recordPath`, or null when it is absent, malformed or predates CX8b. */
export function readE2eStackRecord(recordPath) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    return Number.isInteger(record?.pid) &&
      record.pid > 0 &&
      typeof record.token === 'string' &&
      record.token.length > 0 &&
      typeof record.processStartedAt === 'string' &&
      record.processStartedAt.length > 0 &&
      typeof record.launcherPath === 'string' &&
      path.isAbsolute(record.launcherPath)
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

/**
 * Stops the stack the record at `recordPath` names and waits for it to exit,
 * only when the live process is the launcher the record describes: the same OS
 * start time, and `expectedLauncherPath` (this checkout's launcher) on its
 * command line. Otherwise nothing is signalled, the mismatch is returned, and the
 * record is removed if nobody replaced it meanwhile.
 */
export async function stopE2eStack(
  recordPath,
  { expectedLauncherPath, timeoutMs = 10_000, readIdentity = readProcessIdentity }
) {
  if (
    typeof expectedLauncherPath !== 'string' ||
    !path.isAbsolute(expectedLauncherPath)
  ) {
    throw new Error('stopE2eStack needs the absolute launcher path of this checkout')
  }
  const fileExists = fs.existsSync(recordPath)
  const record = readE2eStackRecord(recordPath)
  if (!record) {
    if (fileExists) fs.rmSync(recordPath, { force: true })
    return fileExists ? 'unreadable-record' : 'no-record'
  }
  // Re-read immediately before signalling, so the identity checked is the one
  // the signal reaches.
  const mismatch = launcherIdentityMismatch(
    record,
    readIdentity(record.pid),
    expectedLauncherPath
  )
  if (mismatch) {
    removeE2eStackRecordIfOwned(recordPath, record.token)
    return mismatch
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
