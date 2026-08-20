import type { Queue } from 'bullmq'

/**
 * The five periodic sweeps, re-hosted off NestJS `@Cron` onto BullMQ Job
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

export const MAINTENANCE_JOB_NAMES = [
  FEATURE_FLAGS_SYNC_JOB_NAME,
  ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
  GUARDIAN_EMANCIPATION_JOB_NAME,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
  TELEMETRY_EVENT_PRUNE_JOB_NAME,
] as const

export type MaintenanceJobName = (typeof MAINTENANCE_JOB_NAMES)[number]

type MaintenanceSchedulerQueue = Pick<Queue, 'upsertJobScheduler'>

/**
 * `upsertJobScheduler` is keyed on the scheduler id, so re-running this on every
 * worker start is the intended usage rather than a leak: a restart updates the
 * existing scheduler instead of adding a sixth one.
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
  ])
}
