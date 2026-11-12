// Story 6.14 follow-up: a clean pull request push reaches the gate in about 15 minutes.
// The e2e lanes used to wait for burn-in, which put them 14 to 16 minutes after the push
// and the gate near 30 (last clean pushes of PR 210). Burn-in still runs on every pull
// request and still fails the gate; it no longer delays the lanes.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = (name) =>
  parse(
    readFileSync(
      fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)),
      'utf8'
    )
  )
const needs = (job) => [job.needs ?? []].flat()

test('the e2e lanes start without waiting for burn-in', () => {
  const { jobs } = workflow('pr-pw-e2e-local.yml')
  for (const lane of ['pw-e2e', 'real-session-e2e', 'complimentary-access-e2e']) {
    assert.deepEqual(needs(jobs[lane]), ['vars'], lane)
    assert.doesNotMatch(String(jobs[lane].if ?? ''), /burn-in/, lane)
  }
})

test('burn-in still runs on pull requests, fails its own job and feeds the report', () => {
  const { jobs } = workflow('pr-pw-e2e-local.yml')
  assert.equal(jobs['burn-in'].uses, './.github/workflows/rwf-burn-in.yml')
  assert.match(jobs['burn-in'].if, /github\.event_name == 'pull_request'/)
  assert.ok(needs(jobs['merge-reports']).includes('burn-in'))
  // The gate requires every job; a blocked burn-in exits 1 in its report job.
  const report = workflow('rwf-burn-in.yml').jobs.report.steps.find(
    (step) => step.id === 'set-output'
  )
  assert.match(report.run, /❌ Burn-in gate blocked"\n\s*exit 1/)
})

// Each job a pull request push starts takes one of the account's 20 concurrent job slots
// (GitHub Free) and pays its own checkout and install. Checks that ran a minute or less
// now run as named steps of a neighbour, each run whatever the others did, so a failure
// still names its check and the gate, which requires every job, still requires it.
const step = (job, name) => {
  const found = job.steps.find((candidate) => candidate.name === name)
  assert.ok(found, `step ${name}`)
  return found
}
const runsRegardless = (candidate) => {
  assert.equal(candidate['continue-on-error'], undefined, candidate.name)
  assert.match(String(candidate.if ?? ''), /!cancelled\(\)|always\(\)/, candidate.name)
}

test('the folded checks run as named steps of their neighbours', () => {
  const checks = workflow('pr-checks.yml').jobs
  assert.equal(checks['runtime-deps'], undefined)
  assert.equal(checks['quality-gate'], undefined)
  runsRegardless(step(checks.typecheck, 'Verify web aliased runtime dependencies'))
  runsRegardless(step(checks.typecheck, 'Typecheck workspaces'))
  const gate = step(checks.tests, 'Quality gate requires every quality check to pass')
  assert.match(gate.if, /always\(\)/)
  for (const job of ['tests-shard', 'typecheck', 'lint', 'lighthouse']) {
    assert.ok(needs(checks.tests).includes(job), job)
    assert.match(
      gate.env.RESULTS,
      new RegExp(`${job}=\\$\\{\\{ needs\\.${job}\\.result \\}\\}`)
    )
  }

  const contracts = workflow('contract-testing.yml').jobs['local-contracts']
  assert.equal(contracts.steps[0].with['fetch-depth'], 0)
  assert.equal(
    step(contracts, 'Gitleaks secrets scan').uses,
    'gitleaks/gitleaks-action@v2'
  )
  for (const name of [
    'Schema validation, Optic lint base OpenAPI spec',
    'Schema validation, generate OpenAPI spec from code',
    'Schema validation, Optic diff against main',
    'Schema validation, checked-in socket-event schemas are current',
    'Schema validation, checked-in SDK is current',
    'Run blocking Pact workflow',
  ])
    runsRegardless(
      name === 'Run blocking Pact workflow'
        ? { ...step(contracts, name), 'continue-on-error': undefined }
        : step(contracts, name)
    )
})

test('no workflow of their own remains for the folded checks', () => {
  const dir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url))
  for (const gone of ['gitleaks-check.yml', 'schema-validation.yml'])
    assert.equal(existsSync(`${dir}${gone}`), false, gone)
})
