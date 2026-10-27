import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isCheck, requiredWorkflows, shadowedSteps } from './workflow-step-shadowing.mjs'

const workflows = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows'
)
const job = (steps) => ({ on: { pull_request: {} }, jobs: { gate: { steps } } })

test('a test after a failed lint is reported until it runs with !cancelled()', () => {
  const steps = [
    { uses: 'actions/checkout@v4' },
    { name: 'Lint sources', run: 'npm run lint' },
    { name: 'Build packages', run: 'npm run build' },
    { name: 'Run tests with coverage', id: 'tests', run: 'npm run test:coverage' },
    { name: 'Upload results', if: 'always()', uses: 'actions/upload-artifact@v4' },
  ]
  assert.deepEqual(shadowedSteps(job(steps)), [
    'gate: Build packages',
    'gate: Run tests with coverage',
  ])
  for (const step of steps.slice(2, 4)) step.if = '${{ !cancelled() }}'
  assert.deepEqual(shadowedSteps(job(steps)), [])
})

test('an outcome gate keeps its condition but still needs a status function', () => {
  const steps = [
    {
      name: 'Run blocking Pact workflow',
      id: 'pact',
      'continue-on-error': true,
      run: 'npm run test:pact',
    },
    {
      name: 'Pact report and comment',
      if: 'always()',
      uses: './.github/actions/pact-report-comment',
    },
    {
      name: 'Fail if Pact workflow failed',
      if: "steps.pact.outcome == 'failure'",
      run: 'exit 1',
    },
  ]
  assert.deepEqual(shadowedSteps(job(steps)), ['gate: Fail if Pact workflow failed'])
  steps[2].if = "${{ !cancelled() && steps.pact.outcome == 'failure' }}"
  assert.deepEqual(shadowedSteps(job(steps)), [])
})

test('checks that cannot fail the job, and setup before the first check, are not reported', () => {
  const steps = [
    { uses: 'actions/checkout@v4' },
    {
      name: 'Start local Supabase services',
      uses: './.github/actions/start-local-supabase',
    },
    {
      name: 'Run k6 PR smoke',
      id: 'k6',
      'continue-on-error': true,
      run: 'npm run test:k6:local',
    },
    { name: 'Summarize', run: 'echo done' },
    {
      name: 'Fail if k6 smoke failed',
      if: "steps.k6.outcome == 'failure'",
      run: 'exit 1',
    },
  ]
  assert.deepEqual(shadowedSteps(job(steps)), [])
})

test('classifies checks by command, name and report action', () => {
  for (const step of [
    { run: 'npm run typecheck' },
    { run: 'npx vitest run integration' },
    { run: 'git diff --exit-code -- packages/api-client' },
    { name: 'Robolectric tests for the focus observer', run: 'npm run x' },
    { uses: './.github/actions/unit-test-coverage-comment' },
  ])
    assert.equal(isCheck(step), true, JSON.stringify(step))
  for (const step of [
    {
      name: 'Apply migrations to the test database',
      run: 'node scripts/prisma-migrate-deploy.mjs',
    },
    {
      name: 'Cache Playwright browsers',
      uses: './.github/actions/setup-playwright-browsers',
    },
    {
      name: 'Verify startup deadline controls',
      run: 'node --test scripts/ci/a.test.mjs',
    },
  ])
    assert.equal(isCheck(step), false, JSON.stringify(step))
})

test('reads every pull-request and reusable workflow', () => {
  const files = requiredWorkflows(workflows).map(({ file }) => file)
  for (const file of ['pr-checks.yml', 'contract-testing.yml', 'rwf-e2e.yml'])
    assert.ok(files.includes(file), file)
  assert.equal(files.includes('pw-e2e-prod.yml'), false)
})

test('no required workflow lets an earlier failure silently skip a later check', () => {
  const shadowed = requiredWorkflows(workflows).flatMap(({ file, workflow }) =>
    shadowedSteps(workflow).map((step) => `${file} ${step}`)
  )
  assert.deepEqual(shadowed, [])
})
