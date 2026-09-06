/**
 * Story 6.1: the periodic community sweeps, hosted on the shared `maintenance`
 * queue alongside the five sweeps that migrated off NestJS `@Cron`.
 *
 * They live on that queue for the reason `maintenance.scheduler.ts` records: the
 * API ships as one Vercel serverless function, so a `@Cron` has no long-lived
 * process to hold its timer and never fires outside a developer's laptop. The
 * worker runtime is the only substrate in this repository where a schedule
 * provably fires.
 *
 * Job names are declared here, next to the module that owns the work, so
 * `maintenance.processor.ts` routes by name without owning community logic.
 */

export const COMMUNITY_MODERATION_DISPATCH_JOB_NAME = 'community-moderation-dispatch'
export const COMMUNITY_STALE_REVIEW_JOB_NAME = 'community-stale-review-sweep'
export const COMMUNITY_UPLOAD_EXPIRY_JOB_NAME = 'community-upload-expiry-sweep'
export const COMMUNITY_ERASURE_JOB_NAME = 'community-erasure-sweep'

/**
 * Every minute. This is the latency between a post being submitted and its
 * screening job existing, so it is the floor on how long an author waits in
 * `pending_review` before anything happens at all.
 */
export const COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN = '* * * * *'

/**
 * Every five minutes, matching the moderation queue's five-minute alert SLA. A
 * post that is still `pending_review` past the stall deadline has had its job
 * lost or hung, and the sweep is what turns that silence into a terminal state
 * plus an operator-visible record.
 */
export const COMMUNITY_STALE_REVIEW_CRON_PATTERN = '*/5 * * * *'

/** Hourly, matching the wardrobe retention purge cadence. */
export const COMMUNITY_UPLOAD_EXPIRY_CRON_PATTERN = '15 * * * *'

/**
 * Every fifteen minutes. Erasure has a 72-hour deadline, so the cadence is not
 * about speed; it is about how quickly a failed object delete gets re-driven, and
 * how many retries fit inside the deadline before the sweep starts calling the
 * request overdue.
 */
export const COMMUNITY_ERASURE_CRON_PATTERN = '*/15 * * * *'

export const COMMUNITY_MAINTENANCE_JOB_NAMES = [
  COMMUNITY_MODERATION_DISPATCH_JOB_NAME,
  COMMUNITY_STALE_REVIEW_JOB_NAME,
  COMMUNITY_UPLOAD_EXPIRY_JOB_NAME,
  COMMUNITY_ERASURE_JOB_NAME,
] as const

export type CommunityMaintenanceJobName = (typeof COMMUNITY_MAINTENANCE_JOB_NAMES)[number]

type CommunitySchedulerQueue = {
  upsertJobScheduler(
    schedulerId: string,
    repeat: { pattern: string },
    job: { name: string; data: Record<string, never> }
  ): Promise<unknown>
}

/**
 * Keyed on the scheduler id, so re-running this on every worker start updates
 * the existing schedulers rather than adding duplicates.
 */
export async function registerCommunityMaintenanceSchedulers(
  queue: CommunitySchedulerQueue
): Promise<void> {
  await Promise.all([
    queue.upsertJobScheduler(
      COMMUNITY_MODERATION_DISPATCH_JOB_NAME,
      { pattern: COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN },
      { name: COMMUNITY_MODERATION_DISPATCH_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      COMMUNITY_STALE_REVIEW_JOB_NAME,
      { pattern: COMMUNITY_STALE_REVIEW_CRON_PATTERN },
      { name: COMMUNITY_STALE_REVIEW_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      COMMUNITY_UPLOAD_EXPIRY_JOB_NAME,
      { pattern: COMMUNITY_UPLOAD_EXPIRY_CRON_PATTERN },
      { name: COMMUNITY_UPLOAD_EXPIRY_JOB_NAME, data: {} }
    ),
    queue.upsertJobScheduler(
      COMMUNITY_ERASURE_JOB_NAME,
      { pattern: COMMUNITY_ERASURE_CRON_PATTERN },
      { name: COMMUNITY_ERASURE_JOB_NAME, data: {} }
    ),
  ])
}
