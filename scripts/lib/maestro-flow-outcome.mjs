/**
 * How a flow that left no JUnit report is reported.
 *
 * Maestro writes its JUnit report only when a flow finishes. A flow the runner
 * killed at its watchdog timeout has none, and it used to be reported only as
 * "JUnit report could not be read", which hid the real failure: in CI job
 * 120347100806 the retry of `community-feed.yaml` timed out exactly like its
 * first attempt, and the summary named a missing file instead (Story 1.2b R28).
 * The kill is the failure, and the last command Maestro started says where the
 * time went.
 */
import fs from 'node:fs'
import path from 'node:path'

const COMMAND_START = /onCommandStart: (.+) RUNNING\s*$/

/**
 * The last command Maestro logged as started, from its debug `maestro.log`.
 *
 * @param {string} logText
 * @returns {string | undefined}
 */
export function lastStartedMaestroCommand(logText) {
  const lines = logText.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = COMMAND_START.exec(lines[index] ?? '')
    if (match) return match[1]
  }
  return undefined
}

/**
 * The newest debug `maestro.log` Maestro wrote for a flow named `flowTitle`
 * (the flow's `name:`), under `<artifactDir>/<timestamp>/<flowTitle>/logs/`.
 * Only logs written at or after `sinceMs` count, so a killed attempt that left
 * no log of its own is never described by an earlier run's (R29).
 *
 * @param {string} artifactDir
 * @param {string} flowTitle
 * @param {{ sinceMs?: number }} [options]
 * @returns {string | undefined}
 */
export function newestFlowDebugLog(artifactDir, flowTitle, { sinceMs = 0 } = {}) {
  let runs
  try {
    runs = fs.readdirSync(artifactDir, { withFileTypes: true })
  } catch {
    return undefined
  }
  const candidates = runs
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(artifactDir, entry.name, flowTitle, 'logs', 'maestro.log'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .filter(({ mtimeMs }) => mtimeMs >= sinceMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  return candidates[0]?.file
}

/**
 * Deletes every file named like `reportPath` under `artifactRoot`, the exact
 * path included. The runner reads a missing report through a same-basename
 * search of the artifact tree (so a moved layout still resolves), and a stale
 * report left anywhere in that tree would otherwise judge an attempt Maestro
 * was killed before reporting (R29). Returns the paths removed.
 *
 * @param {string} artifactRoot
 * @param {string} reportPath
 * @returns {string[]}
 */
export function removeReportEverywhere(artifactRoot, reportPath) {
  const removed = []
  if (fs.existsSync(reportPath)) {
    fs.rmSync(reportPath, { force: true })
    removed.push(reportPath)
  }
  const wanted = path.basename(reportPath)
  const stack = [artifactRoot]
  while (stack.length > 0) {
    const directory = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === wanted) {
        fs.rmSync(full, { force: true })
        removed.push(full)
      }
    }
  }
  return removed
}

/**
 * The failure line for a flow whose JUnit report is missing or unreadable.
 *
 * @param {string} flowPath
 * @param {string} unreadable why the report could not be read
 * @param {Error | undefined} maestroExitError
 * @param {string | undefined} lastCommand
 * @returns {string}
 */
export function describeMissingReport(
  flowPath,
  unreadable,
  maestroExitError,
  lastCommand
) {
  const reached = lastCommand ? `, last command started: ${lastCommand}` : ''
  if (maestroExitError) {
    return `${flowPath} (${maestroExitError.message}${reached}; Maestro wrote no JUnit report)`
  }
  return `${flowPath} (JUnit report unreadable: ${unreadable}${reached})`
}

/**
 * A flow's `name:`, which Maestro uses for its debug output directory.
 *
 * @param {string} yamlText
 * @returns {string | undefined}
 */
export function flowTitleOf(yamlText) {
  const header = yamlText.split(/^---\s*$/m)[0] ?? ''
  const match = /^name:\s*(['"]?)(.+?)\1\s*$/m.exec(header)
  return match?.[2]
}
