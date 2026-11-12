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
//
// `--start <suite>...` runs suites in one detached background process, so they overlap
// slower setup steps, and `--collect <suite>...` in a later step of the same job waits
// for them and applies the same pass rules. The collect step may wait only on its start
// step, so no later setup failure can skip it and hide a suite failure.
import { spawn as spawnChild, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// yaml loads on first use: node-test-gate --local must report a missing install (npm ci)
// before anything needs a package.
const parse = (...args) => createRequire(import.meta.url)('yaml').parse(...args)
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

/**
 * Local stand-ins for the CI steps a suite's conditionNeeds names: a file that step leaves
 * behind, and the command that makes it. `runtime` in CI also starts the services; the one
 * suite declaring it locally needs only the API build it spawns.
 */
export const LOCAL_NEEDS = {
  install: { probe: 'node_modules/.package-lock.json', how: 'npm ci' },
  prebuild: {
    probe: 'apps/mobile/android/gradlew',
    how: 'node scripts/run-story68-native.mjs prebuild --platform android (needs Temurin 21)',
  },
  runtime: {
    probe: 'apps/api/dist/src/load-env.js',
    how: 'npm run db:generate && npm run build:packages && npm run build --workspace api',
  },
}

/**
 * Commands the suites shell out to, which CI runners carry and a laptop may not: the quality
 * gate test in lanes-wiring.test.mjs runs the pr-checks shell, which uses jq.
 */
export const LOCAL_COMMANDS = {
  'native-harness': [
    {
      command: 'jq',
      how: 'install jq with your package manager (brew install jq on macOS)',
    },
  ],
}

const commandExists = (name) =>
  spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0

/** The CI rule for a vitest JSON report: at least two tests, every one passed. */
export function assertVitestReport(report) {
  if (
    !(report?.numTotalTests >= 2) ||
    report.numPassedTests !== report.numTotalTests ||
    report.numPendingTests !== 0 ||
    report.numFailedTests !== 0 ||
    report.numTodoTests !== 0
  )
    throw new Error('Incomplete vitest suite execution')
}

/**
 * Every suite, and the vitest files, with what is missing locally to run them as CI does. A
 * need with no local probe throws, so a new CI prerequisite cannot pass unnoticed locally.
 */
export function localPlan({
  root = repository,
  manifest = loadManifest(root),
  hasCommand = commandExists,
} = {}) {
  const needs = manifest.conditionNeeds ?? {}
  const suites = [
    ...Object.keys(manifest.suites).map((suite) => ({ suite, runner: 'node' })),
    { suite: 'vitest', runner: 'vitest' },
  ]
  const missing = []
  for (const { suite } of suites)
    for (const need of needs[suite] ?? []) {
      const local = LOCAL_NEEDS[need]
      if (!local)
        throw new Error(
          `node_test_gate_local: suite ${suite} needs ${need}, which has no local probe`
        )
      if (!fs.existsSync(path.join(root, local.probe)))
        missing.push({ suite, need, how: local.how })
    }
  for (const [suite, commands] of Object.entries(LOCAL_COMMANDS))
    for (const { command, how } of commands)
      if (!hasCommand(command)) missing.push({ suite, need: command, how })
  return { suites, missing }
}

/**
 * Everything that stops a local run before any suite starts: missing setup or commands, then
 * any suite the workflow no longer gates, which a local pass would otherwise hide.
 */
export function localPreflight({
  root = repository,
  manifest = loadManifest(root),
  hasCommand = commandExists,
  coverage = () => coverageProblems({ root, manifest }),
} = {}) {
  const { missing } = localPlan({ root, manifest, hasCommand })
  if (missing.length)
    return missing.map(({ suite, need, how }) => `${suite} needs ${need}: ${how}`)
  return coverage()
}

/** Runs every suite as CI would, after refusing to start while any suite's setup is missing. */
function runLocal() {
  const problems = localPreflight()
  if (problems.length)
    throw new Error(
      [
        'node_test_gate_local: fix these first, or the suites fail or pass for a reason CI never sees:',
        ...problems.map((problem) => `  ${problem}`),
      ].join('\n')
    )
  const plan = localPlan()
  const manifest = loadManifest()
  for (const { suite, runner } of plan.suites) {
    if (runner === 'vitest') {
      const report = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'gate-vitest-')),
        'r.json'
      )
      const result = spawnSync(
        'npx',
        [
          'vitest',
          'run',
          ...manifest.vitest,
          '--reporter=default',
          '--reporter=json',
          `--outputFile=${report}`,
        ],
        { cwd: repository, stdio: 'inherit' }
      )
      if (result.status !== 0)
        throw new Error('node_test_gate_failed: vitest suite failed')
      assertVitestReport(JSON.parse(fs.readFileSync(report, 'utf8')))
      continue
    }
    const summary = runNodeTestGate({ files: resolveSuite(suite), cwd: repository })
    console.log(`node-test-gate: suite ${suite} passed ${summary.passed} tests`)
  }
}

/** The suite a workflow `run:` line hands to the gate, or null for any other line. */
export function gatedSuite(line) {
  const tokens = line.trim().split(/\s+/)
  return tokens[0] === 'node' && tokens[1] === GATE_SCRIPT && tokens.length === 3
    ? tokens[2]
    : null
}

/**
 * The mode and suites of a `--start` or `--collect` line, or null for any other line. A
 * line that names no suite returns null, and the gate refuses it when it runs.
 */
export function backgroundSuites(line) {
  const [command, script, flag, ...suites] = line.trim().split(/\s+/)
  if (command !== 'node' || script !== GATE_SCRIPT || !suites.length) return null
  if (flag === '--start') return { mode: 'start', suites }
  if (flag === '--collect') return { mode: 'collect', suites }
  return null
}

const linesOf = (run) => (run ?? '').split(/\r?\n/)
const collectedSuites = (lines) =>
  lines.flatMap((line) => {
    const background = backgroundSuites(line)
    return background?.mode === 'collect' ? background.suites : []
  })
const startedSuites = (lines) =>
  lines.flatMap((line) => {
    const background = backgroundSuites(line)
    return background?.mode === 'start' ? background.suites : []
  })

/**
 * True when a workflow step's `run:` text gates a suite that contains the file. A collect
 * line gates its suites; the start line only launches them.
 */
export function runGatesTestFile(run, file, options) {
  const lines = linesOf(run)
  return [...lines.map(gatedSuite).filter(Boolean), ...collectedSuites(lines)].some(
    (name) => resolveSuite(name, options).includes(file)
  )
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
// steps its suites need, so a later Supabase or browser failure cannot hide them. A
// collect step may wait only on the step that started its suites, for the same reason.
function needsProblems(manifest, step, lines, startIds) {
  const needs = manifest.conditionNeeds ?? {}
  const suites = [...lines.map(gatedSuite).filter(Boolean), ...startedSuites(lines)]
  if (lines.some((line) => /^npx vitest run\b/.test(line))) suites.push('vitest')
  const collected = collectedSuites(lines)
  const allowed = new Set([
    ...suites.flatMap((suite) => needs[suite] ?? []),
    ...collected.flatMap((suite) => startIds.get(suite) ?? []),
  ])
  const problems = suites
    .filter((suite) => suite === 'vitest' || manifest.suites[suite] !== undefined)
    .filter((suite) => !Array.isArray(needs[suite]))
    .map((suite) => `suite ${suite} declares no conditionNeeds`)
  const name = step.name ?? step.id ?? 'unnamed'
  for (const [, id] of String(step.if ?? '').matchAll(/\bsteps\.([A-Za-z0-9_-]+)\./g))
    if (!allowed.has(id))
      problems.push(
        suites.length
          ? `step ${name} waits on steps.${id}, which ${suites.join(' and ')} does not need`
          : `step ${name} waits on steps.${id}; a collect step may wait only on the step that started ${collected.join(' and ')}`
      )
  return [...new Set(problems)]
}

const stepSuites = (lines) => [
  ...lines.map(gatedSuite).filter(Boolean),
  ...startedSuites(lines),
  ...collectedSuites(lines),
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
// continue-on-error turns its failure into a green step. Start and collect steps are
// gate steps too.
function gateStepProblems(manifest, step, matrix, startIds) {
  const lines = stepLines(step)
  const runsTests = lines.some(
    (line) =>
      gatedSuite(line) !== null ||
      backgroundSuites(line) !== null ||
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
    ...needsProblems(manifest, step, lines, startIds),
    ...rowProblems(manifest, step, lines, matrix),
  ]
}

/**
 * Pairs each started suite with a collect line in a later step of the same job, and
 * the reverse. Returns the problems and, per suite, the id of the step that started it.
 */
function backgroundPairs(name, job) {
  const problems = []
  const started = new Map()
  const collected = new Map()
  for (const [index, step] of (job.steps ?? []).entries())
    for (const line of stepLines(step)) {
      const background = backgroundSuites(line)
      if (!background) continue
      const seen = background.mode === 'start' ? started : collected
      for (const suite of background.suites)
        if (seen.has(suite))
          problems.push(
            `suite ${suite} is ${background.mode}ed more than once in job ${name}`
          )
        else seen.set(suite, { index, id: step.id })
    }
  for (const [suite, start] of started)
    if (!(collected.get(suite)?.index > start.index))
      problems.push(
        `suite ${suite} is started in the background, but no later step of job ${name} collects it`
      )
  for (const [suite, collect] of collected)
    if (!(started.get(suite)?.index < collect.index))
      problems.push(
        `suite ${suite} is collected, but no earlier step of job ${name} starts it`
      )
  const startIds = new Map(
    [...started]
      .filter(([, start]) => start.id)
      .map(([suite, start]) => [suite, [start.id]])
  )
  return { problems, startIds }
}

function workflowProblems(manifest, workflow) {
  const problems = []
  const names = Object.keys(manifest.suites)
  const jobs = Object.entries(parse(workflow).jobs ?? {})
  const steps = jobs.flatMap(([, job]) => job.steps ?? [])
  const lines = steps.flatMap(stepLines)
  for (const [name, job] of jobs) {
    const pairs = backgroundPairs(name, job)
    for (const step of job.steps ?? [])
      problems.push(
        ...gateStepProblems(manifest, step, job.strategy?.matrix, pairs.startIds)
      )
    problems.push(...pairs.problems)
  }
  const invoked = new Set([
    ...lines.map(gatedSuite).filter(Boolean),
    ...startedSuites(lines),
  ])
  for (const name of new Set([...invoked, ...collectedSuites(lines)]))
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

const nodeTestArguments = (files, events) => [
  '--test',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  `--test-reporter=${reporter}`,
  `--test-reporter-destination=${events}`,
  ...files,
]
// A parent test runner's context would switch the child into its serializer.
const childEnv = (env) => ({ ...env, NODE_TEST_CONTEXT: undefined })

/** The foreground and background runs share these pass rules. */
function gateEvents(events, files, cwd, status) {
  const lines = fs.existsSync(events)
    ? fs.readFileSync(events, 'utf8').split('\n').filter(Boolean)
    : []
  const summary = summarizeNodeTestEvents(
    lines.map((line) => JSON.parse(line)),
    files,
    cwd
  )
  return assertNodeTestGate(summary, { status })
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
    const result = spawn(process.execPath, nodeTestArguments(files, events), {
      cwd,
      env: childEnv(env),
      stdio,
    })
    if (result.error) throw result.error
    return gateEvents(events, files, cwd, result.status)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

/** Where a background run of the suite keeps its events, output log and exit status. */
export function backgroundDirectory(suite, env = process.env) {
  return path.join(env.RUNNER_TEMP || os.tmpdir(), 'node-test-gate', suite)
}

const backgroundFile = (suite, env, name) =>
  path.join(backgroundDirectory(suite, env), name)

/**
 * Resolves every suite, clears its earlier result and launches one detached process that
 * runs the suites one after another. Every suite is resolved first, so an unknown suite
 * launches nothing.
 */
export function startBackgroundSuites(
  suites,
  {
    root = repository,
    manifest = loadManifest(root),
    cwd = root,
    env = process.env,
    spawn = spawnChild,
  } = {}
) {
  if (!suites.length) throw new Error('node_test_gate_failed: --start names no suite')
  const plans = suites.map((suite) => {
    const files = resolveSuite(suite, { root, manifest })
    if (!files.length)
      throw new Error(`node_test_gate_failed: suite ${suite} has no file`)
    return { suite, files }
  })
  for (const { suite, files } of plans) {
    fs.rmSync(backgroundDirectory(suite, env), { recursive: true, force: true })
    fs.mkdirSync(backgroundDirectory(suite, env), { recursive: true })
    fs.writeFileSync(
      backgroundFile(suite, env, 'files.json'),
      JSON.stringify({ files, cwd })
    )
  }
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), '--background-run', ...suites],
    { cwd, env: childEnv(env), detached: true, stdio: 'ignore' }
  )
  if (!Number.isInteger(child.pid))
    throw new Error('node_test_gate_failed: the background run could not be launched')
  child.unref()
  // The process id lets collect tell a run that died from one that is still going.
  for (const { suite } of plans)
    fs.writeFileSync(
      backgroundFile(suite, env, 'started.json'),
      JSON.stringify({ pid: child.pid })
    )
}

function writeStatus(suite, env, result) {
  const target = backgroundFile(suite, env, 'status.json')
  fs.writeFileSync(`${target}.partial`, JSON.stringify(result))
  fs.renameSync(`${target}.partial`, target)
}

/** The body of the detached process: each suite's output goes to its own log. */
function runBackgroundSuites(suites, env = process.env) {
  for (const suite of suites) {
    const log = fs.openSync(backgroundFile(suite, env, 'output.log'), 'w')
    try {
      const { files, cwd } = JSON.parse(
        fs.readFileSync(backgroundFile(suite, env, 'files.json'), 'utf8')
      )
      const result = spawnSync(
        process.execPath,
        nodeTestArguments(files, backgroundFile(suite, env, 'events.jsonl')),
        { cwd, env: childEnv(env), stdio: ['ignore', log, log] }
      )
      writeStatus(suite, env, {
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
      })
    } catch (error) {
      writeStatus(suite, env, { status: null, error: error.message })
    } finally {
      fs.closeSync(log)
    }
  }
}

function processEnded(pid) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error.code === 'ESRCH'
  }
}

async function awaitStatus(suite, { env, timeoutMs, pollMs }) {
  const startedFile = backgroundFile(suite, env, 'started.json')
  const statusFile = backgroundFile(suite, env, 'status.json')
  if (!fs.existsSync(startedFile))
    throw new Error(
      `node_test_gate_failed: suite ${suite} was never started in the background (no ${startedFile})`
    )
  const { pid } = JSON.parse(fs.readFileSync(startedFile, 'utf8'))
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(statusFile)) {
    // Checked again after the process check, which may have raced the final write.
    if (processEnded(pid) && !fs.existsSync(statusFile))
      throw new Error(
        `node_test_gate_failed: the background run of suite ${suite} ended without recording a result`
      )
    if (Date.now() >= deadline)
      throw new Error(
        `node_test_gate_failed: suite ${suite} did not finish within ${timeoutMs / 1000} s`
      )
    await sleep(pollMs)
  }
  return JSON.parse(fs.readFileSync(statusFile, 'utf8'))
}

/** Ten minutes: the suites take about two alone, and the collect step's limit is longer. */
export const COLLECT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Waits for each started suite, prints its log and applies the foreground pass rules.
 * Every suite is reported before a failure is raised.
 */
export async function collectBackgroundSuites(
  suites,
  {
    env = process.env,
    timeoutMs = COLLECT_TIMEOUT_MS,
    pollMs = 1000,
    log = (line) => console.log(line),
  } = {}
) {
  if (!suites.length) throw new Error('node_test_gate_failed: --collect names no suite')
  const summaries = {}
  const failures = []
  for (const suite of suites) {
    try {
      const result = await awaitStatus(suite, { env, timeoutMs, pollMs })
      const output = backgroundFile(suite, env, 'output.log')
      if (fs.existsSync(output)) log(fs.readFileSync(output, 'utf8'))
      if (result.error) throw new Error(`node_test_gate_failed: ${result.error}`)
      const { files, cwd } = JSON.parse(
        fs.readFileSync(backgroundFile(suite, env, 'files.json'), 'utf8')
      )
      const summary = gateEvents(
        backgroundFile(suite, env, 'events.jsonl'),
        files,
        cwd,
        result.status
      )
      reportSummary(suite, summary, log)
      summaries[suite] = summary
    } catch (error) {
      log(`node-test-gate: suite ${suite} failed: ${error.message}`)
      failures.push(`suite ${suite}: ${error.message}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  return summaries
}

function reportSummary(name, summary, log = (line) => console.log(line)) {
  for (const [file, passed] of Object.entries(summary.perFile))
    log(`node-test-gate: ${passed} passed  ${file}`)
  log(
    `node-test-gate: suite ${name} passed ${summary.passed} tests in ${Object.keys(summary.perFile).length} files; 0 failed, 0 skipped, 0 todo`
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    const [name, ...extra] = process.argv.slice(2)
    const background = ['--start', '--collect', '--background-run'].includes(name)
    if (!name || (background ? !extra.length : extra.length))
      throw new Error(
        'usage: node-test-gate.mjs <suite> | --start <suite>... | --collect <suite>... | --local'
      )
    if (name === '--local') {
      runLocal()
      process.exit(0)
    }
    if (name === '--background-run') runBackgroundSuites(extra)
    else if (name === '--collect') await collectBackgroundSuites(extra)
    else {
      const problems = coverageProblems()
      if (problems.length)
        throw new Error(`node_test_gate_coverage: ${problems.join('; ')}`)
      if (name === '--start') {
        startBackgroundSuites(extra)
        console.log(
          `node-test-gate: started ${extra.join(' and ')} in the background; a later --collect step reports them`
        )
      } else
        reportSummary(
          name,
          runNodeTestGate({ files: resolveSuite(name), cwd: repository })
        )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
