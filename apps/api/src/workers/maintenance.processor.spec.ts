import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODERATION_SLA_SWEEP_JOB_NAME } from '../modules/moderation/moderation-sla.scheduler'
import {
  COMMUNITY_BAN_EXPIRY_JOB_NAME,
  registerCommunityMaintenanceSchedulers,
} from '../modules/community/community-maintenance.scheduler.js'
import {
  createMaintenanceProcessor,
  JOB_FAILURE_RETENTION_DAYS,
  type MaintenanceProcessorDeps,
} from './maintenance.processor'
import {
  ADMIN_JOB_FAILURE_PRUNE_JOB_NAME,
  FEATURE_FLAGS_SYNC_JOB_NAME,
  GUARDIAN_EMANCIPATION_JOB_NAME,
  TELEMETRY_EVENT_PRUNE_JOB_NAME,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
} from './maintenance.scheduler'

/**
 * The dispatch half of the `@Cron` migration. `AdminCron` and `GuardianCron`
 * had specs of their own; this file inherits what they proved (the right
 * service method runs, with the right arguments) and replaces what they proved
 * about swallowing errors, which was a property of `@Cron` and not of the work.
 */

function build() {
  const deps = {
    admin: { pruneFailedJobs: vi.fn().mockResolvedValue({ deleted: 12 }) },
    featureFlags: { syncFlags: vi.fn().mockResolvedValue({ synced: 4 }) },
    guardian: {
      emancipateEligibleTeens: vi.fn().mockResolvedValue({
        processed: 1,
        teenIds: ['teen-18'],
        revokedConsentCount: 1,
        notificationsQueued: 1,
      }),
    },
    telemetry: { pruneOldTelemetryEvents: vi.fn().mockResolvedValue(undefined) },
    wardrobeRetention: {
      purgeExpiredAndDeletedGarments: vi.fn().mockResolvedValue(undefined),
    },
    community: {
      sweepExpiredBanHolds: vi
        .fn()
        .mockResolvedValue({ subjects: 1, posts: 1, comments: 0 }),
      sweepModerationSla: vi.fn().mockResolvedValue({ recorded: 1, delivered: 1 }),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as MaintenanceProcessorDeps & {
    logger: {
      info: ReturnType<typeof vi.fn>
      warn: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
    }
  }

  return { deps, process: createMaintenanceProcessor(deps) }
}

describe('U-W-ROUTE: the SLA sweep on the maintenance queue', () => {
  it('routes the job name to the shared sweep and logs its counts', async () => {
    const harness = build()
    await harness.process({ name: MODERATION_SLA_SWEEP_JOB_NAME })
    expect(harness.deps.community.sweepModerationSla).toHaveBeenCalledOnce()
    expect(harness.deps.logger.info).toHaveBeenCalledWith(
      { job: MODERATION_SLA_SWEEP_JOB_NAME, result: { recorded: 1, delivered: 1 } },
      expect.any(String)
    )
  })

  it('logs and rethrows a failure, so BullMQ applies attempts: 3', async () => {
    const harness = build()
    const failure = new Error('database down')
    vi.mocked(harness.deps.community.sweepModerationSla).mockRejectedValueOnce(failure)
    await expect(harness.process({ name: MODERATION_SLA_SWEEP_JOB_NAME })).rejects.toBe(
      failure
    )
    expect(harness.deps.logger.error).toHaveBeenCalledOnce()
  })

  it('still warns and returns on an unknown name', async () => {
    const harness = build()
    await harness.process({ name: 'moderation-sla-sweep-typo' })
    expect(harness.deps.community.sweepModerationSla).not.toHaveBeenCalled()
    expect(harness.deps.logger.warn).toHaveBeenCalledWith(
      { job: 'moderation-sla-sweep-typo' },
      'unknown_maintenance_job'
    )
  })
})

describe('createMaintenanceProcessor: routing', () => {
  let harness: ReturnType<typeof build>

  beforeEach(() => {
    harness = build()
  })

  it('runs the feature-flag sync', async () => {
    await harness.process({ name: FEATURE_FLAGS_SYNC_JOB_NAME })

    expect(harness.deps.featureFlags.syncFlags).toHaveBeenCalledOnce()
    expect(harness.deps.logger.info).toHaveBeenCalledWith(
      expect.anything(),
      'feature_flags_sync_completed'
    )
  })

  it('prunes dead-letter records against the 30 day retention window', async () => {
    await harness.process({ name: ADMIN_JOB_FAILURE_PRUNE_JOB_NAME })

    expect(harness.deps.admin.pruneFailedJobs).toHaveBeenCalledWith(
      JOB_FAILURE_RETENTION_DAYS
    )
    expect(JOB_FAILURE_RETENTION_DAYS).toBe(30)
  })

  it('runs the adulthood emancipation sweep', async () => {
    await harness.process({ name: GUARDIAN_EMANCIPATION_JOB_NAME })

    expect(harness.deps.guardian.emancipateEligibleTeens).toHaveBeenCalledOnce()
    expect(harness.deps.logger.info).toHaveBeenCalledWith(
      expect.anything(),
      'guardian_consent_emancipation_completed'
    )
  })

  it('runs the wardrobe retention purge', async () => {
    await harness.process({ name: WARDROBE_RETENTION_PURGE_JOB_NAME })

    expect(
      harness.deps.wardrobeRetention.purgeExpiredAndDeletedGarments
    ).toHaveBeenCalledOnce()
  })

  it('runs the telemetry event prune', async () => {
    await harness.process({ name: TELEMETRY_EVENT_PRUNE_JOB_NAME })

    expect(harness.deps.telemetry.pruneOldTelemetryEvents).toHaveBeenCalledOnce()
  })

  it('runs the sweep that returns content when a ban ends, on every worker schedule', async () => {
    await harness.process({ name: COMMUNITY_BAN_EXPIRY_JOB_NAME })
    expect(harness.deps.community.sweepExpiredBanHolds).toHaveBeenCalledOnce()

    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)
    await registerCommunityMaintenanceSchedulers({ upsertJobScheduler })
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      COMMUNITY_BAN_EXPIRY_JOB_NAME,
      { pattern: '*/5 * * * *' },
      { name: COMMUNITY_BAN_EXPIRY_JOB_NAME, data: {} }
    )
  })

  it('routes one job name to one sweep and leaves the rest alone', async () => {
    await harness.process({ name: GUARDIAN_EMANCIPATION_JOB_NAME })

    expect(harness.deps.admin.pruneFailedJobs).not.toHaveBeenCalled()
    expect(harness.deps.featureFlags.syncFlags).not.toHaveBeenCalled()
    expect(harness.deps.telemetry.pruneOldTelemetryEvents).not.toHaveBeenCalled()
    expect(
      harness.deps.wardrobeRetention.purgeExpiredAndDeletedGarments
    ).not.toHaveBeenCalled()
  })
})

describe('createMaintenanceProcessor: failure handling', () => {
  it('logs the failure event the cron wrapper logged and rethrows for BullMQ', async () => {
    // The old wrapper swallowed this, because an unhandled rejection inside a
    // `@Cron` handler kills the process. On a queue the opposite is true: a
    // thrown error is what produces the retry and the JobFailure row an
    // operator can see.
    const { deps, process } = build()
    const failure = new Error('database unreachable')
    vi.mocked(deps.admin.pruneFailedJobs).mockRejectedValueOnce(failure)

    await expect(process({ name: ADMIN_JOB_FAILURE_PRUNE_JOB_NAME })).rejects.toBe(
      failure
    )
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      'prune_job_failures_failed'
    )
  })

  it('rethrows an emancipation failure under its own event name', async () => {
    const { deps, process } = build()
    const failure = new Error('consent state unavailable')
    vi.mocked(deps.guardian.emancipateEligibleTeens).mockRejectedValueOnce(failure)

    await expect(process({ name: GUARDIAN_EMANCIPATION_JOB_NAME })).rejects.toBe(failure)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      'guardian_consent_emancipation_failed'
    )
  })

  it('warns and resolves on an unknown job rather than retrying it forever', async () => {
    // An unknown name is almost always a scheduler left behind by an older
    // deploy. Failing it would retry it three times an hour indefinitely.
    const { deps, process } = build()

    await expect(process({ name: 'retired-sweep' })).resolves.toBeUndefined()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      { job: 'retired-sweep' },
      'unknown_maintenance_job'
    )
    expect(deps.logger.error).not.toHaveBeenCalled()
  })
})
