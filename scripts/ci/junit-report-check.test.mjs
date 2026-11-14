// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkJunitReport, junitReportProblems } from './junit-report-check.mjs'

const script = fileURLToPath(new URL('./junit-report-check.mjs', import.meta.url))
const report = (tests, { skipped = 0, failures = 0, errors = 0 } = {}) =>
  `<?xml version="1.0"?><testsuite name="S" tests="${tests}" skipped="${skipped}" failures="${failures}" errors="${errors}" timestamp="2026-11-14T12:00:00"></testsuite>`

test('passes the expected count and an added case', () => {
  assert.deepEqual(junitReportProblems(report(3), 3), [])
  assert.deepEqual(junitReportProblems(report(4), 3), [])
})

test('fails a removed case, a skip, a failure and an error', () => {
  assert.deepEqual(junitReportProblems(report(2), 3), [
    'ran 2 tests, expected at least 3',
  ])
  assert.deepEqual(junitReportProblems(report(0), 1), [
    'ran 0 tests, expected at least 1',
  ])
  assert.deepEqual(junitReportProblems(report(3, { skipped: 1 }), 3), ['1 skipped'])
  assert.deepEqual(junitReportProblems(report(3, { failures: 1 }), 3), ['1 failures'])
  assert.deepEqual(junitReportProblems(report(3, { errors: 2 }), 3), ['2 errors'])
})

test('fails a report without a suite or without its counts', () => {
  assert.deepEqual(junitReportProblems('<testsuites/>', 1), ['no <testsuite> element'])
  assert.deepEqual(junitReportProblems('<testsuite name="S" tests="3">', 3), [
    'no skipped count',
    'no failures count',
    'no errors count',
  ])
})

test('the CLI fails a missing report and a bad minimum, and passes a good report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-check-'))
  try {
    const good = path.join(dir, 'TEST-good.xml')
    fs.writeFileSync(good, report(3))
    const run = (...args) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        timeout: 30_000,
      })
    assert.equal(run(good, '3').status, 0)
    const missing = run(path.join(dir, 'TEST-none.xml'), '3')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /no report at/)
    assert.deepEqual(checkJunitReport(good, 0), [
      'minimum must be a positive integer, got 0',
    ])
    assert.equal(run(good, 'x').status, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
