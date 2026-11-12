#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Queue-inclusive timing for pull-request jobs (story 6.15 D6, TEA-09, CX-11). The owner's budget
// is p95 of 15 minutes and a ceiling of 20 for queue plus run, so:
// - queue is job start minus the run attempt's creation (the owner's measure, which includes
//   waiting on `needs`); job start minus job creation is reported beside it;
// - failed, timed-out and cancelled jobs keep their observed durations; a job cancelled or
//   still waiting before it started counts its queue so far as a lower bound;
// - only jobs skipped without running are left out, each with its reason;
// - a job past 20 minutes is a breach even when its timeout-minutes, which counts execution
//   only, never fired.
// Usage: node scripts/ci/pr-job-p95.mjs --workflow <file.yml> [--job <name prefix>]
//   [--runs 20] [--event pull_request]
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const P95_BUDGET_MINUTES = 15
export const CEILING_MINUTES = 20
/** The owner's budget is judged on 20 consecutive completed observations (story 6.15 TEA-09). */
export const REQUIRED_SAMPLE = 20

const minutes = (from, to) => (Date.parse(to) - Date.parse(from)) / 60_000

/** Nearest-rank percentile; with n values, p95 is the value at rank ceil(0.95 n). */
export function nearestRank(values, percentile) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length, Math.ceil(percentile * sorted.length)) - 1]
}

/**
 * One job, as the GitHub jobs API returns it plus `attemptCreatedAt` (the run attempt's
 * `run_started_at`, which a rerun resets). Returns null for a job that never ran.
 */
export function jobTiming(job, now = new Date().toISOString()) {
  if (job.conclusion === 'skipped') return null
  const origin = job.attemptCreatedAt
  const started = job.started_at && job.status !== 'queued' ? job.started_at : null
  if (!started) {
    const end = job.completed_at ?? now
    return {
      name: job.name,
      conclusion: job.conclusion ?? job.status,
      total: minutes(origin, end),
      queue: minutes(origin, end),
      jobQueue: minutes(job.created_at, end),
      run: 0,
      lowerBound: true,
      inFlight: !job.completed_at,
    }
  }
  const end = job.completed_at ?? now
  return {
    name: job.name,
    conclusion: job.conclusion ?? job.status,
    total: minutes(origin, end),
    queue: minutes(origin, started),
    jobQueue: minutes(job.created_at, started),
    run: minutes(started, end),
    lowerBound: !job.completed_at,
    inFlight: !job.completed_at,
  }
}

/**
 * Completed jobs (terminal, including failed, timed-out and cancelled ones, and jobs cancelled
 * before they started, which count their queue) form the sample. Jobs still queued or running
 * are reported as lower bounds and never help a pass, though one already past the ceiling is a
 * breach. A pass needs REQUIRED_SAMPLE completed observations (R3-05).
 */
export function summarize(jobs, now) {
  const skipped = jobs
    .filter((job) => job.conclusion === 'skipped')
    .map((job) => ({ name: job.name, reason: 'skipped without running' }))
  const timings = jobs.map((job) => jobTiming(job, now)).filter(Boolean)
  const completed = timings.filter((timing) => !timing.inFlight)
  const totals = completed.map((timing) => timing.total)
  const queues = completed.map((timing) => timing.queue)
  const p95 = nearestRank(totals, 0.95)
  const max = timings.length ? Math.max(...timings.map((timing) => timing.total)) : null
  const breaches = timings.filter((timing) => timing.total > CEILING_MINUTES)
  return {
    n: completed.length,
    inFlight: timings.length - completed.length,
    p50: nearestRank(totals, 0.5),
    p95,
    max,
    queueP50: nearestRank(queues, 0.5),
    queueP95: nearestRank(queues, 0.95),
    lowerBounds: timings.filter((timing) => timing.lowerBound).length,
    breaches: breaches.map(({ name, conclusion, total }) => ({
      name,
      conclusion,
      total,
    })),
    skipped,
    withinBudget:
      completed.length >= REQUIRED_SAMPLE &&
      p95 <= P95_BUDGET_MINUTES &&
      max <= CEILING_MINUTES &&
      breaches.length === 0,
  }
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0)
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

function collect({ workflow, job, runs, event }) {
  const list = gh([
    'run',
    'list',
    '--workflow',
    workflow,
    '--event',
    event,
    '--limit',
    String(runs),
    '--json',
    'databaseId,attempt',
  ])
  const jobs = []
  for (const run of list) {
    for (let attempt = 1; attempt <= (run.attempt ?? 1); attempt += 1) {
      const attemptRun = gh([
        'api',
        `repos/{owner}/{repo}/actions/runs/${run.databaseId}/attempts/${attempt}`,
      ])
      const page = gh([
        'api',
        `repos/{owner}/{repo}/actions/runs/${run.databaseId}/attempts/${attempt}/jobs?per_page=100`,
      ])
      for (const entry of page.jobs) {
        if (job && !entry.name.startsWith(job)) continue
        jobs.push({ ...entry, attemptCreatedAt: attemptRun.run_started_at })
      }
    }
  }
  return jobs
}

function parseArgs(argv) {
  const options = { runs: 20, event: 'pull_request' }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '')
    if (!['workflow', 'job', 'runs', 'event'].includes(key))
      throw new Error(`unknown option ${argv[index]}`)
    options[key] = key === 'runs' ? Number(argv[index + 1]) : argv[index + 1]
  }
  if (!options.workflow) throw new Error('--workflow is required')
  return options
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  const summary = summarize(collect(options), new Date().toISOString())
  console.log(JSON.stringify({ ...options, ...summary }, null, 2))
  process.exit(summary.withinBudget ? 0 : 1)
}
