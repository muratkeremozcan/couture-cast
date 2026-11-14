// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// C-01 (CX-11): failed, timed-out and cancelled jobs count; a job that never started counts its
// queue as a lower bound; skipped jobs are excluded with a reason; reruns time from their own
// attempt; dependency waits stay in the owner's queue measure.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { jobTiming, nearestRank, summarize as summarizeAll } from './pr-job-p95.mjs'

/** The one job these fixtures time, with the workflow verdict beside it. */
const summarize = (jobs, now) => {
  const all = summarizeAll(jobs, now)
  return { ...(all.jobs.ios ?? {}), skipped: all.skipped, withinBudget: all.withinBudget }
}

const T0 = '2026-11-12T20:00:00Z'
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60_000).toISOString()

/** A job queued `queue` minutes after its attempt began and running `run` minutes. */
function job(name, queue, run, overrides = {}) {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    attemptCreatedAt: T0,
    created_at: T0,
    started_at: at(queue),
    completed_at: at(queue + run),
    ...overrides,
  }
}

// R4-08: the owner's budget holds for every PR job, so jobs are never pooled.
describe('per-job verdicts', () => {
  test('nineteen fast jobs cannot dilute one slow job', () => {
    const jobs = Array.from({ length: 20 }, () => [
      ...Array.from({ length: 19 }, (_, index) => job(`lint-${index}`, 0, 2)),
      job('ios', 1, 17),
    ]).flat()
    const summary = summarizeAll(jobs, at(60))
    assert.equal(summary.jobs.ios.p95, 18)
    assert.equal(summary.jobs.ios.withinBudget, false)
    assert.equal(summary.jobs['lint-0'].withinBudget, true)
    assert.equal(summary.withinBudget, false)
  })

  test('twenty different jobs from one run are not a sample', () => {
    const jobs = Array.from({ length: 20 }, (_, index) => job(`job-${index}`, 0, 2))
    const summary = summarizeAll(jobs, at(60))
    assert.equal(summary.jobs['job-0'].n, 1)
    assert.equal(summary.withinBudget, false)
  })

  test('a workflow passes only when every job passes on its own', () => {
    const jobs = Array.from({ length: 20 }, () => [
      job('android', 1, 9),
      job('ios', 2, 10),
    ]).flat()
    assert.equal(summarizeAll(jobs, at(60)).withinBudget, true)
    assert.equal(summarizeAll([], at(60)).withinBudget, false)
  })
})

describe('nearestRank', () => {
  test('p95 of 20 values is the 19th, so it differs from the maximum', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1)
    assert.equal(nearestRank(values, 0.95), 19)
    assert.equal(nearestRank(values.slice(0, 10), 0.95), 10) // at 10 runs p95 is the max
  })
})

describe('summarize', () => {
  test("Codex's counterexample: two cancelled long jobs are not dropped", () => {
    const jobs = [
      ...Array.from({ length: 18 }, () => job('ios', 1, 9)),
      job('ios', 5, 20, { conclusion: 'cancelled' }),
      job('ios', 10, 20, { conclusion: 'cancelled' }),
    ]
    const summary = summarize(jobs, at(60))
    assert.equal(summary.n, 20)
    assert.equal(summary.p95, 25)
    assert.equal(summary.max, 30)
    assert.equal(summary.withinBudget, false)
    assert.deepEqual(
      summary.breaches.map(({ name, total }) => [name, total]),
      [
        ['ios', 25],
        ['ios', 30],
      ]
    )
  })

  test('failed and timed-out jobs keep their durations', () => {
    const summary = summarize(
      [
        job('ios', 2, 8, { conclusion: 'failure' }),
        job('ios', 2, 21, { conclusion: 'timed_out' }),
      ],
      at(60)
    )
    assert.equal(summary.max, 23)
    assert.equal(summary.breaches[0].conclusion, 'timed_out')
  })

  test('a job cancelled before it started counts its queue as a lower bound', () => {
    const queued = job('ios', 0, 0, {
      conclusion: 'cancelled',
      started_at: null,
      completed_at: at(22),
    })
    const timing = jobTiming(queued, at(60))
    assert.deepEqual(
      {
        total: timing.total,
        queue: timing.queue,
        run: timing.run,
        lowerBound: timing.lowerBound,
      },
      { total: 22, queue: 22, run: 0, lowerBound: true }
    )
    assert.equal(summarize([queued], at(60)).breaches.length, 1)
  })

  test('a job still queued counts up to now as a lower bound', () => {
    const waiting = job('ios', 0, 0, {
      status: 'queued',
      conclusion: null,
      started_at: null,
      completed_at: null,
    })
    const summary = summarize([waiting], at(14))
    assert.equal(summary.lowerBounds, 1)
    assert.equal(summary.inFlight, 1)
    assert.equal(summary.n, 0)
    assert.equal(summary.max, 14)
  })

  // R3-05: in-flight rows never certify the budget, and one observation is not a sample.
  test('twenty jobs still queued at 14 minutes are not a pass', () => {
    const queued = Array.from({ length: 20 }, () =>
      job('ios', 0, 0, {
        status: 'queued',
        conclusion: null,
        started_at: null,
        completed_at: null,
      })
    )
    const summary = summarize(queued, at(14))
    assert.equal(summary.n, 0)
    assert.equal(summary.inFlight, 20)
    assert.equal(summary.withinBudget, false)
  })

  test('an in-flight job already past the ceiling is a breach', () => {
    const running = job('ios', 2, 0, {
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
    })
    assert.equal(summarize([running], at(25)).breaches.length, 1)
  })

  test('fewer than twenty completed observations never pass; twenty within budget do', () => {
    assert.equal(summarize([job('ios', 1, 5)], at(60)).withinBudget, false)
    const twenty = Array.from({ length: 20 }, () => job('ios', 1, 5))
    assert.equal(summarize(twenty, at(60)).withinBudget, true)
  })

  test('a skipped job is left out with its reason', () => {
    const summary = summarize(
      [job('ios', 1, 5), job('ios', 0, 0, { conclusion: 'skipped', started_at: null })],
      at(60)
    )
    assert.equal(summary.n, 1)
    assert.deepEqual(summary.skipped, [
      { name: 'ios', reason: 'skipped without running' },
    ])
  })

  test('a dependency wait stays in the queue measure; job queue shows the runner wait alone', () => {
    const dependent = job('ios', 12, 5, { created_at: at(10) })
    const timing = jobTiming(dependent, at(60))
    assert.equal(timing.queue, 12)
    assert.equal(timing.jobQueue, 2)
    assert.equal(timing.total, 17)
  })

  test('a rerun is timed from its own attempt', () => {
    const rerun = job('ios', 1, 9, {
      attemptCreatedAt: at(120),
      created_at: at(120),
      started_at: at(121),
      completed_at: at(130),
    })
    assert.equal(jobTiming(rerun, at(200)).total, 10)
  })

  test('a timeout that never fired does not hide a queue-inclusive breach', () => {
    // timeout-minutes 20 counts execution only: 15 minutes queued plus 12 running passes it.
    const summary = summarize([job('ios', 15, 12)], at(60))
    assert.equal(summary.max, 27)
    assert.equal(summary.breaches.length, 1)
  })
})
