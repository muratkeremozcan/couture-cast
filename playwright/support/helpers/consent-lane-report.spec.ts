// TEA (2026-11-16): the @consent-required tags must not hide a lost check. These cases pin the
// report checker both CI runs go through, and the live suite's tagged count.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  consentRunProblems,
  offRunProblems,
  type PlaywrightJsonReport,
} from './consent-lane-report'
import {
  CONSENT_E2E_FILE_FILTER,
  CONSENT_LANE_ONLY,
  EXPECTED_CONSENT_REQUIRED_E2E_TESTS,
} from './guardian-consent-policy'

const repoRoot = path.resolve(__dirname, '../../..')
const laneSkip = [{ type: 'skip', description: CONSENT_LANE_ONLY }]

type Row = { file?: string; tagged: boolean; status: string; consentSkip?: boolean }
function report(rows: Row[]): PlaywrightJsonReport {
  return {
    suites: [
      {
        specs: rows.map((row, index) => ({
          title: `test ${index}`,
          file: row.file ?? 'api/guardian.spec.ts',
          tags: row.tagged ? ['consent-required'] : [],
          tests: [{ status: row.status, annotations: row.consentSkip ? laneSkip : [] }],
        })),
      },
    ],
  }
}
const tagged = (status: string, consentSkip = false) =>
  Array.from({ length: EXPECTED_CONSENT_REQUIRED_E2E_TESTS }, () => ({
    tagged: true,
    status,
    consentSkip,
  }))

describe('consent lane run (required_13_15)', () => {
  it('passes when every tagged test passed and none skipped', () => {
    expect(consentRunProblems(report(tagged('expected')))).toEqual([])
  })

  it('fails when a tagged test skipped', () => {
    const rows = tagged('expected')
    rows[0] = { tagged: true, status: 'skipped', consentSkip: false }
    expect(consentRunProblems(report(rows))).toEqual([
      'skipped: api/guardian.spec.ts › test 0',
    ])
  })

  it('fails when the count changed without the expected number changing', () => {
    expect(consentRunProblems(report(tagged('expected').slice(1)))).toEqual([
      `ran ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS - 1} tests, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} @consent-required tests`,
    ])
  })

  it('fails on an untagged test and ignores the real-session specs', () => {
    const rows: Row[] = [
      ...tagged('expected'),
      { tagged: false, status: 'expected' },
      { file: 'google-sign-in-real-session.spec.ts', tagged: true, status: 'skipped' },
    ]
    expect(consentRunProblems(report(rows))).toEqual([
      `ran ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS + 1} tests, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} @consent-required tests`,
      `ran an untagged test: api/guardian.spec.ts › test ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
    ])
  })
})

describe('sharded default run (off)', () => {
  const untagged: Row[] = [
    { tagged: false, status: 'expected' },
    // Skipped for its own reason, such as production-only: not the consent lane's business.
    { tagged: false, status: 'skipped' },
  ]

  it('passes when it skipped exactly the tagged tests for the consent lane', () => {
    expect(offRunProblems(report([...tagged('skipped', true), ...untagged]))).toEqual([])
  })

  it('fails when a tagged test ran under off', () => {
    const rows = tagged('skipped', true)
    rows[2] = { tagged: true, status: 'expected', consentSkip: false }
    expect(offRunProblems(report(rows))).toEqual([
      `skipped ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS - 1} tests for the consent lane, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
      'not skipped for the consent lane: api/guardian.spec.ts › test 2',
    ])
  })

  it('fails when an untagged test skips for the consent lane', () => {
    const rows = [
      ...tagged('skipped', true),
      { tagged: false, status: 'skipped', consentSkip: true },
    ]
    expect(offRunProblems(report(rows))).toEqual([
      `skipped ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS + 1} tests for the consent lane, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
      `skipped for the consent lane but untagged: api/guardian.spec.ts › test ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
    ])
  })

  it('fails when the tagged count changed without the expected number changing', () => {
    expect(offRunProblems(report(tagged('skipped', true).slice(1)))).toEqual([
      `found ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS - 1} @consent-required tests, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
      `skipped ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS - 1} tests for the consent lane, expected ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS}`,
    ])
  })
})

describe('the live suite', () => {
  it('npm run test:pw-consent passes the file filter and the tag', () => {
    const scripts = (
      JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(scripts['test:pw-consent']).toContain('GUARDIAN_CONSENT_POLICY=required_13_15')
    expect(scripts['test:pw-consent']).toContain(
      `--grep @consent-required '${CONSENT_E2E_FILE_FILTER}'`
    )
  })

  it(`lists exactly ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} @consent-required tests for the consent lane`, () => {
    const listed = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        '--list',
        '--grep',
        '@consent-required',
        CONSENT_E2E_FILE_FILTER,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          TEST_ENV: 'local',
          GUARDIAN_CONSENT_POLICY: 'required_13_15',
        },
      }
    )
    expect(listed.status, listed.stderr).toBe(0)
    expect(listed.stdout).toMatch(
      new RegExp(`Total: ${EXPECTED_CONSENT_REQUIRED_E2E_TESTS} tests in \\d+ files`)
    )
  }, 120_000)
})
