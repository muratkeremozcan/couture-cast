// Says why the unit test run failed and where to look.
// A failing test used to stop Vitest writing lcov.info, the action then died on the
// missing file, and the PR kept the last green comment. A missed coverage floor read
// as a bare "FAILURE". The runner script classifies each failed workspace from its
// output, and the PR comment and step summary name the cause and link this job.

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const TEST_FAILURE = /^\s*FAIL\s+\S/
const TEST_SUMMARY_FAILED = /^\s*Test Files\s+.*\bfailed\b/
const THRESHOLD_MISSED = /^\s*ERROR: Coverage for .+ does not meet .*threshold/

/** Why one workspace's `test:coverage` exited non-zero, with the first line worth reading. */
export function classifyWorkspaceOutput(output) {
  const lines = String(output ?? '')
    .replace(ANSI, '')
    .split(/\r?\n/)
  const trim = (line) => {
    const text = line.replace(/\s+/g, ' ').trim()
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
  }
  const failedTest = lines.find((line) => TEST_FAILURE.test(line))
  if (failedTest || lines.some((line) => TEST_SUMMARY_FAILED.test(line))) {
    return { reason: 'tests', line: failedTest ? trim(failedTest) : '' }
  }
  const threshold = lines.find((line) => THRESHOLD_MISSED.test(line))
  if (threshold) return { reason: 'coverage', line: trim(threshold) }
  return { reason: 'error', line: '' }
}

export function parseFailures(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((f) => f && typeof f.workspace === 'string')
      : []
  } catch {
    return []
  }
}

/** Header status and the cause line under it. */
export function verdict({ testOutcome, diffThresholdFailed, failures }) {
  const testsPassed = testOutcome === 'success'
  if (testsPassed && !diffThresholdFailed) return { label: 'SUCCESS', lead: '' }
  if (testsPassed) return { label: 'FAILURE', lead: '' }

  const list = (reason) =>
    failures
      .filter((f) => f.reason === reason)
      .map((f) => `\`${f.workspace}\``)
      .join(', ')
  const tests = list('tests')
  const coverage = list('coverage')
  const errors = list('error')
  const causes = []
  if (tests) causes.push(`Tests failed in ${tests}.`)
  if (coverage) causes.push(`Coverage is below its threshold in ${coverage}.`)
  if (errors) causes.push(`The test run exited with an error in ${errors}.`)
  if (causes.length === 0) causes.push('The test run failed.')
  return { label: tests ? 'TESTS FAILED' : 'FAILURE', lead: `❌ **${causes.join(' ')}**` }
}

// Failure text comes from PR-authored code, so it is escaped and kept inside <code>.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\|/g, '&#124;')
}

function safeUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Markdown lines for the PR comment and the step summary, so both say the same thing. */
export function failureLines(lead, failures, jobUrl) {
  if (!lead) return []
  const lines = [lead]
  const details = failures
    .filter((f) => f.line)
    .map((f) => `- \`${f.workspace}\`: <code>${escapeHtml(f.line)}</code>`)
  if (details.length > 0) lines.push('', ...details)
  // An empty job.check_run_id leaves the URL ending in /job/, which links nowhere.
  const url = /\/job\/\d+$/.test(String(jobUrl ?? '')) ? safeUrl(jobUrl) : ''
  if (url) lines.push('', `[Open the job log](${url})`)
  return lines
}

export function summaryLines(env = process.env) {
  const result = verdict({
    testOutcome: env.TEST_OUTCOME,
    diffThresholdFailed: env.DIFF_THRESHOLD_FAILED === 'true',
    failures: parseFailures(env.FAILURES),
  })
  return failureLines(result.lead, parseFailures(env.FAILURES), env.JOB_URL)
}

if (
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href &&
  process.argv[2] === 'summary'
) {
  try {
    const lines = summaryLines()
    if (lines.length > 0)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${lines.join('\n')}\n`)
  } catch (error) {
    console.log(
      `::warning::Skipped the test failure lines in the step summary (${error.message}).`
    )
  }
}
