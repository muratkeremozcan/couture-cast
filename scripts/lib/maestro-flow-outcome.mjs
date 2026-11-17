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
 * The folder names Maestro 2.8 can give a flow titled `flowTitle` inside one run's debug
 * output. TestDebugReporter.resolveFlowDir (maestro-cli-2.8.0.jar) turns "/" in the title
 * into "_", appends "-shard-<index + 1>" when TestCommand splits the run into more than one
 * shard (every iOS run of run-maestro-shards.mjs, which hands Maestro two or more
 * simulators), then appends "-2", "-3"... while that folder already exists.
 *
 * @param {string} flowTitle
 * @returns {RegExp}
 */
const flowFolderPattern = (flowTitle) => {
  const folder = flowTitle.replaceAll('/', '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${folder}(?:-shard-\\d+)?(?:-\\d+)?$`)
}

/**
 * The newest debug `maestro.log` Maestro wrote for a flow titled `flowTitle` (see
 * maestroFlowTitle), under `<artifactDir>/<run>/<flow folder>/logs/`, where the flow folder
 * is any name flowFolderPattern accepts. Only logs written at or after `sinceMs` count, so
 * a killed attempt that left no log of its own is never described by an earlier run's
 * (R29).
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
  const folder = flowFolderPattern(flowTitle)
  const candidates = runs
    .filter((entry) => entry.isDirectory())
    .flatMap((run) => {
      const runDir = path.join(artifactDir, run.name)
      try {
        return fs
          .readdirSync(runDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && folder.test(entry.name))
          .map((entry) => path.join(runDir, entry.name, 'logs', 'maestro.log'))
      } catch {
        return []
      }
    })
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

/**
 * The title Maestro files a flow under, in its debug output and its JUnit report: the
 * flow's `name:`, or the file name without its extension when it has none
 * (TestSuiteInteractor: `config?.name ?: flowFile.nameWithoutExtension`).
 * maestro/share-card-export.yaml, for one, has no `name:`.
 *
 * @param {string} flowPath
 * @param {string} yamlText
 * @returns {string}
 */
export function maestroFlowTitle(flowPath, yamlText) {
  return flowTitleOf(yamlText) ?? path.basename(flowPath, path.extname(flowPath))
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * The text of an XML attribute value, entities decoded. Maestro escapes its JUnit report,
 * so "Chip navigation & sticky bottom nav flow" is written with `&amp;`.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlText(text) {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (_, hex, dec, name) =>
      hex
        ? String.fromCodePoint(Number.parseInt(hex, 16))
        : dec
          ? String.fromCodePoint(Number(dec))
          : XML_ENTITIES[/** @type {keyof typeof XML_ENTITIES} */ (name.toLowerCase())]
  )
}

/**
 * Fails a flow with a named cause on top of whatever Maestro reported: a pass becomes a
 * failure, and an existing failure entry gains the cause, so the flow is still counted
 * once. The serial and Android paths record a flow by its path; the iOS sharded path
 * records it by the title its suite report used, which `reportedAs` names.
 *
 * @param {string[]} flowFailures collected in place
 * @param {Set<string>} flowPasses collected in place
 * @param {string} flowPath
 * @param {string} cause
 * @param {{ reportedAs?: string }} [options]
 * @returns {void}
 */
export function addFlowFailureCause(
  flowFailures,
  flowPasses,
  flowPath,
  cause,
  { reportedAs } = {}
) {
  const names = reportedAs ? [flowPath, reportedAs] : [flowPath]
  for (const name of names) flowPasses.delete(name)
  const index = flowFailures.findLastIndex((entry) =>
    names.some((name) => entry === name || entry.startsWith(`${name} (`))
  )
  if (index === -1) {
    flowFailures.push(`${flowPath} (${cause})`)
  } else {
    flowFailures[index] = `${flowFailures[index]} (${cause})`
  }
}
