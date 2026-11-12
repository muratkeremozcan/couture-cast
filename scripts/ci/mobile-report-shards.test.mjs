// The mobile report action proves completeness by counting one JUnit directory per shard,
// against its `shards` input. Codex review of PR #211: the matrix grew to 12 shards while
// the input stayed 9, so three missing shard reports would have passed as complete.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(
    fileURLToPath(new URL('../../.github/workflows/pr-mobile-e2e.yml', import.meta.url)),
    'utf8'
  )
)

test('the report expects one result per matrix shard', () => {
  const shards = workflow.jobs['mobile-e2e-android'].strategy.matrix.shard
  const reports = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) =>
      step.with?.['artifact-pattern']?.startsWith('android-test-results-shard-')
    )
  assert.equal(reports.length, 1)
  assert.equal(Number(reports[0].with.shards), shards.length)
})
