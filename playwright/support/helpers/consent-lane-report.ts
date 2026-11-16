// TEA (2026-11-16): a skip can hide a lost check, so both runs of the @consent-required
// specs are counted against EXPECTED_CONSENT_REQUIRED_E2E_TESTS from their Playwright JSON
// reports. The consent lane (npm run test:pw-consent, API on required_13_15) must pass every
// one of them and skip none. The sharded default run (API on off) must skip exactly those,
// for the consent-lane reason, and skip nothing else for that reason.
import {
  CONSENT_LANE_ONLY,
  CONSENT_REQUIRED_TAG,
  EXPECTED_CONSENT_REQUIRED_E2E_TESTS,
} from './guardian-consent-policy'

type ReportTest = {
  status: string
  annotations?: { type: string; description?: string }[]
}
type ReportSpec = { title: string; file: string; tags?: string[]; tests: ReportTest[] }
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] }
export type PlaywrightJsonReport = { suites?: ReportSuite[] }

export type ConsentLaneTest = {
  id: string
  tagged: boolean
  status: string
  consentLaneSkip: boolean
}

const TAG = CONSENT_REQUIRED_TAG.replace(/^@/, '')
/** The real-session specs carry the same tag and run only in their own harness. */
const isRealSessionFile = (file: string) => file.includes('real-session')

/** Every test of the report outside the real-session specs, one entry per project run. */
export function consentLaneTests(report: PlaywrightJsonReport): ConsentLaneTest[] {
  const tests: ConsentLaneTest[] = []
  const walk = (suite: ReportSuite) => {
    for (const spec of suite.specs ?? []) {
      if (isRealSessionFile(spec.file)) continue
      for (const test of spec.tests)
        tests.push({
          id: `${spec.file} › ${spec.title}`,
          tagged: (spec.tags ?? []).includes(TAG),
          status: test.status,
          consentLaneSkip: (test.annotations ?? []).some(
            (annotation) =>
              annotation.type === 'skip' && annotation.description === CONSENT_LANE_ONLY
          ),
        })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return tests
}

/** Problems with the consent lane run; empty when it is complete. */
export function consentRunProblems(
  report: PlaywrightJsonReport,
  expected = EXPECTED_CONSENT_REQUIRED_E2E_TESTS
): string[] {
  const tests = consentLaneTests(report)
  const problems: string[] = []
  if (tests.length !== expected)
    problems.push(
      `ran ${tests.length} tests, expected ${expected} @consent-required tests`
    )
  for (const test of tests) {
    if (!test.tagged) problems.push(`ran an untagged test: ${test.id}`)
    if (test.status !== 'expected') problems.push(`${test.status}: ${test.id}`)
  }
  return problems
}

/** Problems with the sharded default run; empty when it skipped exactly the tagged tests. */
export function offRunProblems(
  report: PlaywrightJsonReport,
  expected = EXPECTED_CONSENT_REQUIRED_E2E_TESTS
): string[] {
  const tests = consentLaneTests(report)
  const tagged = tests.filter((test) => test.tagged)
  const skippedForConsent = tests.filter((test) => test.consentLaneSkip)
  const problems: string[] = []
  if (tagged.length !== expected)
    problems.push(`found ${tagged.length} @consent-required tests, expected ${expected}`)
  if (skippedForConsent.length !== expected)
    problems.push(
      `skipped ${skippedForConsent.length} tests for the consent lane, expected ${expected}`
    )
  for (const test of tagged)
    if (test.status !== 'skipped' || !test.consentLaneSkip)
      problems.push(`not skipped for the consent lane: ${test.id}`)
  for (const test of skippedForConsent)
    if (!test.tagged)
      problems.push(`skipped for the consent lane but untagged: ${test.id}`)
  return problems
}
