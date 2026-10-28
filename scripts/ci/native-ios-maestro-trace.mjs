/** Read and project the Maestro command trace a flow leaves in its debug output. */
import fs from 'node:fs'
import path from 'node:path'

function commandFiles(directory) {
  let entries = []
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return commandFiles(file)
    return entry.name === 'commands.json' ? [file] : []
  })
}

/** Every command row of every trace under the output directory; unreadable traces are skipped. */
export function maestroCommandRows(output) {
  return commandFiles(output).flatMap((file) => {
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  })
}

const COMMAND_NAME = /^[A-Za-z]{1,60}$/
const STATUSES = ['FAILED', 'RUNNING', 'COMPLETED', 'SKIPPED']

/** Commands that took at least `minMs`: name, status, depth and duration only, no selectors. */
export function slowMaestroCommands(output, minMs = 1000) {
  return maestroCommandRows(output).flatMap((row) => {
    const metadata = row?.metadata ?? {}
    const entry = Object.keys(metadata.evaluatedCommand ?? row?.command ?? {})[0]
    if (!Number.isSafeInteger(metadata.duration) || metadata.duration < minMs) return []
    return [
      {
        sequence: Number.isSafeInteger(metadata.sequenceNumber)
          ? metadata.sequenceNumber
          : null,
        depth: Number.isSafeInteger(metadata.depth) ? metadata.depth : null,
        name: COMMAND_NAME.test(entry ?? '') ? entry : 'unknown',
        status: STATUSES.includes(metadata.status) ? metadata.status : 'UNAVAILABLE',
        durationMs: metadata.duration,
      },
    ]
  })
}

/** Append one flow's slow commands to the run's timing receipt (nonfatal). */
export function recordIosCommandTimings({
  platform,
  flow,
  output,
  directory,
  log = console.log,
}) {
  if (platform !== 'ios') return null
  const entry = { flow, commands: slowMaestroCommands(output) }
  const file = path.join(directory, 'native-ios-flow-command-timings.json')
  try {
    const record = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { version: 1, flows: [] }
    record.flows.push(entry)
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  } catch (error) {
    log(
      JSON.stringify({ iosCommandTimingsWriteFailure: { errorCode: error.code ?? null } })
    )
  }
  return entry
}
