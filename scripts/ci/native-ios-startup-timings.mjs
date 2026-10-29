/**
 * Per-command durations of the simulator startup, for the public evidence upload. The full
 * startup record is private (arguments carry the device identifier and paths, output carries
 * anything a command printed), so nothing of it is copied. Only a row's operation name, whole
 * milliseconds and exit facts are projected, and a row whose name, signal or error code is not a
 * plain closed token is dropped.
 */
import fs from 'node:fs'
import path from 'node:path'

const OPERATION = /^[a-z0-9][a-z0-9-]{0,47}$/
const SIGNAL = /^SIG[A-Z0-9]{2,10}$/
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,24}$/
const MAX_ROWS = 300

const closedOrNull = (value, pattern) =>
  value === null || value === undefined
    ? { ok: true, value: null }
    : { ok: typeof value === 'string' && pattern.test(value), value }

/** The projected record, or null when there is no readable startup record. */
export function projectStartupTimings(directory) {
  let record
  try {
    record = JSON.parse(
      fs.readFileSync(path.join(directory, 'native-ios-startup-private.json'), 'utf8')
    )
  } catch {
    return null
  }
  if (!Array.isArray(record?.commands)) return null
  const commands = []
  for (const row of record.commands.slice(0, MAX_ROWS)) {
    const signal = closedOrNull(row?.signal, SIGNAL)
    const errorCode = closedOrNull(row?.errorCode, ERROR_CODE)
    const exitCode = row?.exitCode
    if (
      typeof row?.operation !== 'string' ||
      !OPERATION.test(row.operation) ||
      !Number.isFinite(row.durationMs) ||
      !(exitCode === null || Number.isSafeInteger(exitCode)) ||
      !signal.ok ||
      !errorCode.ok
    )
      continue
    commands.push({
      operation: row.operation,
      durationMs: Math.round(row.durationMs),
      exitCode,
      signal: signal.value,
      errorCode: errorCode.value,
    })
  }
  return { version: 1, commands }
}
