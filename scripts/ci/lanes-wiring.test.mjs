// The lane map (scripts/ci/lanes.mjs) names, for each lane, the workflow and jobs it gates. These
// tests hold the workflows to that map: every gated job reads its own lane from one identical
// plan job, and no other pull request job reads the plan, so a lane cannot be skipped by a job
// the map does not know about.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'
import { LANES } from './lanes.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflowsDir = path.join(root, '.github/workflows')
const workflows = Object.fromEntries(
  readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => [file, parse(readFileSync(path.join(workflowsDir, file), 'utf8'))])
)
const needsOf = (job) => [job?.needs ?? []].flat()
const conditionOf = (job) => String(job?.if ?? '')
const planCondition = (lane) => `fromJSON(needs.lanes.outputs.plan)['${lane}']`
const runsOnPullRequest = (workflow) => {
  const on = workflow.on ?? workflow[true]
  if (typeof on === 'string') return on === 'pull_request'
  if (Array.isArray(on)) return on.includes('pull_request')
  return !!on && typeof on === 'object' && 'pull_request' in on
}

// The coverage lanes gate one matrix job together: the plan's shard list is its matrix, and an
// empty list skips it.
const COVERAGE_JOB = 'tests-shard'
const isCoverageLane = (lane) => lane.startsWith('coverage-')

/** Every [lane, workflow file, job id] the map names. */
const gated = Object.entries(LANES).flatMap(([lane, { workflow, jobs }]) =>
  jobs.map((job) => [lane, workflow, job])
)
const laneWorkflows = [
  ...new Set(Object.values(LANES).map(({ workflow }) => workflow)),
].sort()

test('every workflow and job the lane map names exists', () => {
  for (const [lane, file, job] of gated) {
    assert.ok(workflows[file], `${lane}: ${file} exists`)
    assert.ok(
      runsOnPullRequest(workflows[file]),
      `${lane}: ${file} runs on pull requests`
    )
    assert.ok(workflows[file].jobs?.[job], `${lane}: ${file} has job ${job}`)
  }
})

test('each gated job needs the plan job and runs only when its own lane does', () => {
  for (const [lane, file, id] of gated) {
    const job = workflows[file].jobs[id]
    assert.ok(needsOf(job).includes('lanes'), `${file} ${id} needs lanes`)
    if (isCoverageLane(lane)) {
      assert.equal(id, COVERAGE_JOB, lane)
      assert.equal(conditionOf(job), "needs.lanes.outputs.coverage_shards != '[]'", id)
      assert.equal(
        job.strategy.matrix.shard,
        '${{ fromJSON(needs.lanes.outputs.coverage_shards) }}',
        id
      )
      continue
    }
    assert.ok(
      conditionOf(job).includes(planCondition(lane)),
      `${file} ${id} runs when ${planCondition(lane)}: ${conditionOf(job)}`
    )
    // A job reads only its own lane, so one lane's plan never runs or skips another's job.
    const read = [...conditionOf(job).matchAll(/plan\)\['([^']+)'\]/g)].map((m) => m[1])
    assert.deepEqual([...new Set(read)], [lane], `${file} ${id} reads only ${lane}`)
  }
})

test('the plan job is identical in every lane workflow but for the workflow it names', () => {
  const withLanes = Object.keys(workflows)
    .filter((file) => workflows[file].jobs?.lanes)
    .sort()
  assert.deepEqual(withLanes, laneWorkflows)
  const normalized = (file) => {
    const job = structuredClone(workflows[file].jobs.lanes)
    const step = job.steps.find((candidate) => candidate.id === 'lanes')
    assert.equal(step.env.LANES_WORKFLOW, file, `${file} names itself`)
    delete step.env.LANES_WORKFLOW
    return job
  }
  const [first, ...rest] = laneWorkflows
  for (const file of rest) assert.deepEqual(normalized(file), normalized(first), file)

  const job = workflows[first].jobs.lanes
  assert.equal(job.name, 'Lanes')
  assert.equal(job.if, undefined, 'the plan job always runs')
  assert.equal(job.needs, undefined, 'the plan job waits on nothing')
  assert.ok(job['timeout-minutes'] <= 5)
  assert.deepEqual(job.permissions, { contents: 'read', 'pull-requests': 'read' })
  assert.deepEqual(job.outputs, {
    plan: '${{ steps.lanes.outputs.plan }}',
    coverage_shards: '${{ steps.lanes.outputs.coverage_shards }}',
  })
  const [checkout, plan] = job.steps
  assert.equal(job.steps.length, 2)
  assert.equal(checkout.uses, 'actions/checkout@v4')
  assert.equal(
    checkout.with.ref,
    '${{ github.event.pull_request.head.sha || github.sha }}'
  )
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false)
  assert.deepEqual(checkout.with['sparse-checkout'].trim().split('\n'), [
    'scripts/ci/lanes.mjs',
    'apps/*/package.json',
    'packages/*/package.json',
  ])
  assert.equal(plan.run, 'node scripts/ci/lanes.mjs')
  assert.equal(plan.env.GITHUB_TOKEN, '${{ github.token }}')
})

// The sparse checkout holds lanes.mjs and the manifests only, with no install.
test('the plan script imports Node built-ins only', () => {
  const source = readFileSync(path.join(root, 'scripts/ci/lanes.mjs'), 'utf8')
  const imports = [...source.matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1]
  )
  assert.ok(imports.length > 0)
  for (const specifier of imports) assert.match(specifier, /^node:/, specifier)
})

test('no pull request job the lane map does not list reads the plan in its condition', () => {
  const listed = new Set(gated.map(([, file, id]) => `${file}:${id}`))
  for (const [file, workflow] of Object.entries(workflows)) {
    if (!runsOnPullRequest(workflow)) continue
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      if (listed.has(`${file}:${id}`)) continue
      assert.doesNotMatch(
        conditionOf(job),
        /needs\.lanes\.outputs/,
        `${file} ${id} is gated on the plan but the lane map does not list it`
      )
    }
  }
})

// The quality gate step of pr-checks.yml `tests`: a check the plan skipped passes, any other
// skip fails, and an unreadable plan lets no skip through.
test('the quality gate accepts a check skipped by the plan and nothing else', () => {
  const step = workflows['pr-checks.yml'].jobs.tests.steps.find(
    (candidate) => candidate.name === 'Quality gate requires every quality check to pass'
  )
  assert.equal(step.env.PLAN, '${{ needs.lanes.outputs.plan }}')
  assert.equal(step.env.COVERAGE_SHARDS, '${{ needs.lanes.outputs.coverage_shards }}')
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' })
  if (jq.status !== 0) return assert.fail('jq is required to run the quality gate script')
  const gate = (results, plan, shards) =>
    spawnSync('bash', ['-e', '-c', step.run], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RESULTS: results,
        PLAN: plan,
        COVERAGE_SHARDS: shards,
      },
    }).status
  const all = (overrides) =>
    Object.entries({
      'tests-shard': 'success',
      lighthouse: 'success',
      lint: 'success',
      typecheck: 'success',
      ...overrides,
    })
      .map(([job, result]) => `${job}=${result}`)
      .join(' ')
  const skips = '{"typecheck":false,"lighthouse":false}'
  const runs = '{"typecheck":true,"lighthouse":true}'
  assert.equal(gate(all(), runs, '["api"]'), 0)
  assert.equal(
    gate(
      all({ 'tests-shard': 'skipped', lighthouse: 'skipped', typecheck: 'skipped' }),
      skips,
      '[]'
    ),
    0
  )
  // A skip the plan did not order, a lint skip, a failure and an unreadable plan all fail.
  assert.equal(gate(all({ lighthouse: 'skipped' }), runs, '["api"]'), 1)
  assert.equal(gate(all({ 'tests-shard': 'skipped' }), runs, '["api"]'), 1)
  assert.equal(gate(all({ lint: 'skipped' }), skips, '[]'), 1)
  assert.equal(gate(all({ typecheck: 'failure' }), skips, '[]'), 1)
  assert.equal(gate(all({ typecheck: 'cancelled' }), skips, '[]'), 1)
  assert.equal(gate(all({ typecheck: 'skipped', 'tests-shard': 'skipped' }), '', ''), 1)
  assert.equal(gate(all({ typecheck: 'skipped' }), 'not json', '[]'), 1)
})

// Jobs that aggregate a gated job pass when the plan skipped it.
test('the aggregators read the plan where a planned skip must pass', () => {
  const checks = workflows['pr-checks.yml'].jobs.tests
  assert.ok(needsOf(checks).includes('lanes'))
  const merge = checks.steps.find((candidate) => candidate.id === 'tests')
  assert.equal(
    merge.env.COVERAGE_PLANNED_SHARDS,
    '${{ needs.lanes.outputs.coverage_shards }}'
  )

  const gate = workflows['pr-share-card-native.yml'].jobs['share-card-lanes-gate']
  assert.ok(needsOf(gate).includes('lanes'))
  assert.equal(gate.steps.at(-1).env.CC68_LANE_PLAN, '${{ needs.lanes.outputs.plan }}')

  // These report a skipped suite and pass; the gate reads the suite's own jobs.
  for (const [file, id, suite] of [
    ['pr-mobile-e2e.yml', 'report', 'mobile-e2e-android'],
    ['pr-pw-e2e-local.yml', 'merge-reports', 'pw-e2e'],
  ]) {
    const job = workflows[file].jobs[id]
    assert.ok(needsOf(job).includes(suite), `${file} ${id}`)
    assert.equal(job.if, '${{ always() }}', `${file} ${id}`)
  }
})
