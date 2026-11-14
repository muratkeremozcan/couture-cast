// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  COVERAGE_SHARDS,
  PLAN_SKIP_REASON,
  coverageShardOf,
  mergeShardResults,
  plannedShards,
  shardResult,
} from './coverage-shards.mjs'
import { LANES, coverageShards } from './lanes.mjs'

const coverageWorkspaces = ['apps', 'packages'].flatMap((root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((workspace) => {
      const manifest = path.join(workspace, 'package.json')
      return (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, 'utf8')).scripts?.['test:coverage']
      )
    })
)

const passing = (dirs) => ({ outcome: 'success', dirs, failures: [] })

test('every coverage workspace lands in exactly one known shard', () => {
  assert.ok(coverageWorkspaces.includes('apps/api'))
  for (const workspace of coverageWorkspaces) {
    assert.ok(COVERAGE_SHARDS.includes(coverageShardOf(workspace)), workspace)
  }
})

test('every shard holds a workspace, so none uploads an empty result', () => {
  for (const shard of COVERAGE_SHARDS) {
    assert.ok(
      coverageWorkspaces.some((workspace) => coverageShardOf(workspace) === shard),
      shard
    )
  }
})

test('a workspace nobody named still runs', () => {
  assert.equal(coverageShardOf('packages/added-next-year'), 'other')
})

// The matrix is the lane plan's shard list, so the plan must know exactly these shards, in
// this order, and give each one a lane that gates tests-shard.
test('the workflow matrix runs exactly the shards this file knows', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
  assert.match(
    workflow,
    /\n {8}shard: \$\{\{ fromJSON\(needs\.lanes\.outputs\.coverage_shards\) \}\}\n/
  )
  const everyLane = Object.fromEntries(
    Object.keys(LANES).map((id) => [id, { run: true }])
  )
  assert.deepEqual(coverageShards(everyLane), COVERAGE_SHARDS)
  for (const shard of COVERAGE_SHARDS) {
    assert.deepEqual(LANES[`coverage-${shard}`].jobs, ['tests-shard'], shard)
    assert.equal(LANES[`coverage-${shard}`].workflow, 'pr-checks.yml', shard)
  }
})

// TEA review of 8586f43c: the mobile shard's plugin prebuild suites run after its tests, so the
// recorded outcome must read them too, or a red plugin suite shows the shard as passed.
test("a shard's recorded outcome includes the mobile plugin prebuild suites", () => {
  // Text, not a YAML parser: the merge job runs this file with no dependency install.
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
  const plugins = workflow.indexOf(
    '      - name: Mobile plugin prebuild suites\n        id: plugins\n'
  )
  const record = workflow.indexOf("      - name: Record this shard's result\n")
  assert.ok(plugins > 0, 'the plugin step carries id plugins')
  assert.ok(record > plugins, 'the record step follows the plugin step')
  const recordStep = workflow.slice(
    record,
    workflow.indexOf('\n      - name:', record + 1)
  )
  assert.match(recordStep, /\n {10}OUTCOME: \$\{\{ steps\.tests\.outcome \}\}\n/)
  assert.match(
    recordStep,
    /\n {10}PLUGINS_OUTCOME: \$\{\{ steps\.plugins\.outcome \}\}\n/
  )
})

// Antigravity handover r2 (P3): a cancelled plugin step must not record a passed shard.
test('a plugin outcome other than success or skipped fails the shard and names the step', () => {
  for (const plugins of [undefined, '', 'skipped', 'success'])
    assert.deepEqual(shardResult({ outcome: 'success', plugins, dirs: ['d'] }), {
      outcome: 'success',
      dirs: ['d'],
      failures: [],
    })
  assert.equal(shardResult({ outcome: 'failure', plugins: 'success' }).outcome, 'failure')
  for (const plugins of ['failure', 'cancelled']) {
    const result = shardResult({ outcome: 'success', plugins })
    assert.equal(result.outcome, 'failure', plugins)
    assert.deepEqual(
      result.failures.map((failure) => failure.workspace),
      ['mobile plugin prebuild suites'],
      plugins
    )
    assert.equal(
      mergeShardResults({ api: passing([]), mobile: result, other: passing([]) }).outcome,
      'failure'
    )
  }
})

test('the job other checks read keeps its name and waits for every shard', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
  assert.match(
    workflow,
    /\n {2}tests:\n {4}name: Workspace tests with coverage\n(?: {4}#.*\n)* {4}needs: \[lanes, tests-shard, typecheck, lint, lighthouse\]\n {4}if: \$\{\{ always\(\) \}\}/
  )
  assert.match(workflow, /needs\.tests-shard\.result != 'success'/)
  // The merge reads the plan's shard list, and a skipped matrix passes only when that list is
  // empty.
  assert.match(
    workflow,
    /COVERAGE_PLANNED_SHARDS: \$\{\{ needs\.lanes\.outputs\.coverage_shards \}\}\n {8}run: node scripts\/ci\/coverage-shards\.mjs merge/
  )
  assert.match(
    workflow,
    /!\(needs\.tests-shard\.result == 'skipped' && needs\.lanes\.outputs\.coverage_shards == '\[\]'\)/
  )
})

test('all passing shards merge to success with every coverage folder, sorted', () => {
  const merged = mergeShardResults({
    api: passing(['apps/api/coverage']),
    mobile: passing(['apps/mobile/coverage']),
    other: passing(['packages/db/coverage', 'apps/web/coverage']),
  })
  assert.equal(merged.outcome, 'success')
  assert.deepEqual(merged.failures, [])
  assert.deepEqual(merged.dirs, [
    'apps/api/coverage',
    'apps/mobile/coverage',
    'apps/web/coverage',
    'packages/db/coverage',
  ])
})

test('a failing shard fails the run and keeps its named failures', () => {
  const failure = { workspace: 'apps/web', reason: 'tests', line: 'FAIL x' }
  const merged = mergeShardResults({
    api: passing(['apps/api/coverage']),
    mobile: passing(['apps/mobile/coverage']),
    other: { outcome: 'failure', dirs: ['apps/web/coverage'], failures: [failure] },
  })
  assert.equal(merged.outcome, 'failure')
  assert.deepEqual(merged.failures, [failure])
  assert.ok(merged.dirs.includes('apps/web/coverage'))
})

test('a shard with no result, skipped or cancelled, fails the run', () => {
  const merged = mergeShardResults({
    api: passing(['apps/api/coverage']),
    mobile: passing(['apps/mobile/coverage']),
  })
  assert.equal(merged.outcome, 'failure')
  assert.match(merged.failures[0].workspace, /other/)
})

test('a shard the plan skipped passes and is reported with the reason', () => {
  const merged = mergeShardResults({ api: passing(['apps/api/coverage']) }, ['api'])
  assert.equal(merged.outcome, 'success')
  assert.deepEqual(merged.failures, [])
  assert.deepEqual(merged.dirs, ['apps/api/coverage'])
  assert.deepEqual(merged.skipped, [
    { shard: 'mobile', reason: PLAN_SKIP_REASON },
    { shard: 'other', reason: PLAN_SKIP_REASON },
  ])
})

test('a planned shard with no result still fails the run', () => {
  const merged = mergeShardResults({ api: passing(['apps/api/coverage']) }, [
    'api',
    'other',
  ])
  assert.equal(merged.outcome, 'failure')
  assert.match(merged.failures[0].workspace, /other/)
  assert.deepEqual(
    merged.skipped.map(({ shard }) => shard),
    ['mobile']
  )
})

test('a plan that skips every shard passes with no coverage', () => {
  const merged = mergeShardResults({}, [])
  assert.equal(merged.outcome, 'success')
  assert.deepEqual(merged.dirs, [])
  assert.equal(merged.skipped.length, COVERAGE_SHARDS.length)
})

test('the result of a shard the plan skipped is not read', () => {
  const failure = { workspace: 'apps/mobile', reason: 'tests', line: 'FAIL y' }
  const merged = mergeShardResults(
    { mobile: { outcome: 'failure', dirs: [], failures: [failure] } },
    []
  )
  // The plan skipped it, so no shard job of this run wrote that file.
  assert.equal(merged.outcome, 'success')
  assert.deepEqual(merged.failures, [])
})

test('an unreadable plan requires every shard', () => {
  for (const value of ['', 'null', '{}', '["api","web"]', 'not json'])
    assert.deepEqual(plannedShards(value), COVERAGE_SHARDS, JSON.stringify(value))
  assert.deepEqual(plannedShards('[]'), [])
  assert.deepEqual(plannedShards('["mobile"]'), ['mobile'])
})
