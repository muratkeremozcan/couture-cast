#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15: the pass rule for one Gradle JUnit report. Every suite in it is the expected test
// class, is closed and holds its test cases; together they ran at least the expected number of
// tests, and none was skipped, failed or errored. An exact count broke the job on an added case;
// at least N still fails a removed case.
//
//   node scripts/ci/junit-report-check.mjs <TEST-*.xml> <suite class name> <minimum tests>
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** One suite tag's problems and its tests count (null when it has none). */
function suiteTagProblems(tag, suiteName) {
  const problems = []
  const name = attribute(tag, 'name')
  if (name !== suiteName)
    problems.push(`suite ${name ?? '(unnamed)'} is not ${suiteName}`)
  const count = (field) => {
    const value = attribute(tag, field)
    return value !== undefined && /^\d+$/.test(value) ? Number(value) : null
  }
  const tests = count('tests')
  if (tests === null) problems.push(`suite ${name}: no tests count`)
  for (const field of ['skipped', 'failures', 'errors']) {
    const value = count(field)
    if (value === null) problems.push(`suite ${name}: no ${field} count`)
    else if (value > 0) problems.push(`suite ${name}: ${value} ${field}`)
  }
  return { problems, tests }
}

/** A case that failed, errored or was skipped fails the report whatever the counts say. */
function caseProblems(xml) {
  const problems = []
  for (const [, tag, body] of xml.matchAll(
    /<testcase\b([^>]*?)(?<!\/)>([\s\S]*?)<\/testcase>/g
  )) {
    const outcome = /<(failure|error|skipped)\b/.exec(body)?.[1]
    if (outcome)
      problems.push(`case ${attribute(tag, 'name') ?? '(unnamed)'}: ${outcome}`)
  }
  return problems
}

/** The problems with a report's text for one suite class and a minimum test count. */
export function junitReportProblems(report, suiteName, minimum) {
  // Comments, CDATA (test output in <system-out>) and processing instructions are text, never
  // elements. One left-to-right pass, so a comment marker inside CDATA, or CDATA inside a
  // comment, ends where the XML parser would end it.
  const xml = report.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,
    ''
  )
  const opens = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map((match) => match[0])
  if (opens.length === 0) return ['no <testsuite> element']
  const problems = []
  const closes = (xml.match(/<\/testsuite>/g) ?? []).length
  if (opens.some((tag) => tag.endsWith('/>')))
    problems.push('a <testsuite> is self-closing, with no test cases')
  else if (closes !== opens.length)
    problems.push(`${opens.length} <testsuite> opened, ${closes} closed`)
  let tests = 0
  for (const tag of opens) {
    const suite = suiteTagProblems(tag, suiteName)
    problems.push(...suite.problems)
    tests += suite.tests ?? 0
  }
  if (tests < minimum) problems.push(`ran ${tests} tests, expected at least ${minimum}`)
  problems.push(...caseProblems(xml))
  const cases = (xml.match(/<testcase\b/g) ?? []).length
  if (cases !== tests)
    problems.push(`${cases} <testcase> elements, but tests says ${tests}`)
  return problems
}

/** Checks one report file; returns the problems, the missing file among them. */
export function checkJunitReport(file, suiteName, minimum) {
  if (typeof suiteName !== 'string' || !/^[\w.$]+$/.test(suiteName))
    return [`suite class name required, got ${suiteName}`]
  if (!Number.isSafeInteger(minimum) || minimum < 1)
    return [`minimum must be a positive integer, got ${minimum}`]
  let xml
  try {
    xml = fs.readFileSync(file, 'utf8')
  } catch {
    return [`no report at ${file}`]
  }
  return junitReportProblems(xml, suiteName, minimum)
}

/** True when this module is the process entry point; false for stdin, eval or an import. */
function runAsScript() {
  try {
    return Boolean(
      process.argv[1] &&
        fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    )
  } catch {
    return false
  }
}

if (runAsScript()) {
  const [file, suiteName, minimum] = process.argv.slice(2)
  const problems = checkJunitReport(file, suiteName, Number(minimum))
  if (problems.length > 0) {
    console.error(`junit_report_failed: ${file}: ${problems.join('; ')}`)
    process.exit(1)
  }
  console.log(
    `junit report passed: ${file} (${suiteName}, at least ${minimum} tests, none skipped or failed)`
  )
}
