#!/usr/bin/env node
// Runs `node --test` on explicit files and fails unless every file registered a test,
// at least the expected number passed, and nothing failed, skipped or stayed todo.
// A bare `node --test` exits 0 for a skipped test, a todo test or an empty file.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const GATE_SCRIPT = 'scripts/ci/node-test-gate.mjs'
const reporter = pathToFileURL(
  fileURLToPath(new URL('./node-test-gate-reporter.mjs', import.meta.url))
).href

export function parseGateArgs(argv) {
  const files = []
  let minPass
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--min-pass') {
      minPass = Number(argv[++index])
      continue
    }
    if (value.startsWith('--')) throw new Error(`node_test_gate_unknown_option: ${value}`)
    files.push(value)
  }
  if (!Number.isInteger(minPass) || minPass < 1)
    throw new Error('node_test_gate_min_pass_required')
  if (!files.length) throw new Error('node_test_gate_files_required')
  if (new Set(files).size !== files.length)
    throw new Error('node_test_gate_duplicate_file')
  return { minPass, files }
}

/** The test files a workflow `run:` line hands to the gate, or null for any other line. */
export function gatedTestFiles(line) {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'node' || tokens[1] !== GATE_SCRIPT) return null
  try {
    return parseGateArgs(tokens.slice(2)).files
  } catch {
    return null
  }
}

function canonical(cwd, file) {
  const absolute = path.resolve(cwd, file)
  try {
    return fs.realpathSync(absolute)
  } catch {
    return absolute
  }
}

export function summarizeNodeTestEvents(events, files, cwd = process.cwd()) {
  const summary = { passed: 0, failed: 0, skipped: 0, todo: 0, filesWithoutTests: [] }
  const registered = new Set()
  for (const event of events) {
    if (event.outcome === 'fail' && !event.todo) summary.failed++
    if (event.skip) summary.skipped++
    if (event.todo) summary.todo++
    if (event.kind !== 'test' || event.entryFile === null) continue
    registered.add(canonical(cwd, event.file))
    if (event.outcome === 'pass' && !event.skip && !event.todo) summary.passed++
  }
  summary.filesWithoutTests = files.filter(
    (file) => !registered.has(canonical(cwd, file))
  )
  return summary
}

export function assertNodeTestGate(summary, { minPass, status }) {
  const problems = []
  if (status !== 0) problems.push(`node --test exited ${status}`)
  if (summary.failed) problems.push(`${summary.failed} failed`)
  if (summary.skipped) problems.push(`${summary.skipped} skipped`)
  if (summary.todo) problems.push(`${summary.todo} todo`)
  if (summary.passed < minPass)
    problems.push(`${summary.passed} passed, expected at least ${minPass}`)
  for (const file of summary.filesWithoutTests)
    problems.push(`${file} registered no test`)
  if (problems.length) throw new Error(`node_test_gate_failed: ${problems.join('; ')}`)
  return summary
}

export function runNodeTestGate({
  minPass,
  files,
  cwd = process.cwd(),
  env = process.env,
  stdio = 'inherit',
  spawn = spawnSync,
}) {
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
    return assertNodeTestGate(summary, { minPass, status: result.status })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = runNodeTestGate(parseGateArgs(process.argv.slice(2)))
    console.log(`node-test-gate: ${summary.passed} passed, 0 failed, 0 skipped, 0 todo`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
