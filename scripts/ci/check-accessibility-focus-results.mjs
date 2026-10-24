#!/usr/bin/env node
// Story 6.7: decides the TalkBack instrumentation lane from its JUnit results.
// Usage: check-accessibility-focus-results.mjs RESULTS POSITIVE_STATUS SUPPRESSED_STATUS
// RESULTS holds `positive/` and `suppressed/`, each a fresh copy of one run's
// connected-test XML. The positive run must pass every expected test; the
// suppressed-focus control must fail exactly the tests that need the OS focus
// report, on that assertion, and pass the rest. Anything else fails the lane.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXPECTED_TESTS = [
  'aViewTalkBackAlreadyHoldsCountsAsMovedAndIsReportedAgain',
  'belowApi29ItInstallsNothingAndReportsNothing',
  'chainsToTheDelegateTheWindowAlreadyHadAndRestoresIt',
  'movesTalkBackFocusToTheViewAndReportsItWithItsAncestors',
  'startsBeforeAnyActivityAndAttachesWhenOneAppears',
]

/** The tests that observe the OS focus report; with the focus action skipped they must fail. */
export const NEED_OS_REPORT = [
  'aViewTalkBackAlreadyHoldsCountsAsMovedAndIsReportedAgain',
  'chainsToTheDelegateTheWindowAlreadyHadAndRestoresIt',
  'movesTalkBackFocusToTheViewAndReportsItWithItsAncestors',
  'startsBeforeAnyActivityAndAttachesWhenOneAppears',
]

const OS_REPORT_FAILURE = 'java.lang.AssertionError: the OS reported focus'

/** Every test case in the run's XML files, at any depth (AGP nests them per variant). */
export function readRun(directory) {
  const files = fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { recursive: true })
        .map(String)
        .filter((name) => name.endsWith('.xml'))
    : []
  const cases = []
  for (const file of files) {
    const xml = fs.readFileSync(path.join(directory, file), 'utf8')
    for (const match of xml.matchAll(
      /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
    )) {
      const name = /\bname="([^"]*)"/.exec(match[1])?.[1] ?? ''
      const body = match[2] ?? ''
      const outcome = /<failure\b/.test(body)
        ? 'failure'
        : /<error\b/.test(body)
          ? 'error'
          : /<skipped\b/.test(body)
            ? 'skipped'
            : 'passed'
      cases.push({ name, outcome, text: body })
    }
  }
  return { files: files.length, cases }
}

function sameTests(run) {
  const names = run.cases.map(({ name }) => name).sort()
  return JSON.stringify(names) === JSON.stringify([...EXPECTED_TESTS].sort())
}

/** Problems shared by both runs: missing results, or a different set of tests. */
function runProblems(label, run) {
  if (run.files === 0) return [`${label} left no results (build or install failure)`]
  if (sameTests(run)) return []
  const ran = run.cases.map(({ name }) => name).join(', ') || 'nothing'
  return [`${label} ran ${ran}; expected ${EXPECTED_TESTS.join(', ')}`]
}

function positiveProblems(run, status) {
  const problems = status === 0 ? [] : [`the TalkBack run exited ${status}; it must pass`]
  problems.push(...runProblems('the TalkBack run', run))
  for (const { name, outcome } of run.cases)
    if (outcome !== 'passed') problems.push(`the TalkBack run: ${name} ${outcome}`)
  return problems
}

function suppressedProblems(run, status) {
  const label = 'the suppressed-focus control'
  const problems =
    status === 0 ? [`${label} passed; the tests do not observe the OS focus`] : []
  problems.push(...runProblems(label, run))
  for (const { name, outcome, text } of run.cases) {
    if (!NEED_OS_REPORT.includes(name)) {
      if (outcome !== 'passed')
        problems.push(`${label}: ${name} ${outcome}; it must pass`)
    } else if (!(outcome === 'failure' && text.includes(OS_REPORT_FAILURE))) {
      problems.push(
        `${label}: ${name} ended ${outcome}; it must fail on "${OS_REPORT_FAILURE}"`
      )
    }
  }
  return problems
}

/** The problems with the lane's results; empty when it passes. */
export function checkResults(results, positiveStatus, suppressedStatus) {
  return [
    ...positiveProblems(readRun(path.join(results, 'positive')), positiveStatus),
    ...suppressedProblems(readRun(path.join(results, 'suppressed')), suppressedStatus),
  ]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [results, positiveStatus, suppressedStatus] = process.argv.slice(2)
  const problems = checkResults(results, Number(positiveStatus), Number(suppressedStatus))
  for (const problem of problems) console.log(`::error::${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log(
    `TalkBack run: ${EXPECTED_TESTS.length} passed. Suppressed-focus control: the ${NEED_OS_REPORT.length} tests that need the OS focus report failed on it, the rest passed.`
  )
}
