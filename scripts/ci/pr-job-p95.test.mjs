// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// C-01 (CX-11): failed, timed-out and cancelled jobs count; a job that never started counts its
// queue as a lower bound; skipped jobs are excluded with a reason; reruns time from their own
// attempt; dependency waits stay in the owner's queue measure.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { jobTiming, nearestRank, summarize } from './pr-job-p95.mjs'

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
      ...Array.from({ length: 18 }, (_, index) => job(`ios-${index}`, 1, 9)),
      job('ios-cancelled-a', 5, 20, { conclusion: 'cancelled' }),
      job('ios-cancelled-b', 10, 20, { conclusion: 'cancelled' }),
    ]
    const summary = summarize(jobs, at(60))
    assert.equal(summary.n, 20)
    assert.equal(summary.p95, 25)
    assert.equal(summary.max, 30)
    assert.equal(summary.withinBudget, false)
    assert.deepEqual(
      summary.breaches.map(({ name, total }) => [name, total]),
      [
        ['ios-cancelled-a', 25],
        ['ios-cancelled-b', 30],
      ]
    )
  })

  test('failed and timed-out jobs keep their durations', () => {
    const summary = summarize(
      [
        job('a', 2, 8, { conclusion: 'failure' }),
        job('b', 2, 21, { conclusion: 'timed_out' }),
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
    assert.deepEqual(summarize([waiting], at(14)).lowerBounds, 1)
    assert.equal(summarize([waiting], at(14)).max, 14)
  })

  test('a skipped job is left out with its reason', () => {
    const summary = summarize(
      [job('a', 1, 5), job('ios', 0, 0, { conclusion: 'skipped', started_at: null })],
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
