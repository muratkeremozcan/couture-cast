// Checks a Playwright JSON report of one @consent-required run; exits 1 with each problem.
//   npx tsx playwright/support/helpers/consent-lane-report-cli.ts consent <report.json>
//   npx tsx playwright/support/helpers/consent-lane-report-cli.ts off <report.json>
import { readFileSync } from 'node:fs'
import {
  consentLaneTests,
  consentRunProblems,
  offRunProblems,
  type PlaywrightJsonReport,
} from './consent-lane-report'
import { EXPECTED_CONSENT_REQUIRED_E2E_TESTS } from './guardian-consent-policy'

const [mode, file] = process.argv.slice(2)
if ((mode !== 'consent' && mode !== 'off') || !file) {
  console.error('usage: consent-lane-report-cli.ts consent|off <playwright-report.json>')
  process.exit(2)
}
const report = JSON.parse(readFileSync(file, 'utf8')) as PlaywrightJsonReport
const problems = mode === 'consent' ? consentRunProblems(report) : offRunProblems(report)
const tests = consentLaneTests(report)
const tagged = tests.filter((test) => test.tagged)
const summary =
  mode === 'consent'
    ? `${tests.filter((test) => test.status === 'expected').length} passed, ${tests.filter((test) => test.status === 'skipped').length} skipped of ${tests.length} (expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} passed, 0 skipped)`
    : `${tagged.filter((test) => test.consentLaneSkip).length} of ${tagged.length} @consent-required tests skipped for the consent lane, ${tests.filter((test) => test.consentLaneSkip && !test.tagged).length} untagged (expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} and 0)`
console.log(`[consent-lane] ${mode} run: ${summary}`)
for (const problem of problems) console.error(`[consent-lane] ${problem}`)
process.exit(problems.length ? 1 : 0)
