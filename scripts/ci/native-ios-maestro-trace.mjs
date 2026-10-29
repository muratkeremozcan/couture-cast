/** Read and project the Maestro command trace a flow leaves in its debug output. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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

/**
 * Share-card API requests from the owned API's JSON request log: path, method, status and
 * duration only (never user ids or bodies). The last [limit] rows are kept, newest last.
 */
export function shareCardApiRows(apiLog, limit = 20) {
  const rows = []
  for (const line of String(apiLog ?? '').split('\n')) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row?.path !== 'string' || !row.path.startsWith('/api/v1/share-cards/'))
      continue
    const method = ['GET', 'POST', 'PUT', 'DELETE'].includes(row.method)
      ? row.method
      : 'OTHER'
    rows.push({
      path: row.path.replace(/[^A-Za-z0-9/_-]/g, '_').slice(0, 80),
      method,
      status: Number.isSafeInteger(row.statusCode) ? row.statusCode : null,
      ms: Number.isSafeInteger(row.durationMs) ? row.durationMs : null,
    })
  }
  return rows.slice(-limit)
}

/** Current byte length of a log file, 0 when it does not exist yet. */
export function logSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** The last 256 KiB of a log file, never reaching before `fromByte`; '' when unreadable. */
function logTail(file, fromByte = 0) {
  try {
    const size = fs.statSync(file).size
    const length = Math.min(size - Math.min(fromByte, size), 256 * 1024)
    const fd = fs.openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, size - length)
      return buffer.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

const ALERT_BUTTONS = [
  "Don't Allow",
  'Don\u2019t Allow',
  'Allow',
  'Allow Once',
  'Allow Full Access',
  'Limit Access',
  'OK',
]

/** The hierarchy Maestro stored for the failed step (springboard alerts included), else null. */
export function failedStepHierarchy(output) {
  for (const file of commandFiles(output)) {
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
      const failed = (Array.isArray(rows) ? rows : [])
        .filter((row) => ['FAILED', 'RUNNING'].includes(row?.metadata?.status))
        .sort(
          (a, b) =>
            (b.metadata.depth ?? 0) - (a.metadata.depth ?? 0) ||
            (b.metadata.sequenceNumber ?? 0) - (a.metadata.sequenceNumber ?? 0)
        )[0]
      const base = path.dirname(file)
      for (const artifact of failed?.metadata?.artifacts ?? []) {
        // Artifact paths are relative to the trace, often in a subdirectory (screen-hierarchy/x.json).
        if (artifact?.type !== 'SCREEN_HIERARCHY' || typeof artifact.path !== 'string')
          continue
        if (path.isAbsolute(artifact.path)) continue
        const stored = path.resolve(base, artifact.path)
        if (!stored.startsWith(path.resolve(base) + path.sep)) continue
        return JSON.parse(fs.readFileSync(stored, 'utf8'))
      }
    } catch {
      // Unreadable raw artifacts stay private; the summary is then null.
    }
  }
  return null
}

/**
 * A closed summary of the screen at failure: node counts, which system alert buttons from a fixed
 * list are on it, and whether any text asks for permission. No raw text or identifiers leave.
 */
export function systemSurfaceSummary(hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object') return null
  const found = new Set()
  let nodeCount = 0
  let permissionTextSeen = false
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    nodeCount++
    for (const key of ['text', 'accessibilityText', 'title']) {
      const value = node.attributes?.[key]
      if (typeof value !== 'string') continue
      if (ALERT_BUTTONS.includes(value)) found.add(value.replace('\u2019', "'"))
      if (/would like to|access to your photos|add to your photos/i.test(value))
        permissionTextSeen = true
    }
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child)
  }
  visit(hierarchy)
  return {
    nodeCount,
    topLevelCount: Array.isArray(hierarchy.children) ? hierarchy.children.length : 0,
    alertButtons: [...found].sort(),
    permissionTextSeen,
  }
}

/** One closed host sample at this instant (paging counters, swap, top memory); nonfatal. */
export function recordIosHostSample(
  label,
  { root = process.cwd(), spawn = spawnSync, report = console.log } = {}
) {
  try {
    const result = spawn(
      process.execPath,
      ['scripts/ci/native-host-evidence.mjs', 'sample', label, '--platform', 'ios'],
      {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        timeout: 20000,
        killSignal: 'SIGKILL',
      }
    )
    if (result.status !== 0)
      report(
        JSON.stringify({ hostSampleFailure: { label, exitCode: result.status ?? null } })
      )
    return result.status === 0
  } catch {
    return false
  }
}

/** Append a failed flow's progress to the run's receipt (nonfatal, iOS only). */
export function recordIosFlowProgress({
  platform,
  flow,
  maestroLog,
  directory,
  apiLogFile = null,
  apiLogFromByte = 0,
  output = null,
  root = process.cwd(),
  spawn = spawnSync,
  report = console.log,
}) {
  if (platform !== 'ios') return null
  // Diagnostics never replace the original Maestro failure, so nothing here may throw.
  try {
    // First, so the sample is as close to the failure as the host allows.
    // Only the runner passes `output`; callers that record progress alone never sample the host.
    const hostSampled = output
      ? recordIosHostSample('flow-failure', { root, spawn, report })
      : false
    const entry = {
      flow,
      hostSampled,
      systemSurface: output ? systemSurfaceSummary(failedStepHierarchy(output)) : null,
      ...maestroFlowProgress(maestroLog),
      // Only rows written since the flow began, so an earlier flow's requests never pose as its own.
      shareCardApi: apiLogFile
        ? shareCardApiRows(logTail(apiLogFile, apiLogFromByte))
        : [],
    }
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
