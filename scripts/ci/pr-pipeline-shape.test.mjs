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

// The lanes wait only for the lane plan (seconds, no install) and the shared values.
test('the e2e lanes start without waiting for burn-in', () => {
  const { jobs } = workflow('pr-pw-e2e-local.yml')
  for (const lane of ['pw-e2e', 'real-session-e2e', 'complimentary-access-e2e']) {
    assert.deepEqual(needs(jobs[lane]).sort(), ['lanes', 'vars'], lane)
    assert.doesNotMatch(String(jobs[lane].if ?? ''), /burn-in/, lane)
  }
})

test('burn-in still runs on pull requests, fails its own job and feeds the report', () => {
  const { jobs } = workflow('pr-pw-e2e-local.yml')
  assert.equal(jobs['burn-in'].uses, './.github/workflows/rwf-burn-in.yml')
  assert.match(jobs['burn-in'].if, /github\.event_name == 'pull_request'/)
  // Burn-in starts first: it waits on no job, reads the skip label from the event and runs on
  // every pull request whatever the lane plan says, since any changed spec needs it.
  assert.deepEqual(needs(jobs['burn-in']), [])
  assert.match(
    jobs['burn-in'].if,
    /!contains\(github\.event\.pull_request\.labels\.\*\.name, 'SKIP_BURN_IN'\)/
  )
  assert.doesNotMatch(jobs['burn-in'].if, /needs\./)
  assert.equal(jobs.vars.outputs.SKIP_BURN_IN, undefined)
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
  // The secrets scan is its own job, which no lane plan gates: a secret can land in any file.
  // It runs on every pull request; a push to main, where every step is skipped, starts no runner.
  const secrets = workflow('contract-testing.yml').jobs.secrets
  assert.equal(secrets.if, "${{ github.event_name != 'push' }}")
  assert.equal(secrets.needs, undefined)
  assert.equal(secrets.steps[0].with['fetch-depth'], 0)
  assert.equal(step(secrets, 'Gitleaks secrets scan').uses, 'gitleaks/gitleaks-action@v2')
  assert.equal(
    step(secrets, 'Gitleaks secrets scan').if,
    "${{ github.event_name != 'push' }}"
  )
  assert.equal(
    step(secrets, 'Upload gitleaks report').if,
    "${{ always() && github.event_name != 'push' }}"
  )
  assert.equal(
    contracts.steps.some((candidate) => /gitleaks/i.test(candidate.name ?? '')),
    false
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

// The burn-in plan lists the changed specs with `playwright test --list`, which loads them and
// what they import, and nothing else: the helper unit tests run in pr-checks.yml.
test('the burn-in plan builds only what listing the specs loads', () => {
  const plan = workflow('rwf-burn-in.yml').jobs.plan.steps.find((s) => s.id === 'plan')
  assert.doesNotMatch(plan.run, /prepare:playwright|test:playwright-unit/)
  assert.match(plan.run, /npm run db:generate\n/)
  for (const workspace of ['@couture/utils', '@couture/api-client', '@couture/testing'])
    assert.match(
      plan.run,
      new RegExp(`npm run build --workspace ${workspace}\\n`),
      workspace
    )
  assert.match(plan.run, /npx tsx playwright\/scripts\/burn-in-changed\.ts/)
})

// prepare:playwright ends with the helper unit tests unless PLAYWRIGHT_UNIT_LANE is set. Every
// workflow that runs Playwright beside pr-checks.yml on pull requests and pushes sets it, so the
// tests run once, in the playwright-unit job; a manual run leaves it empty and runs them.
test('Playwright jobs beside pr-checks leave the helper unit tests to its playwright-unit job', () => {
  const scripts = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
  ).scripts
  assert.match(
    scripts['prepare:playwright'],
    / && node scripts\/playwright-unit-unless-lane\.mjs$/
  )
  assert.doesNotMatch(scripts['prepare:playwright'], /test:playwright-unit/)
  // pr-checks.yml runs the playwright-unit job on every event it runs, its own Lighthouse
  // gate's included.
  assert.equal(workflow('pr-checks.yml').env.PLAYWRIGHT_UNIT_LANE, '1')
  for (const file of ['pr-pw-e2e-local.yml', 'rwf-e2e.yml', 'rwf-burn-in.yml'])
    assert.equal(
      workflow(file).env.PLAYWRIGHT_UNIT_LANE,
      "${{ (github.event_name == 'pull_request' || github.event_name == 'push') && '1' || '' }}",
      file
    )
  const unit = workflow('pr-checks.yml').jobs['playwright-unit']
  assert.equal(unit.name, 'Playwright helper unit tests')
  assert.equal(unit.steps.at(-1).run, 'npm run test:playwright-unit')
})

test('burn-in reads the SKIP_BURN_IN label as it is now, so a rerun after adding it skips', () => {
  // A rerun keeps the original event's labels (PR 212 review), so the payload check in the
  // caller only covers labels present at push time.
  const plan = workflow('rwf-burn-in.yml').jobs.plan
  assert.equal(plan.permissions['pull-requests'], 'read')
  const current = plan.steps.find((s) => s.id === 'current_label')
  assert.ok(current, 'the plan reads the current labels')
  assert.match(current.run, /gh api "repos\/\$REPO\/issues\/\$PR\/labels"/)
  assert.match(current.run, /SKIP_BURN_IN/)
  const detect = plan.steps.find((s) => s.id === 'detect-changed')
  assert.match(String(detect.if), /steps\.current_label\.outputs\.skip != 'true'/)
  assert.ok(
    plan.steps.indexOf(current) < plan.steps.indexOf(detect),
    'the label is read before the changed specs'
  )
})
