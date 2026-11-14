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
const SUITE = 'expo.modules.taskmanagermigration.PersistedTaskConsumersTest'

/** A Gradle-shaped suite with `cases` test cases and the given counts. */
const suite = (
  tests,
  { name = SUITE, skipped = 0, failures = 0, errors = 0, cases = tests } = {}
) =>
  `<testsuite name="${name}" tests="${tests}" skipped="${skipped}" failures="${failures}" errors="${errors}" timestamp="2026-11-14T12:00:00">` +
  Array.from(
    { length: cases },
    (_, i) => `<testcase name="c${i}" classname="${name}"/>`
  ).join('') +
  '</testsuite>'
const report = (...suites) => `<?xml version="1.0" encoding="UTF-8"?>${suites.join('')}`

test('passes the expected count and an added case', () => {
  assert.deepEqual(junitReportProblems(report(suite(3)), SUITE, 3), [])
  assert.deepEqual(junitReportProblems(report(suite(4)), SUITE, 3), [])
})

test('fails a removed case, a skip, a failure and an error', () => {
  assert.deepEqual(junitReportProblems(report(suite(2)), SUITE, 3), [
    'ran 2 tests, expected at least 3',
  ])
  assert.deepEqual(junitReportProblems(report(suite(3, { skipped: 1 })), SUITE, 3), [
    `suite ${SUITE}: 1 skipped`,
  ])
  assert.deepEqual(junitReportProblems(report(suite(3, { failures: 1 })), SUITE, 3), [
    `suite ${SUITE}: 1 failures`,
  ])
  assert.deepEqual(junitReportProblems(report(suite(3, { errors: 2 })), SUITE, 3), [
    `suite ${SUITE}: 2 errors`,
  ])
})

// The r39 probes: each passed the first version of this check.
test('checks every suite, so a failing second suite fails', () => {
  assert.deepEqual(
    junitReportProblems(report(suite(2), suite(1, { failures: 1 })), SUITE, 2),
    [`suite ${SUITE}: 1 failures`]
  )
})

test('fails a truncated report and a self-closing suite', () => {
  const open = `<testsuite name="${SUITE}" tests="3" skipped="0" failures="0" errors="0">`
  assert.deepEqual(junitReportProblems(report(open), SUITE, 3), [
    '1 <testsuite> opened, 0 closed',
    '0 <testcase> elements, but tests says 3',
  ])
  assert.deepEqual(junitReportProblems(report(open.replace(/>$/, '/>')), SUITE, 3), [
    'a <testsuite> is self-closing, with no test cases',
    '0 <testcase> elements, but tests says 3',
  ])
})

test('fails a report of another test class', () => {
  const renamed = 'expo.modules.other.RenamedTest'
  assert.deepEqual(junitReportProblems(report(suite(3, { name: renamed })), SUITE, 3), [
    `suite ${renamed} is not ${SUITE}`,
  ])
})

test('fails test cases that disagree with the tests count', () => {
  assert.deepEqual(junitReportProblems(report(suite(3, { cases: 2 })), SUITE, 3), [
    '2 <testcase> elements, but tests says 3',
  ])
})

test('fails a report without a suite or without its counts', () => {
  assert.deepEqual(junitReportProblems('<testsuites/>', SUITE, 1), [
    'no <testsuite> element',
  ])
  assert.deepEqual(
    junitReportProblems(`<testsuite name="${SUITE}" tests="3"></testsuite>`, SUITE, 3),
    [
      `suite ${SUITE}: no skipped count`,
      `suite ${SUITE}: no failures count`,
      `suite ${SUITE}: no errors count`,
      '0 <testcase> elements, but tests says 3',
    ]
  )
})

test('the CLI fails a missing report, a missing suite name and a bad minimum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-check-'))
  try {
    const good = path.join(dir, 'TEST-good.xml')
    fs.writeFileSync(good, report(suite(3)))
    const run = (...args) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        timeout: 30_000,
      })
    assert.equal(run(good, SUITE, '3').status, 0)
    const missing = run(path.join(dir, 'TEST-none.xml'), SUITE, '3')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /no report at/)
    assert.equal(run(good, '3').status, 1)
    assert.deepEqual(checkJunitReport(good, SUITE, 0), [
      'minimum must be a positive integer, got 0',
    ])
    assert.deepEqual(checkJunitReport(good, undefined, 3), [
      'suite class name required, got undefined',
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('importing the module from stdin does not throw', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: `import(${JSON.stringify(new URL('./junit-report-check.mjs', import.meta.url).href)}).then(() => console.log('ok'))`,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'ok')
})

// The r40 probes.
test('reads no element out of a comment or CDATA', () => {
  const output =
    '<system-out><![CDATA[<testcase name="x"/> </testsuite> <failure/>]]></system-out>'
  const withOutput = suite(3).replace('</testsuite>', `${output}</testsuite>`)
  assert.deepEqual(junitReportProblems(report(withOutput), SUITE, 3), [])
  const commented = suite(3, { cases: 2 }).replace(
    '</testsuite>',
    '<!-- <testcase name="padding"/> <testsuite name="x"> --></testsuite>'
  )
  assert.deepEqual(junitReportProblems(report(commented), SUITE, 3), [
    '2 <testcase> elements, but tests says 3',
  ])
})

test('fails a case with a failure, error or skipped child whatever the counts say', () => {
  const xml = report(
    `<testsuite name="${SUITE}" tests="3" skipped="0" failures="0" errors="0">` +
      `<testcase name="a" classname="${SUITE}"><failure message="boom"/></testcase>` +
      `<testcase name="b" classname="${SUITE}"><skipped/></testcase>` +
      `<testcase name="c" classname="${SUITE}"><error/></testcase>` +
      '</testsuite>'
  )
  assert.deepEqual(junitReportProblems(xml, SUITE, 3), [
    'case a: failure',
    'case b: skipped',
    'case c: error',
  ])
})
