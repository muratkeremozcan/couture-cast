import type { Queue } from 'bullmq'

/**
 * The periodic sweeps, re-hosted off NestJS `@Cron` onto BullMQ Job
 * Schedulers (`billing-reconciliation.scheduler.ts` precedent, story 5.2
 * Decision 4a).
 *
 * WHY THEY MOVED. The API ships as one Vercel serverless function
 * (`apps/api/vercel.json`), there is no Vercel `crons` config, and
 * `ScheduleModule.forRoot()` lived only in the request app. A `@Cron` needs a
 * process that stays alive between ticks; a function invocation is not one. So
 * every sweep below was dead in preview and production and alive only on a
 * developer's laptop, where `npm run start:dev` happens to keep a process up.
 * The failure was silent in the worst way: the decorators were present, the code
 * was tested, and nothing ever logged that a tick had been missed.
 *
 * EVERY CADENCE HERE IS THE CADENCE THE DECORATOR CARRIED. They are transcribed,
 * not re-chosen. Changing one changes an operational promise (retention
 * horizons, emancipation timing, how stale a feature flag may be), so treat a
 * cadence edit as a product change and not a tuning knob.
 */

export const FEATURE_FLAGS_SYNC_JOB_NAME = 'feature-flags-sync'
export const ADMIN_JOB_FAILURE_PRUNE_JOB_NAME = 'admin-job-failure-prune'
export const GUARDIAN_EMANCIPATION_JOB_NAME = 'guardian-emancipation'
export const WARDROBE_RETENTION_PURGE_JOB_NAME = 'wardrobe-retention-purge'
export const TELEMETRY_EVENT_PRUNE_JOB_NAME = 'telemetry-event-prune'
export const WARDROBE_DELETION_DRAIN_JOB_NAME = 'wardrobe-deletion-drain'

// Every five minutes, transcribed from the `@Cron` on
// `FeatureFlagsWarmup.syncFeatureFlags` (then `FeatureFlagsCron`). This bounds how stale the fallback flag
// cache may be, which is what makes a PostHog outage survivable.
export const FEATURE_FLAGS_SYNC_CRON_PATTERN = '*/5 * * * *'

/** Was `@Cron('0 3 * * *')` on `AdminCron.pruneJobFailures`. */
export const ADMIN_JOB_FAILURE_PRUNE_CRON_PATTERN = '0 3 * * *'

/**
 * Was `@Cron('5 0 * * *', { timeZone: 'UTC' })` on
 * `GuardianCron.emancipateAdults`. The timezone is part of the contract: a teen
 * turning 16 is evaluated against a UTC calendar day, so a host-local schedule
 * would emancipate on a different date depending on where the worker runs.
 */
export const GUARDIAN_EMANCIPATION_CRON_PATTERN = '5 0 * * *'
export const GUARDIAN_EMANCIPATION_TIMEZONE = 'UTC'

/** Was `@Cron(CronExpression.EVERY_HOUR)` on the retention purge. */
export const WARDROBE_RETENTION_PURGE_CRON_PATTERN = '0 * * * *'

/** Was `@Cron(CronExpression.EVERY_HOUR)` on the telemetry prune. */
export const TELEMETRY_EVENT_PRUNE_CRON_PATTERN = '0 * * * *'

/**
 * Not transcribed: added 2026-11-19 (upload review round 6, Codex C5-8). The wardrobe deletion
 * outbox drains on its own every 15 minutes, apart from the hourly retention job. A repeating
 * removal (an erased or purged photo whose publication may still write late) is due again 15
 * minutes after each run until 24 hours after its publication's lease started; an hourly drain
 * left such a write readable for up to an hour. Offset from the hourly jobs' minute 0 so the
 * serial maintenance worker does not start both at once.
 */
export const WARDROBE_DELETION_DRAIN_CRON_PATTERN = '7,22,37,52 * * * *'

export const MAINTENANCE_JOB_NAMES = [
  FEATURE_FLAGS_SYNC_JOB_NAME,
  ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
  GUARDIAN_EMANCIPATION_JOB_NAME,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
  TELEMETRY_EVENT_PRUNE_JOB_NAME,
  WARDROBE_DELETION_DRAIN_JOB_NAME,
] as const

export type MaintenanceJobName = (typeof MAINTENANCE_JOB_NAMES)[number]

type MaintenanceSchedulerQueue = Pick<Queue, 'upsertJobScheduler'>

/**
 * `upsertJobScheduler` is keyed on the scheduler id, so re-running this on every
 * worker start is the intended usage rather than a leak: a restart updates the
 * existing scheduler instead of adding another one.
 */
export async function registerMaintenanceSchedulers(
  queue: MaintenanceSchedulerQueue
): Promise<void> {
  await Promise.all([
    queue.upsertJobScheduler(
      FEATURE_FLAGS_SYNC_JOB_NAME,
      { pattern: FEATURE_FLAGS_SYNC_CRON_PATTERN },
      { name: FEATURE_FLAGS_SYNC_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
      { pattern: ADMIN_JOB_FAILURE_PRUNE_CRON_PATTERN },
      { name: ADMIN_JOB_FAILURE_PRUNE_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      GUARDIAN_EMANCIPATION_JOB_NAME,
      {
        pattern: GUARDIAN_EMANCIPATION_CRON_PATTERN,
        tz: GUARDIAN_EMANCIPATION_TIMEZONE,
      },
      { name: GUARDIAN_EMANCIPATION_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      WARDROBE_RETENTION_PURGE_JOB_NAME,
      { pattern: WARDROBE_RETENTION_PURGE_CRON_PATTERN },
      { name: WARDROBE_RETENTION_PURGE_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      TELEMETRY_EVENT_PRUNE_JOB_NAME,
      { pattern: TELEMETRY_EVENT_PRUNE_CRON_PATTERN },
      { name: TELEMETRY_EVENT_PRUNE_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      WARDROBE_DELETION_DRAIN_JOB_NAME,
      { pattern: WARDROBE_DELETION_DRAIN_CRON_PATTERN },
      { name: WARDROBE_DELETION_DRAIN_JOB_NAME, data: {} }
    ),
  ])
}

/**
 * Story 6.12: the SLA sweep. Every minute, so a breach alert waits at most one sweep plus the
 * channel. The hosted community worker does not subscribe to this queue, so it runs the same
 * function on `MODERATION_SLA_SWEEP_INTERVAL_MS` instead.
 */
export const MODERATION_SLA_SWEEP_JOB_NAME = 'moderation-sla-sweep'
export const MODERATION_SLA_SWEEP_CRON_PATTERN = '* * * * *'

/** Keyed on the scheduler id, so each worker start updates the one scheduler. */
export async function registerModerationSlaScheduler(
  queue: MaintenanceSchedulerQueue
): Promise<void> {
  await queue.upsertJobScheduler(
    MODERATION_SLA_SWEEP_JOB_NAME,
    { pattern: MODERATION_SLA_SWEEP_CRON_PATTERN },
    { name: MODERATION_SLA_SWEEP_JOB_NAME, data: {} }
  )
}

/**
 * Story 6.17 TEA-4: the orphan Auth user sweep, daily at 04:00 UTC. The hosted community worker
 * does not subscribe to this queue, so it runs the same function at boot and on an interval.
 */
export const ORPHAN_AUTH_USER_SWEEP_JOB_NAME = 'orphan-auth-user-sweep'
export const ORPHAN_AUTH_USER_SWEEP_CRON_PATTERN = '0 4 * * *'
export const ORPHAN_AUTH_USER_SWEEP_TIMEZONE = 'UTC'

/** Keyed on the scheduler id, so each worker start updates the one scheduler. */
export async function registerOrphanAuthUserSweepScheduler(
  queue: MaintenanceSchedulerQueue
): Promise<void> {
  await queue.upsertJobScheduler(
    ORPHAN_AUTH_USER_SWEEP_JOB_NAME,
    { pattern: ORPHAN_AUTH_USER_SWEEP_CRON_PATTERN, tz: ORPHAN_AUTH_USER_SWEEP_TIMEZONE },
    { name: ORPHAN_AUTH_USER_SWEEP_JOB_NAME, data: {} }
  )
}

/**
 * A gate turned off after a deploy must not leave the daily scheduler in Redis (TEA-14), so a
 * worker that boots with the gate off removes it. Removing an absent scheduler is a no-op.
 */
export async function removeOrphanAuthUserSweepScheduler(
  queue: Pick<Queue, 'removeJobScheduler'>
): Promise<void> {
  await queue.removeJobScheduler(ORPHAN_AUTH_USER_SWEEP_JOB_NAME)
}

/**
 * Story 6.13: the alert prune and enforcement drift check, daily. The hosted community worker does not
 * subscribe to this queue, so it runs the same function at boot and on an interval.
 */
export const MODERATION_HISTORY_RETENTION_JOB_NAME = 'moderation-history-retention'
export const MODERATION_HISTORY_RETENTION_CRON_PATTERN = '25 3 * * *'

/** Keyed on the scheduler id, so each worker start updates the one scheduler. */
export async function registerModerationHistoryScheduler(
  queue: MaintenanceSchedulerQueue
): Promise<void> {
  await queue.upsertJobScheduler(
    MODERATION_HISTORY_RETENTION_JOB_NAME,
    { pattern: MODERATION_HISTORY_RETENTION_CRON_PATTERN },
    { name: MODERATION_HISTORY_RETENTION_JOB_NAME, data: {} }
  )
}
