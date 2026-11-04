#!/usr/bin/env node
// Splits the workspace coverage run across parallel jobs, and joins their results again.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'

export const COVERAGE_SHARDS = ['api', 'mobile', 'other']

/**
 * `other` takes whatever is not named, so a new workspace with `test:coverage` cannot fall out of
 * every shard.
 */
export function coverageShardOf(workspacePath) {
  if (workspacePath === 'apps/api') return 'api'
  if (workspacePath === 'apps/mobile') return 'mobile'
  return 'other'
}

const resultFile = (shard) => `coverage-shard-result-${shard}.json`

/** One outcome for the whole run: any shard that failed or left no result makes it a failure. */
export function mergeShardResults(results) {
  const failures = []
  const dirs = []
  let outcome = 'success'
  for (const shard of COVERAGE_SHARDS) {
    const result = results[shard]
    if (!result) {
      outcome = 'failure'
      failures.push({
        workspace: `coverage shard ${shard}`,
        reason: 'error',
        line: 'The shard left no result, so it was skipped, cancelled or crashed.',
      })
      continue
    }
    if (result.outcome !== 'success') outcome = 'failure'
    failures.push(...result.failures)
    dirs.push(...result.dirs)
  }
  return { outcome, failures, dirs: dirs.sort() }
}

function record() {
  const { SHARD, OUTCOME, DIRS, FAILURES } = process.env
  writeFileSync(
    resultFile(SHARD),
    JSON.stringify({
      outcome: OUTCOME,
      dirs: JSON.parse(DIRS || '[]'),
      failures: JSON.parse(FAILURES || '[]'),
    })
  )
}

function merge() {
  const results = {}
  for (const shard of COVERAGE_SHARDS) {
    if (existsSync(resultFile(shard))) {
      results[shard] = JSON.parse(readFileSync(resultFile(shard), 'utf8'))
    }
  }
  const { outcome, failures, dirs } = mergeShardResults(results)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `outcome=${outcome}\nfailures=${JSON.stringify(failures)}\ncoverage_dirs=${JSON.stringify(dirs)}\n`
  )
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = { record, merge }[process.argv[2]]
  if (!command) {
    console.error('Usage: coverage-shards.mjs record|merge')
    process.exit(1)
  }
  command()
}
