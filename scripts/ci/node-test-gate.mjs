#!/usr/bin/env node
// Runs one node:test suite from node-test-suites.json and fails unless every file in it
// reported at least one passing test and nothing failed, skipped or stayed todo. A bare
// `node --test` exits 0 for a skipped test, a todo test or an empty file.
//
// The default suite discovers every *.test.mjs and *.spec.mjs under scripts/ that no
// pinned suite claims, so a new or split test file runs without a workflow edit.
// Before running, the gate checks that the manifest and the workflow cover every
// discovered file and every suite, that no gate step has a condition outside the
// explicit-prerequisite grammar, and that each gate step waits only on the steps its
// suites declare in conditionNeeds, so a suite with no database or browser need cannot
// hide behind a failed runtime. A gate step must also run on every matrix row its
// suites cover: all rows, unless rowRestrictions limits a suite to listed values.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import {
  evaluateApprovedCondition,
  isExplicitPrerequisiteCondition,
  matrixReferenceProblems,
  matrixRows,
} from './workflow-step-shadowing.mjs'

export const GATE_SCRIPT = 'scripts/ci/node-test-gate.mjs'
const repository = fileURLToPath(new URL('../../', import.meta.url))
const reporter = pathToFileURL(
  fileURLToPath(new URL('./node-test-gate-reporter.mjs', import.meta.url))
).href

export function loadManifest(root = repository) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'scripts/ci/node-test-suites.json'), 'utf8')
  )
}

/** Every test file under the discovery root, repo-relative with forward slashes. */
export function discoverTestFiles(root, manifest) {
  const pattern = new RegExp(manifest.discoverPattern)
  const found = []
  const visit = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(child)
      } else if (entry.isFile() && pattern.test(entry.name)) found.push(child)
    }
  }
  visit(manifest.discoverRoot)
  return found.sort()
}

function pinnedFiles(manifest) {
  return Object.values(manifest.suites).flatMap((files) =>
    Array.isArray(files) ? files : []
  )
}

export function resolveSuite(
  name,
  { root = repository, manifest = loadManifest(root) } = {}
) {
  const files = manifest.suites[name]
  if (files === undefined) throw new Error(`node_test_gate_unknown_suite: ${name}`)
  if (Array.isArray(files)) return [...files]
  const claimed = new Set([...pinnedFiles(manifest), ...manifest.vitest])
  return discoverTestFiles(root, manifest).filter((file) => !claimed.has(file))
}

/** The suite a workflow `run:` line hands to the gate, or null for any other line. */
export function gatedSuite(line) {
  const tokens = line.trim().split(/\s+/)
  return tokens[0] === 'node' && tokens[1] === GATE_SCRIPT && tokens.length === 3
    ? tokens[2]
    : null
}

/** True when a workflow step's `run:` text gates a suite that contains the file. */
export function runGatesTestFile(run, file, options) {
  return (run ?? '')
    .split(/\r?\n/)
    .map(gatedSuite)
    .some((name) => name !== null && resolveSuite(name, options).includes(file))
}

const IMPORTS_NODE_TEST =
  /\bfrom\s+['"]node:test['"]|\bimport\s*\(\s*['"]node:test['"]\s*\)|\brequire\s*\(\s*['"]node:test['"]\s*\)/

/** Files that import node:test under the discovery root and the pinned suites' folders. */
export function nodeTestImporters(root, manifest) {
  const found = []
  const visit = (relative, recursive, pattern) => {
    for (const entry of fs.readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (recursive && entry.name !== 'node_modules') visit(child, recursive, pattern)
      } else if (
        entry.isFile() &&
        pattern.test(entry.name) &&
        IMPORTS_NODE_TEST.test(fs.readFileSync(path.join(root, child), 'utf8'))
      )
        found.push(child)
    }
  }
  visit(manifest.discoverRoot, true, /\.mjs$/)
  const folders = new Set(
    pinnedFiles(manifest)
      .map((file) => path.posix.dirname(file))
      .filter((folder) => !`${folder}/`.startsWith(`${manifest.discoverRoot}/`))
  )
  for (const folder of folders) visit(folder, false, /\.(m?js|cjs)$/)
  return found.sort()
}

function manifestProblems(root, manifest) {
  const problems = []
  // A node:test file renamed out of the discovery pattern would otherwise drop out.
  const known = new Set([
    ...discoverTestFiles(root, manifest),
    ...pinnedFiles(manifest),
    ...manifest.vitest,
    ...Object.keys(manifest.runElsewhere ?? {}),
  ])
  for (const file of nodeTestImporters(root, manifest))
    if (!known.has(file))
      problems.push(`${file} imports node:test but is neither discovered nor listed`)
  for (const file of Object.keys(manifest.runElsewhere ?? {}))
    if (!fs.existsSync(path.join(root, file))) problems.push(`${file} is missing`)
  const names = Object.keys(manifest.suites)
  const discovering = names.filter((name) => manifest.suites[name] === 'discover')
  if (discovering.length !== 1)
    problems.push(`exactly one discovering suite required, found ${discovering.length}`)
  const listed = [...pinnedFiles(manifest), ...manifest.vitest]
  for (const file of new Set(listed)) {
    if (listed.indexOf(file) !== listed.lastIndexOf(file))
      problems.push(`${file} is listed more than once`)
    if (!fs.existsSync(path.join(root, file))) problems.push(`${file} is missing`)
  }
  for (const name of names)
    if (manifest.suites[name] !== 'discover' && !manifest.suites[name].length)
      problems.push(`suite ${name} lists no file`)
  return problems
}

// A suite runs as early as its declared needs allow: a step may wait only on the
// steps its suites need, so a later Supabase or browser failure cannot hide them.
function needsProblems(manifest, step, lines) {
  const needs = manifest.conditionNeeds ?? {}
  const suites = lines.map(gatedSuite).filter(Boolean)
  if (lines.some((line) => /^npx vitest run\b/.test(line))) suites.push('vitest')
  const allowed = new Set(suites.flatMap((suite) => needs[suite] ?? []))
  const problems = suites
    .filter((suite) => suite === 'vitest' || manifest.suites[suite] !== undefined)
    .filter((suite) => !Array.isArray(needs[suite]))
    .map((suite) => `suite ${suite} declares no conditionNeeds`)
  for (const [, id] of String(step.if ?? '').matchAll(/\bsteps\.([A-Za-z0-9_-]+)\./g))
    if (!allowed.has(id))
      problems.push(
        `step ${step.name ?? step.id ?? 'unnamed'} waits on steps.${id}, which ${suites.join(' and ')} does not need`
      )
  return [...new Set(problems)]
}

const stepSuites = (lines) => [
  ...lines.map(gatedSuite).filter(Boolean),
  ...(lines.some((line) => /^npx vitest run\b/.test(line)) ? ['vitest'] : []),
]
const rowLabel = (row) =>
  Object.entries(row)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'the only row'
const allSucceeded = new Proxy({}, { get: () => 'success' })

// A matrix clause that narrows a step drops its suites on the other rows, so a gate
// step must run on every row its suites cover: all rows, unless the manifest's
// rowRestrictions limits a suite to rows with the listed key values.
function rowProblems(manifest, step, lines, matrix) {
  if (!isExplicitPrerequisiteCondition(step.if, { matrix })) return []
  const rows = matrixRows(matrix)
  if (rows === null) return []
  const restrictions = manifest.rowRestrictions ?? {}
  const covers = (suite, row) =>
    Object.entries(restrictions[suite] ?? {}).every(([key, values]) =>
      values.map(String).includes(String(row[key]))
    )
  const problems = []
  for (const row of rows) {
    const runs = evaluateApprovedCondition(step.if, {
      matrix,
      row,
      outcomes: allSucceeded,
    })
    const dropped = stepSuites(lines).filter((suite) => covers(suite, row))
    if (!runs && dropped.length)
      problems.push(
        `step ${step.name ?? step.id ?? 'unnamed'} skips matrix row ${rowLabel(row)}, which ${dropped.join(' and ')} must run on`
      )
  }
  return problems
}

const stepLines = (step) => (step.run ?? '').split(/\r?\n/).map((line) => line.trim())

// A condition that can skip a gate step silences its suite on a green run, and
// continue-on-error turns its failure into a green step.
function gateStepProblems(manifest, step, matrix) {
  const lines = stepLines(step)
  const runsTests = lines.some(
    (line) =>
      gatedSuite(line) !== null ||
      (/^npx vitest run\b/.test(line) &&
        manifest.vitest.some((file) => line.includes(file)))
  )
  if (!runsTests) return []
  const name = step.name ?? step.id ?? 'unnamed'
  return [
    ...(isExplicitPrerequisiteCondition(step.if, { matrix })
      ? []
      : [`step ${name} can be skipped by its condition: ${JSON.stringify(step.if)}`]),
    ...matrixReferenceProblems(step.if, matrix).map(
      (problem) => `step ${name}: ${problem}`
    ),
    ...(Object.hasOwn(step, 'continue-on-error')
      ? [
          `step ${name} sets continue-on-error (${JSON.stringify(step['continue-on-error'])}), which hides a gate failure`,
        ]
      : []),
    ...needsProblems(manifest, step, lines),
    ...rowProblems(manifest, step, lines, matrix),
  ]
}

function workflowProblems(manifest, workflow) {
  const problems = []
  const names = Object.keys(manifest.suites)
  const jobs = Object.values(parse(workflow).jobs ?? {})
  const steps = jobs.flatMap((job) => job.steps ?? [])
  const lines = steps.flatMap(stepLines)
  for (const job of jobs)
    for (const step of job.steps ?? [])
      problems.push(...gateStepProblems(manifest, step, job.strategy?.matrix))
  const invoked = new Set(lines.map(gatedSuite).filter(Boolean))
  for (const name of invoked)
    if (!names.includes(name)) problems.push(`workflow runs unknown suite ${name}`)
  for (const name of names)
    if (!invoked.has(name)) problems.push(`suite ${name} runs in no workflow step`)
  for (const line of lines)
    if (/^node\s+--test\b/.test(line)) problems.push(`ungated node --test step: ${line}`)
  for (const file of manifest.vitest)
    if (!lines.some((line) => /^npx vitest run\b/.test(line) && line.includes(file)))
      problems.push(`${file} runs in no vitest step`)
  return problems
}

/** Ways the manifest and workflow fail to run every test file exactly once. */
export function coverageProblems({
  root = repository,
  manifest = loadManifest(root),
  workflow = fs.readFileSync(path.join(root, manifest.workflow), 'utf8'),
} = {}) {
  return [...manifestProblems(root, manifest), ...workflowProblems(manifest, workflow)]
}

function canonical(cwd, file) {
  const absolute = path.resolve(cwd, file)
  try {
    return fs.realpathSync(absolute)
  } catch {
    return absolute
  }
}

/**
 * The runner reports a file that loads no test, or fails to load, as one top-level
 * event named after the file itself. That wrapper never counts as a passing test,
 * so an empty file cannot pass on its own.
 */
const isFileWrapper = (event, cwd) =>
  event.nesting === 0 && canonical(cwd, event.name) === canonical(cwd, event.file)

// Fail closed when a Node release reports a different event shape.
function assertAttributable(event) {
  if (
    typeof event.name !== 'string' ||
    typeof event.file !== 'string' ||
    !Number.isInteger(event.nesting)
  )
    throw new Error(
      `node_test_gate_failed: a test event lacks the name, file or nesting that attribution needs (Node ${process.version})`
    )
}

export function summarizeNodeTestEvents(events, files, cwd = process.cwd()) {
  const summary = { passed: 0, failed: 0, skipped: 0, todo: 0, perFile: {} }
  const byPath = new Map(files.map((file) => [canonical(cwd, file), file]))
  for (const file of files) summary.perFile[file] = 0
  for (const event of events) {
    assertAttributable(event)
    if (event.outcome === 'fail' && !event.todo) summary.failed++
    if (event.skip) summary.skipped++
    if (event.todo) summary.todo++
    if (event.kind !== 'test' || isFileWrapper(event, cwd)) continue
    if (event.outcome !== 'pass' || event.skip || event.todo) continue
    summary.passed++
    const file = byPath.get(canonical(cwd, event.file))
    if (file !== undefined) summary.perFile[file]++
  }
  return summary
}

export function assertNodeTestGate(summary, { status }) {
  const problems = []
  if (status !== 0) problems.push(`node --test exited ${status}`)
  if (summary.failed) problems.push(`${summary.failed} failed`)
  if (summary.skipped) problems.push(`${summary.skipped} skipped`)
  if (summary.todo) problems.push(`${summary.todo} todo`)
  for (const [file, passed] of Object.entries(summary.perFile))
    if (!passed) problems.push(`${file} reported no passing test`)
  if (problems.length) throw new Error(`node_test_gate_failed: ${problems.join('; ')}`)
  return summary
}

export function runNodeTestGate({
  files,
  cwd = process.cwd(),
  env = process.env,
  stdio = 'inherit',
  spawn = spawnSync,
}) {
  if (!files.length) throw new Error('node_test_gate_failed: the suite has no file')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'node-test-gate-'))
  const events = path.join(directory, 'events.jsonl')
  try {
    const result = spawn(
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        `--test-reporter=${reporter}`,
        `--test-reporter-destination=${events}`,
        ...files,
      ],
      // A parent test runner's context would switch the child into its serializer.
      { cwd, env: { ...env, NODE_TEST_CONTEXT: undefined }, stdio }
    )
    if (result.error) throw result.error
    const lines = fs.existsSync(events)
      ? fs.readFileSync(events, 'utf8').split('\n').filter(Boolean)
      : []
    const summary = summarizeNodeTestEvents(
      lines.map((line) => JSON.parse(line)),
      files,
      cwd
    )
    return assertNodeTestGate(summary, { status: result.status })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [name, ...extra] = process.argv.slice(2)
    if (!name || extra.length) throw new Error('usage: node-test-gate.mjs <suite>')
    const problems = coverageProblems()
    if (problems.length)
      throw new Error(`node_test_gate_coverage: ${problems.join('; ')}`)
    const summary = runNodeTestGate({ files: resolveSuite(name), cwd: repository })
    for (const [file, passed] of Object.entries(summary.perFile))
      console.log(`node-test-gate: ${passed} passed  ${file}`)
    console.log(
      `node-test-gate: suite ${name} passed ${summary.passed} tests in ${Object.keys(summary.perFile).length} files; 0 failed, 0 skipped, 0 todo`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
