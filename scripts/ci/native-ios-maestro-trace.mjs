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

const PROGRESS_LINE =
  /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) \[ *\w+\] maestro\.cli\.runner\.MaestroCommandRunner\.runCommands\$lambda\$\d+: (.*) (RUNNING|COMPLETED|FAILED|SKIPPED)$/
// Only the leading words of a command label are kept: never its quoted text or coordinates.
const verbOf = (label) => /^[A-Za-z]+(?: [A-Za-z]+){0,2}/.exec(label)?.[0] ?? 'unknown'

/**
 * Where a flow was when it ended, from the progressive Maestro log: per command verb the
 * count of each status, the last command line and the seconds from the first to the last
 * command line. A killed flow leaves no command trace, so this is its only evidence.
 */
export function maestroFlowProgress(log) {
  const counts = new Map()
  let first = null
  let last = null
  for (const line of String(log ?? '').split('\n')) {
    const match = PROGRESS_LINE.exec(line)
    if (!match) continue
    const [, h, m, sec, ms, label, status] = match
    const at = Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(ms) / 1000
    first ??= at
    const verb = verbOf(label)
    const key = `${verb}\0${status}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    last = { verb, status, at }
  }
  return {
    commandLines: [...counts.values()].reduce((total, count) => total + count, 0),
    verbs: [...counts]
      .map(([key, count]) => ({
        verb: key.split('\0')[0],
        status: key.split('\0')[1],
        count,
      }))
      .sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb)),
    last: last && { verb: last.verb, status: last.status },
    spanSeconds: first === null ? null : Math.round((last.at - first) * 10) / 10,
  }
}

/** Append a failed flow's progress to the run's receipt (nonfatal, iOS only). */
export function recordIosFlowProgress({
  platform,
  flow,
  maestroLog,
  directory,
  report = console.log,
}) {
  if (platform !== 'ios') return null
  // Diagnostics never replace the original Maestro failure, so nothing here may throw.
  try {
    const entry = { flow, ...maestroFlowProgress(maestroLog) }
    const file = path.join(directory, 'native-ios-flow-progress.json')
    try {
      const record = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { version: 1, failedFlows: [] }
      record.failedFlows.push(entry)
      fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
    } catch (error) {
      report(
        JSON.stringify({ iosFlowProgressWriteFailure: { errorCode: error.code ?? null } })
      )
    }
    report(JSON.stringify({ iosFlowProgress: entry }))
    return entry
  } catch {
    return null
  }
}
