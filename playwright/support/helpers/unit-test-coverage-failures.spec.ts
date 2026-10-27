import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyWorkspaceOutput,
  failureLines,
  parseFailures,
  verdict,
  type WorkspaceFailure,
} from '../../../.github/actions/unit-test-coverage-comment/test-failures.mjs'

const repo = path.resolve(__dirname, '../../..')
const MODULE = path.join(
  repo,
  '.github/actions/unit-test-coverage-comment/test-failures.mjs'
)
const JOB_URL = 'https://github.com/o/r/actions/runs/1/job/2'

// Output shapes from real pr-checks runs: run 40156163063, where one apps/api test
// failed and no lcov.info was written, and run 40070250236, where
// packages/api-client missed its branch threshold by 0.14 points.
const TEST_FAILURE_OUTPUT = [
  '\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m integration/community-sync-http.integration.spec.ts > A01 final event serialization',
  ' Test Files  1 failed | 299 passed | 1 skipped (301)',
].join('\n')
const THRESHOLD_OUTPUT = [
  ' Test Files  40 passed (40)',
  'ERROR: Coverage for branches (97.86%) does not meet global threshold (98%)',
].join('\n')

describe('classifyWorkspaceOutput', () => {
  it('names a failing test and its first FAIL line, without colour codes', () => {
    expect(classifyWorkspaceOutput(TEST_FAILURE_OUTPUT)).toEqual({
      reason: 'tests',
      line: 'FAIL integration/community-sync-http.integration.spec.ts > A01 final event serialization',
    })
  })

  it('names a missed coverage threshold', () => {
    expect(classifyWorkspaceOutput(THRESHOLD_OUTPUT)).toEqual({
      reason: 'coverage',
      line: 'ERROR: Coverage for branches (97.86%) does not meet global threshold (98%)',
    })
  })

  it('reads a failed test summary without a FAIL line as a test failure', () => {
    expect(classifyWorkspaceOutput(' Test Files  2 failed (2)')).toEqual({
      reason: 'tests',
      line: '',
    })
  })

  it('falls back to an error for anything else', () => {
    expect(classifyWorkspaceOutput('npm ERR! missing script')).toEqual({
      reason: 'error',
      line: '',
    })
  })
})

describe('verdict', () => {
  it('passes only when tests and the diff floor pass', () => {
    expect(
      verdict({ testOutcome: 'success', diffThresholdFailed: false, failures: [] })
    ).toEqual({ label: 'SUCCESS', lead: '' })
    expect(
      verdict({ testOutcome: 'success', diffThresholdFailed: true, failures: [] })
    ).toEqual({ label: 'FAILURE', lead: '' })
  })

  it('names failing tests and missed thresholds per workspace', () => {
    const result = verdict({
      testOutcome: 'failure',
      diffThresholdFailed: false,
      failures: [
        { workspace: 'apps/api', reason: 'tests', line: 'FAIL a' },
        { workspace: 'packages/api-client', reason: 'coverage', line: 'ERROR: Coverage' },
      ],
    })
    expect(result.label).toBe('TESTS FAILED')
    expect(result.lead).toBe(
      '❌ **Tests failed in `apps/api`. Coverage is below its threshold in `packages/api-client`.**'
    )
  })

  it('keeps FAILURE when only a coverage threshold was missed', () => {
    const result = verdict({
      testOutcome: 'failure',
      diffThresholdFailed: false,
      failures: [{ workspace: 'packages/api-client', reason: 'coverage', line: '' }],
    })
    expect(result.label).toBe('FAILURE')
  })

  it('stays generic without failure details', () => {
    expect(
      verdict({ testOutcome: 'failure', diffThresholdFailed: false, failures: [] }).lead
    ).toBe('❌ **The test run failed.**')
  })
})

describe('failureLines', () => {
  const failures: WorkspaceFailure[] = [
    {
      workspace: 'apps/api',
      reason: 'tests',
      line: 'FAIL </code><img src=x onerror=alert(1)> | y',
    },
  ]

  it('lists the first failure line per workspace and links the job', () => {
    expect(failureLines('❌ **Tests failed.**', failures, JOB_URL)).toEqual([
      '❌ **Tests failed.**',
      '',
      '- `apps/api`: <code>FAIL &lt;/code&gt;&lt;img src=x onerror=alert(1)&gt; &#124; y</code>',
      '',
      `[Open the job log](${JOB_URL})`,
    ])
  })

  it('drops a job link without a job id or with a non-https scheme', () => {
    expect(failureLines('x', [], 'https://github.com/o/r/actions/runs/1/job/')).toEqual([
      'x',
    ])
    expect(failureLines('x', [], 'javascript:alert(1)//job/2')).toEqual(['x'])
  })

  it('renders nothing without a cause line', () => {
    expect(failureLines('', failures, JOB_URL)).toEqual([])
  })
})

describe('parseFailures', () => {
  it('ignores malformed input', () => {
    expect(parseFailures('')).toEqual([])
    expect(parseFailures('{')).toEqual([])
    expect(parseFailures('{"workspace":"x"}')).toEqual([])
    expect(
      parseFailures('[{"workspace":"x","reason":"tests"},null,{"reason":"tests"}]')
    ).toEqual([{ workspace: 'x', reason: 'tests' }])
  })
})

describe('summary command', () => {
  it('appends the cause line and job link to the step summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utcc-'))
    const summary = path.join(dir, 'summary.md')
    fs.writeFileSync(summary, '')
    const result = spawnSync(process.execPath, [MODULE, 'summary'], {
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summary,
        TEST_OUTCOME: 'failure',
        DIFF_THRESHOLD_FAILED: 'false',
        FAILURES: JSON.stringify([
          { workspace: 'apps/api', reason: 'tests', line: 'FAIL a.spec.ts' },
        ]),
        JOB_URL,
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(fs.readFileSync(summary, 'utf8')).toBe(
      [
        '',
        '❌ **Tests failed in `apps/api`.**',
        '',
        '- `apps/api`: <code>FAIL a.spec.ts</code>',
        '',
        `[Open the job log](${JOB_URL})`,
        '',
      ].join('\n')
    )
  })
})
