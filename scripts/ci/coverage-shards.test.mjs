import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  COVERAGE_SHARDS,
  coverageShardOf,
  mergeShardResults,
} from './coverage-shards.mjs'

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

test('the workflow matrix runs exactly the shards this file knows', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
  const matrix = /\n {8}shard: \[([^\]]+)\]/.exec(workflow)
  assert.ok(matrix)
  assert.deepEqual(
    matrix[1].split(',').map((shard) => shard.trim()),
    COVERAGE_SHARDS
  )
})

test('the job other checks read keeps its name and waits for every shard', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
  assert.match(
    workflow,
    /\n {2}tests:\n {4}name: Workspace tests with coverage\n(?: {4}#.*\n)* {4}needs: \[tests-shard, typecheck, lint, lighthouse\]\n {4}if: \$\{\{ always\(\) \}\}/
  )
  assert.match(workflow, /needs\.tests-shard\.result != 'success'/)
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
