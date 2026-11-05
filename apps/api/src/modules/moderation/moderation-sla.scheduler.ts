// Story 6.12 owner: the SLA sweep's trigger in `apps/api/src/modules/moderation/moderation-sla.scheduler.ts`.
// The general worker drives it from this Job Scheduler on `maintenance`. The hosted community
// worker does not subscribe to that queue, so it runs the same function on the interval below.

export const MODERATION_SLA_SWEEP_JOB_NAME = 'moderation-sla-sweep'

/** Every minute: a breach alert waits at most one sweep plus the channel. */
export const MODERATION_SLA_SWEEP_CRON_PATTERN = '* * * * *'
export const MODERATION_SLA_SWEEP_INTERVAL_MS = 60_000

type ModerationSlaSchedulerQueue = {
  upsertJobScheduler(
    schedulerId: string,
    repeat: { pattern: string },
    job: { name: string; data: Record<string, never> }
  ): Promise<unknown>
}

/** Keyed on the scheduler id, so each worker start updates the one scheduler. */
export async function registerModerationSlaScheduler(
  queue: ModerationSlaSchedulerQueue
): Promise<void> {
  await queue.upsertJobScheduler(
    MODERATION_SLA_SWEEP_JOB_NAME,
    { pattern: MODERATION_SLA_SWEEP_CRON_PATTERN },
    { name: MODERATION_SLA_SWEEP_JOB_NAME, data: {} }
  )
}
