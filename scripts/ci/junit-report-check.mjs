#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15: the pass rule for one Gradle JUnit report. The suite ran at least the expected
// number of tests, and none was skipped, failed or errored. An exact count broke the job on an
// added case; at least N still fails a removed case.
//
//   node scripts/ci/junit-report-check.mjs <TEST-*.xml> <minimum tests>
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The problems with a report's text against a minimum test count; empty when it passes. */
export function junitReportProblems(xml, minimum) {
  const suite = /<testsuite\b[^>]*>/.exec(xml)?.[0]
  if (!suite) return ['no <testsuite> element']
  const count = (name) => {
    const value = new RegExp(`\\s${name}="(\\d+)"`).exec(suite)?.[1]
    return value === undefined ? null : Number(value)
  }
  const problems = []
  const tests = count('tests')
  if (tests === null) problems.push('no tests count')
  else if (tests < minimum)
    problems.push(`ran ${tests} tests, expected at least ${minimum}`)
  for (const name of ['skipped', 'failures', 'errors']) {
    const value = count(name)
    if (value === null) problems.push(`no ${name} count`)
    else if (value > 0) problems.push(`${value} ${name}`)
  }
  return problems
}

/** Checks one report file; returns the problems, the missing file among them. */
export function checkJunitReport(file, minimum) {
  if (!Number.isSafeInteger(minimum) || minimum < 1)
    return [`minimum must be a positive integer, got ${minimum}`]
  let xml
  try {
    xml = fs.readFileSync(file, 'utf8')
  } catch {
    return [`no report at ${file}`]
  }
  return junitReportProblems(xml, minimum)
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [file, minimum] = process.argv.slice(2)
  const problems = checkJunitReport(file, Number(minimum))
  if (problems.length > 0) {
    console.error(`junit_report_failed: ${file}: ${problems.join('; ')}`)
    process.exit(1)
  }
  console.log(
    `junit report passed: ${file} (at least ${minimum} tests, none skipped or failed)`
  )
}
