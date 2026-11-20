// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS,
  COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
} from '../modules/community/community-moderation.worker'
import {
  COMMANDS_PER_EMPTY_BLOCKING_WAIT,
  COMMANDS_PER_STALLED_CHECK,
  HOSTED_KEEP_ALIVE_MS,
  HOSTED_WORKER_CONCURRENCY,
  IDLE_DRAIN_DELAY_SECONDS,
  IDLE_LOCK_DURATION_MS,
  IDLE_MAX_STALLED_COUNT,
  IDLE_STALLED_INTERVAL_MS,
  hostedWorkerOptions,
} from './idle-worker-options'
import { WARDROBE_MAINTENANCE_TASKS } from './wardrobe-maintenance'

/** The consumers the hosted wardrobe worker starts: colour extraction, My Form, palette. */
const HOSTED_CONSUMERS = 3
/** Measured on the live service before the cut: 23.4 minus 7.6 commands a minute, rounded up. */
const BASELINE_COMMANDS_PER_HOUR = 950

function idleCommandsPerHour(): number {
  const perConsumer =
    (3600 / (IDLE_STALLED_INTERVAL_MS / 1000)) * COMMANDS_PER_STALLED_CHECK +
    (3600 / IDLE_DRAIN_DELAY_SECONDS) * COMMANDS_PER_EMPTY_BLOCKING_WAIT
  const maintenancePerHour = Object.values(WARDROBE_MAINTENANCE_TASKS).reduce(
    (sum, task) => sum + 3600_000 / task.intervalMs,
    0
  )
  return HOSTED_CONSUMERS * perConsumer + maintenancePerHour
}

describe('hosted wardrobe worker idle backoff', () => {
  it('pins the intervals: a 30 minute block, a 15 minute stalled check, keepalive probes', () => {
    expect(IDLE_DRAIN_DELAY_SECONDS).toBe(1800)
    expect(IDLE_STALLED_INTERVAL_MS).toBe(900_000)
    expect(IDLE_LOCK_DURATION_MS).toBe(30_000)
    expect(IDLE_MAX_STALLED_COUNT).toBe(1)
    expect(HOSTED_KEEP_ALIVE_MS).toBe(60_000)
    expect(HOSTED_WORKER_CONCURRENCY).toBe(1)
  })

  it('hands every consumer the same options, with keepalive on the connection', () => {
    const options = hostedWorkerOptions()
    expect(options).toMatchObject({
      concurrency: 1,
      drainDelay: 1800,
      lockDuration: 30_000,
      stalledInterval: 900_000,
      maxStalledCount: 1,
    })
    expect(options.connection).toMatchObject({ keepAlive: 60_000 })
    // BullMQ requires a stalled check no shorter than a lock, or a live job would look stalled.
    expect(options.stalledInterval).toBeGreaterThanOrEqual(options.lockDuration ?? 0)
  })

  it('keeps the whole idle service at least 5x under the measured 950 commands an hour', () => {
    expect(idleCommandsPerHour()).toBeLessThanOrEqual(BASELINE_COMMANDS_PER_HOUR / 5)
    // The arithmetic behind it: 3 x (4 x 7 + 2 x 8) plus 5 maintenance locks.
    expect(Math.round(idleCommandsPerHour())).toBe(137)
  })

  it('leaves the community worker on its own, faster recovery settings', () => {
    // Its moderation SLA needs the 120 s stalled check; the hosted worker is the slower one.
    expect(COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS).toBe(300)
    expect(COMMUNITY_MODERATION_STALLED_INTERVAL_MS).toBe(120_000)
    expect(IDLE_DRAIN_DELAY_SECONDS).toBeGreaterThan(
      COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS
    )
    expect(IDLE_STALLED_INTERVAL_MS).toBeGreaterThan(
      COMMUNITY_MODERATION_STALLED_INTERVAL_MS
    )
  })
})
