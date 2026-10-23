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
 *
 * @param {string} artifactDir
 * @param {string} flowTitle
 * @returns {string | undefined}
 */
export function newestFlowDebugLog(artifactDir, flowTitle) {
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
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  return candidates[0]
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
