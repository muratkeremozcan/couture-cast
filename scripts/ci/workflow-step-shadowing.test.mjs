import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  conditionViolations,
  isCheck,
  requiredWorkflows,
} from './workflow-step-shadowing.mjs'

const workflows = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows'
)
const job = (steps, matrix) => ({
  on: { pull_request: {} },
  jobs: { gate: { ...(matrix && { strategy: { matrix } }), steps } },
})
const rows = { platform: ['android'], include: [{ platform: 'ios', api: 0 }] }
const implicit = (step) => `gate: ${step}: implicit success() after a check that can fail`
const unknown = (step, id) =>
  `gate: ${step}: names steps.${id}, which is not an earlier step`

test('a test with implicit success after lint is reported until its condition is explicit', () => {
  const steps = [
    { uses: 'actions/checkout@v4' },
    { name: 'Setup Node', id: 'setup', uses: './.github/actions/install' },
    { name: 'Lint sources', run: 'npm run lint' },
    { name: 'Build packages', id: 'build', run: 'npm run build' },
    { name: 'Run tests with coverage', id: 'tests', run: 'npm run test:coverage' },
    { name: 'Upload results', if: 'always()', uses: 'actions/upload-artifact@v4' },
  ]
  assert.deepEqual(conditionViolations(job(steps)), [
    implicit('Build packages'),
    implicit('Run tests with coverage'),
  ])
  steps[3].if = "${{ !cancelled() && steps.setup.outcome == 'success' }}"
  steps[4].if = "${{ !cancelled() && steps.build.outcome == 'success' }}"
  assert.deepEqual(conditionViolations(job(steps)), [])
})

test('a condition naming a missing or later step is reported', () => {
  const steps = [
    { name: 'Lint sources', run: 'npm run lint' },
    {
      name: 'Run tests',
      if: "${{ !cancelled() && steps.build.outcome == 'success' }}",
      run: 'npm test',
    },
    {
      name: 'Build packages',
      id: 'build',
      if: '${{ !cancelled() }}',
      run: 'npm run build',
    },
    {
      name: 'Typecheck',
      if: "${{ !cancelled() && steps.typo.outcome == 'success' }}",
      run: 'npm run typecheck',
    },
  ]
  assert.deepEqual(conditionViolations(job(steps)), [
    unknown('Run tests', 'build'),
    unknown('Typecheck', 'typo'),
  ])
})

test('a matrix-only condition after a failed check is still implicit success', () => {
  const steps = [
    { name: 'Robolectric tests', run: 'npm run test:android' },
    { name: 'Enable KVM', if: "matrix.platform == 'android'", run: 'true' },
  ]
  assert.deepEqual(conditionViolations(job(steps, rows)), [implicit('Enable KVM')])
})

test('a matrix clause must name a key and value the job matrix produces', () => {
  const steps = [
    { name: 'Lint', if: "matrix.platform == 'ios' && matrix.api == '0'", run: 'true' },
    { name: 'Typo value', if: "matrix.platform == 'androd'", run: 'true' },
    {
      name: 'Typo key',
      if: "${{ !cancelled() && matrix.platfrom == 'android' }}",
      run: 'true',
    },
  ]
  assert.deepEqual(conditionViolations(job(steps, rows)), [
    "gate: Typo value: matrix.platform is never 'androd' in the job matrix",
    'gate: Typo key: matrix.platfrom is not a key of the job matrix',
  ])
  assert.deepEqual(conditionViolations(job(steps.slice(0, 1))), [
    'gate: Lint: matrix.platform is not a key of the job matrix',
    'gate: Lint: matrix.api is not a key of the job matrix',
  ])
})

test('setup before the first check, and checks that cannot fail the job, keep implicit success', () => {
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
  assert.deepEqual(conditionViolations(job(steps)), [])
})

test('classifies checks by command, name and report action', () => {
  for (const step of [
    { run: 'npm run typecheck' },
    { run: 'npx vitest run integration' },
    { run: 'git diff --exit-code -- packages/api-client' },
    { run: 'node --test scripts/ci/a.test.mjs' },
    { run: 'node scripts/ci/node-test-gate.mjs startup-deadline' },
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
  ])
    assert.equal(isCheck(step), false, JSON.stringify(step))
})

test('reads every pull-request and reusable workflow', () => {
  const files = requiredWorkflows(workflows).map(({ file }) => file)
  for (const file of ['pr-checks.yml', 'contract-testing.yml', 'rwf-e2e.yml'])
    assert.ok(files.includes(file), file)
  assert.equal(files.includes('pw-e2e-prod.yml'), false)
})

test('every required workflow states each condition after its first check that can fail', () => {
  const violations = requiredWorkflows(workflows).flatMap(({ file, workflow }) =>
    conditionViolations(workflow).map((violation) => `${file} ${violation}`)
  )
  assert.deepEqual(violations, [])
})
