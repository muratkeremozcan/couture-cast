import type { Logger } from 'pino'
import type { AdminService } from '../admin/admin.service'
import type { FeatureFlagsService } from '../modules/feature-flags/feature-flags.service'
import type { GuardianService } from '../modules/guardian/guardian.service'
import type { TelemetryService } from '../modules/telemetry/telemetry.service'
import type { WardrobeRetentionService } from '../modules/wardrobe/wardrobe-retention.service'
import {
  COMMUNITY_MODERATION_DISPATCH_JOB_NAME,
  COMMUNITY_STALE_REVIEW_JOB_NAME,
  COMMUNITY_UPLOAD_EXPIRY_JOB_NAME,
  COMMUNITY_ERASURE_JOB_NAME,
} from '../modules/community/community-maintenance.scheduler'
import {
  ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
  FEATURE_FLAGS_SYNC_JOB_NAME,
  GUARDIAN_EMANCIPATION_JOB_NAME,
  TELEMETRY_EVENT_PRUNE_JOB_NAME,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
} from './maintenance.scheduler'

/**
 * The dispatch half of the `@Cron` migration: one handler for the `maintenance`
 * queue that routes a job name to the service method that used to carry the
 * decorator.
 *
 * FAILURES PROPAGATE HERE. `AdminCron` and `GuardianCron` swallowed their
 * errors, and their own tests said why: "an unhandled rejection inside a @Cron
 * handler takes down the process". That reason belonged to the substrate, not to
 * the work. On BullMQ a thrown error is the correct outcome — it marks the job
 * failed, retries it under the queue's `attempts: 3` exponential backoff, and
 * leaves a `JobFailure` row an operator can actually see. Swallowing would keep
 * a sweep that has been failing for a month looking exactly like one that has
 * been succeeding, which is the class of silence this whole migration exists to
 * end.
 *
 * The `*_failed` log lines are kept anyway, at the same event names the cron
 * wrappers used, so existing log-based alerting keeps matching.
 *
 * Two sweeps still swallow internally — `purgeExpiredAndDeletedGarments` and
 * `pruneOldTelemetryEvents` catch inside the service. That is their own
 * pre-existing behaviour and is left untouched; the migration moves triggers,
 * not service internals.
 */

export type MaintenanceSweeps = {
  admin: Pick<AdminService, 'pruneFailedJobs'>
  featureFlags: Pick<FeatureFlagsService, 'syncFlags'>
  guardian: Pick<GuardianService, 'emancipateEligibleTeens'>
  telemetry: Pick<TelemetryService, 'pruneOldTelemetryEvents'>
  wardrobeRetention: Pick<WardrobeRetentionService, 'purgeExpiredAndDeletedGarments'>
  /**
   * Story 6.1 community sweeps. Structural rather than a service reference, so
   * this module routes job names without depending on the community module's
   * class shapes.
   */
  community: {
    dispatchPending: () => Promise<unknown>
    sweepStalePendingReview: () => Promise<unknown>
    sweepExpiredUploads: () => Promise<unknown>
    sweepErasureRequests: () => Promise<unknown>
  }
}

export type MaintenanceProcessorDeps = MaintenanceSweeps & {
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
}

/** The 30-day dead-letter retention window `AdminCron` passed. */
export const JOB_FAILURE_RETENTION_DAYS = 30

type MaintenanceJob = { name: string }

export function createMaintenanceProcessor(deps: MaintenanceProcessorDeps) {
  const { logger } = deps

  async function run(
    jobName: string,
    completedEvent: string,
    failedEvent: string,
    sweep: () => Promise<unknown>
  ): Promise<void> {
    try {
      const result = await sweep()
      logger.info({ job: jobName, result }, completedEvent)
    } catch (error) {
      logger.error({ err: error, job: jobName }, failedEvent)
      throw error
    }
  }

  return async function processMaintenanceJob(job: MaintenanceJob): Promise<void> {
    switch (job.name) {
      case FEATURE_FLAGS_SYNC_JOB_NAME:
        return run(
          job.name,
          'feature_flags_sync_completed',
          'feature_flags_sync_failed',
          () => deps.featureFlags.syncFlags()
        )
      case ADMIN_JOB_FAILURE_PRUNE_JOB_NAME:
        return run(job.name, 'pruned_job_failures', 'prune_job_failures_failed', () =>
          deps.admin.pruneFailedJobs(JOB_FAILURE_RETENTION_DAYS)
        )
      case GUARDIAN_EMANCIPATION_JOB_NAME:
        return run(
          job.name,
          'guardian_consent_emancipation_completed',
          'guardian_consent_emancipation_failed',
          () => deps.guardian.emancipateEligibleTeens()
        )
      case WARDROBE_RETENTION_PURGE_JOB_NAME:
        return run(
          job.name,
          'wardrobe_retention_purge_completed',
          'wardrobe_retention_purge_failed',
          () => deps.wardrobeRetention.purgeExpiredAndDeletedGarments()
        )
      case TELEMETRY_EVENT_PRUNE_JOB_NAME:
        return run(
          job.name,
          'telemetry_event_prune_completed',
          'telemetry_event_prune_failed',
          () => deps.telemetry.pruneOldTelemetryEvents()
        )
      case COMMUNITY_MODERATION_DISPATCH_JOB_NAME:
        return run(
          job.name,
          'community_moderation_dispatch_completed',
          'community_moderation_dispatch_failed',
          () => deps.community.dispatchPending()
        )
      case COMMUNITY_STALE_REVIEW_JOB_NAME:
        return run(
          job.name,
          'community_stale_review_sweep_completed',
          'community_stale_review_sweep_failed',
          () => deps.community.sweepStalePendingReview()
        )
      case COMMUNITY_UPLOAD_EXPIRY_JOB_NAME:
        return run(
          job.name,
          'community_upload_expiry_sweep_completed',
          'community_upload_expiry_sweep_failed',
          () => deps.community.sweepExpiredUploads()
        )
      case COMMUNITY_ERASURE_JOB_NAME:
        return run(
          job.name,
          'community_erasure_sweep_completed',
          'community_erasure_sweep_failed',
          () => deps.community.sweepErasureRequests()
        )
      default:
        // Not thrown: an unknown name is almost always a scheduler left behind
        // by an older deploy, and failing it would retry it three times an hour
        // forever. Loud in the log, harmless in the queue.
        logger.warn({ job: job.name }, 'unknown_maintenance_job')
        return
    }
  }
}
