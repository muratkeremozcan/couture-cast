// Story 6.13 owner: the daily prune of old alerts and the enforcement drift check, in `apps/api/src/modules/moderation/moderation-history.retention.ts`.
// It reaches one table. Decisions, audit rows, events and reports are never pruned by any job.
import type { PrismaClient } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  failedModerationHistoryChecks,
  type ModerationHistoryEnforcementCheck,
} from './moderation-history.enforcement.js'
import {
  MODERATION_ALERT_PRUNE_BATCH,
  MODERATION_HISTORY_SUBJECT,
  moderationAlertRetentionCutoff,
} from './moderation-history.rules.js'

export const MODERATION_HISTORY_LOG_EVENTS = Object.freeze({
  drift: 'moderation_history_enforcement_drift',
  checkFailed: 'moderation_history_enforcement_check_failed',
  flagUnavailable: 'moderation_history_flag_unavailable',
  pruned: 'moderation_history_alerts_pruned',
  pruneFailed: 'moderation_history_prune_failed',
} as const)

/** Once at boot and then every day, because a worker that restarts daily would never reach a bare interval. */
export const MODERATION_HISTORY_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000

interface RetentionFlags {
  getFeatureFlag(key: string, subject: string): Promise<unknown>
}

interface RetentionLogger {
  info(data: object, message: string): void
  error(data: object, message: string): void
}

export interface ModerationHistoryRetentionDeps {
  prisma: PrismaClient
  flags: RetentionFlags
  clock: () => Date
  logger: RetentionLogger
}

export interface ModerationHistoryRetentionResult {
  drift: ModerationHistoryEnforcementCheck[]
  pruned: number
  skipped: boolean
}

export class ModerationHistoryRetention {
  constructor(private readonly deps: ModerationHistoryRetentionDeps) {}

  /** The drift check runs with the flag off too: enforcement is live from the migration on. */
  async run(): Promise<ModerationHistoryRetentionResult> {
    const drift = await this.checkEnforcement()
    if (!(await this.enabled())) return { drift, pruned: 0, skipped: true }
    return { drift, pruned: await this.prune(), skipped: false }
  }

  private async checkEnforcement(): Promise<ModerationHistoryEnforcementCheck[]> {
    const { logger, prisma } = this.deps
    try {
      const drift = await failedModerationHistoryChecks((sql) =>
        prisma.$queryRawUnsafe<{ ok: boolean | null }[]>(sql)
      )
      if (drift.length > 0)
        logger.error(
          { event: MODERATION_HISTORY_LOG_EVENTS.drift, checks: drift },
          MODERATION_HISTORY_LOG_EVENTS.drift
        )
      return drift
    } catch {
      // An error message can carry row data, so it never leaves.
      logger.error(
        { event: MODERATION_HISTORY_LOG_EVENTS.checkFailed },
        MODERATION_HISTORY_LOG_EVENTS.checkFailed
      )
      return []
    }
  }

  private async enabled(): Promise<boolean> {
    try {
      const { flags } = this.deps
      return (
        (await flags.getFeatureFlag(
          'moderation_history_enabled',
          MODERATION_HISTORY_SUBJECT
        )) === true &&
        (await flags.getFeatureFlag(
          'moderation_console_enabled',
          MODERATION_HISTORY_SUBJECT
        )) === true
      )
    } catch {
      this.deps.logger.error(
        { event: MODERATION_HISTORY_LOG_EVENTS.flagUnavailable },
        MODERATION_HISTORY_LOG_EVENTS.flagUnavailable
      )
      return false
    }
  }

  /** Oldest first. A row that still owes its failure record stays, and `pending` is never selected. */
  private async prune(): Promise<number> {
    const { logger, prisma, clock } = this.deps
    const cutoff = moderationAlertRetentionCutoff(clock()).toISOString()
    try {
      const pruned = await prisma.$executeRaw`
        DELETE FROM "ModerationSlaAlert"
        WHERE id IN (
          SELECT id FROM "ModerationSlaAlert"
          WHERE delivery IN ('delivered', 'console_only', 'superseded')
            AND detected_at < ${cutoff}::timestamp
            AND NOT (failure_owed_code IS NOT NULL AND failure_escalated_at IS NULL)
          ORDER BY detected_at, id
          LIMIT ${MODERATION_ALERT_PRUNE_BATCH}
          FOR UPDATE SKIP LOCKED
        )`
      if (pruned > 0)
        logger.info(
          { event: MODERATION_HISTORY_LOG_EVENTS.pruned, count: pruned },
          MODERATION_HISTORY_LOG_EVENTS.pruned
        )
      return pruned
    } catch {
      logger.error(
        { event: MODERATION_HISTORY_LOG_EVENTS.pruneFailed },
        MODERATION_HISTORY_LOG_EVENTS.pruneFailed
      )
      return 0
    }
  }
}

/** One composition for both worker processes, so they cannot drift. */
export function createModerationHistoryRetention(
  deps: Pick<ModerationHistoryRetentionDeps, 'prisma' | 'flags'>
): ModerationHistoryRetention {
  return new ModerationHistoryRetention({
    ...deps,
    clock: () => new Date(),
    logger: createBaseLogger().child({ feature: 'moderation-history' }),
  })
}
