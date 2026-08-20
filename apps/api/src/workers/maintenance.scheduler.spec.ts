import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_JOB_FAILURE_PRUNE_CRON_PATTERN,
  ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
  FEATURE_FLAGS_SYNC_CRON_PATTERN,
  FEATURE_FLAGS_SYNC_JOB_NAME,
  GUARDIAN_EMANCIPATION_CRON_PATTERN,
  GUARDIAN_EMANCIPATION_JOB_NAME,
  GUARDIAN_EMANCIPATION_TIMEZONE,
  MAINTENANCE_JOB_NAMES,
  registerMaintenanceSchedulers,
  TELEMETRY_EVENT_PRUNE_CRON_PATTERN,
  TELEMETRY_EVENT_PRUNE_JOB_NAME,
  WARDROBE_RETENTION_PURGE_CRON_PATTERN,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
} from './maintenance.scheduler'

/**
 * The proof that the `@Cron` migration preserved timing. Each expectation below
 * is the expression the decorator carried, transcribed; if someone re-tunes a
 * cadence they have to change this file too, which is the point — retention
 * horizons and emancipation dates are operational promises, not defaults.
 */

type SchedulerCall = [
  id: string,
  repeat: Record<string, unknown>,
  template: Record<string, unknown>,
]

function createQueue() {
  const upsertJobScheduler = vi.fn<(...args: SchedulerCall) => Promise<void>>(() =>
    Promise.resolve()
  )
  return {
    upsertJobScheduler,
    queue: { upsertJobScheduler } as unknown as Queue,
    calls: (): SchedulerCall[] => upsertJobScheduler.mock.calls,
  }
}

function schedulerCall(
  calls: SchedulerCall[],
  jobName: string
): SchedulerCall | undefined {
  return calls.find((call) => call[0] === jobName)
}

describe('registerMaintenanceSchedulers', () => {
  it('registers exactly the five sweeps and nothing else', async () => {
    const { upsertJobScheduler, queue, calls } = createQueue()

    await registerMaintenanceSchedulers(queue)

    expect(upsertJobScheduler).toHaveBeenCalledTimes(5)
    expect(
      calls()
        .map((call) => call[0])
        .sort()
    ).toEqual([...MAINTENANCE_JOB_NAMES].sort())
  })

  it.each([
    [FEATURE_FLAGS_SYNC_JOB_NAME, FEATURE_FLAGS_SYNC_CRON_PATTERN],
    [ADMIN_JOB_FAILURE_PRUNE_JOB_NAME, ADMIN_JOB_FAILURE_PRUNE_CRON_PATTERN],
    [GUARDIAN_EMANCIPATION_JOB_NAME, GUARDIAN_EMANCIPATION_CRON_PATTERN],
    [WARDROBE_RETENTION_PURGE_JOB_NAME, WARDROBE_RETENTION_PURGE_CRON_PATTERN],
    [TELEMETRY_EVENT_PRUNE_JOB_NAME, TELEMETRY_EVENT_PRUNE_CRON_PATTERN],
  ])('schedules %s on the cadence its @Cron carried', async (jobName, pattern) => {
    const { queue, calls } = createQueue()

    await registerMaintenanceSchedulers(queue)

    const call = schedulerCall(calls(), jobName)
    expect(call?.[1]).toMatchObject({ pattern })
    expect(call?.[2]).toMatchObject({ name: jobName })
  })

  it('pins guardian emancipation to UTC', async () => {
    // A teen turning 16 is evaluated against a UTC calendar day. A host-local
    // schedule would emancipate on a different date depending on where the
    // worker happens to run.
    const { queue, calls } = createQueue()

    await registerMaintenanceSchedulers(queue)

    expect(schedulerCall(calls(), GUARDIAN_EMANCIPATION_JOB_NAME)?.[1]).toEqual({
      pattern: GUARDIAN_EMANCIPATION_CRON_PATTERN,
      tz: GUARDIAN_EMANCIPATION_TIMEZONE,
    })
  })

  it('leaves every other sweep on the worker host clock', async () => {
    // Only the emancipation sweep has a calendar-date meaning; pinning the rest
    // to UTC would be a cadence change dressed up as consistency.
    const { queue, calls } = createQueue()

    await registerMaintenanceSchedulers(queue)

    for (const jobName of MAINTENANCE_JOB_NAMES) {
      if (jobName === GUARDIAN_EMANCIPATION_JOB_NAME) continue
      expect(schedulerCall(calls(), jobName)?.[1]).not.toHaveProperty('tz')
    }
  })

  it('is idempotent across worker restarts', async () => {
    // `upsertJobScheduler` is keyed on the scheduler id, so a restart updates
    // the five that exist rather than adding a sixth.
    const { upsertJobScheduler, queue, calls } = createQueue()

    await registerMaintenanceSchedulers(queue)
    await registerMaintenanceSchedulers(queue)

    const ids = new Set(calls().map((call) => call[0]))
    expect(upsertJobScheduler).toHaveBeenCalledTimes(10)
    expect(ids.size).toBe(5)
  })
})
