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

/** Why a shard the lane plan left out did not run (scripts/ci/lanes.mjs). */
export const PLAN_SKIP_REASON =
  'skipped by the lane plan: no file this shard builds, runs or reads changed'

/**
 * One outcome for the whole run: any shard the plan ran that failed or left no result makes it a
 * failure. A shard outside `planned` passes and is listed in `skipped` with the reason.
 */
export function mergeShardResults(results, planned = COVERAGE_SHARDS) {
  const failures = []
  const dirs = []
  const skipped = []
  let outcome = 'success'
  for (const shard of COVERAGE_SHARDS) {
    if (!planned.includes(shard)) {
      skipped.push({ shard, reason: PLAN_SKIP_REASON })
      continue
    }
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
  return { outcome, failures, dirs: dirs.sort(), skipped }
}

/**
 * The shards the lane plan ran, from the lanes job's `coverage_shards` output. Anything but a
 * JSON array of known shards (the lanes job failed, so the output is empty) requires them all.
 */
export function plannedShards(value) {
  try {
    const shards = JSON.parse(value)
    if (Array.isArray(shards) && shards.every((shard) => COVERAGE_SHARDS.includes(shard)))
      return shards
  } catch {
    // An empty or malformed value falls through to every shard.
  }
  return [...COVERAGE_SHARDS]
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
  const { outcome, failures, dirs, skipped } = mergeShardResults(
    results,
    plannedShards(process.env.COVERAGE_PLANNED_SHARDS ?? '')
  )
  for (const { shard, reason } of skipped)
    console.log(`Coverage shard ${shard}: ${reason}`)
  if (skipped.length && process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      skipped
        .map(({ shard, reason }) => `- Coverage shard ${shard}: ${reason}\n`)
        .join('')
    )
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `outcome=${outcome}\nfailures=${JSON.stringify(failures)}\ncoverage_dirs=${JSON.stringify(dirs)}\nskipped=${JSON.stringify(skipped)}\n`
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
