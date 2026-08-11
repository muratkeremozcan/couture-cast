import { Inject, Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createBaseLogger } from '../../logger/pino.config.js'
import { CommerceRepository } from './commerce.repository.js'

/**
 * Story 5.1 AC 4: commercial records outlive telemetry.
 *
 * `AffiliateClick` and `AffiliateConversion` sit beside `TelemetryEvent`, whose
 * pruner runs hourly on a 24-hour window. Letting the affiliate tables inherit
 * that retention would silently destroy the records a partner reconciles
 * against, so they get their own pruner with their own period, and
 * `TelemetryService.pruneOldTelemetryEvents` must never be generalized to reach
 * them.
 *
 * 24 months is chosen to exceed the longest plausible partner reconciliation
 * window, and the job runs monthly because nothing about a two-year horizon
 * needs finer granularity than that.
 */
const COMMERCE_RETENTION_MONTHS = 24

/**
 * Bounded so one monthly run cannot turn into a single enormous delete that
 * holds locks across the whole table. The loop keeps going until a pass comes
 * back short, so a backlog still drains in one run.
 */
const PRUNE_BATCH_SIZE = 500

/** A hard stop so a bug in the delete path cannot spin forever. */
const MAX_PRUNE_BATCHES = 200

@Injectable()
export class CommerceRetentionService {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-retention' })

  constructor(
    @Inject(CommerceRepository)
    private readonly repository: CommerceRepository
  ) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async pruneExpiredCommerceRecords(): Promise<void> {
    const cutoff = this.retentionCutoff()

    try {
      /**
       * Conversions first. `AffiliateConversion.affiliate_click_id` is
       * `ON DELETE SET NULL`, so deleting clicks first would strip the link off
       * conversions that are themselves about to be deleted, and would leave a
       * conversion younger than the cutoff pointing at nothing if its click aged
       * out first. Deleting the older table's dependents first keeps every
       * surviving conversion's attribution intact.
       */
      const conversionsDeleted = await this.pruneInBatches(
        (limit) => this.repository.findExpiredConversionIds(cutoff, limit),
        (ids) => this.repository.deleteConversionsByIds(ids)
      )
      const clicksDeleted = await this.pruneInBatches(
        (limit) => this.repository.findExpiredClickIds(cutoff, limit),
        (ids) => this.repository.deleteClicksByIds(ids)
      )

      this.logger.info(
        { cutoff: cutoff.toISOString(), conversionsDeleted, clicksDeleted },
        'commerce_retention_pruned'
      )
    } catch (error) {
      // A failed prune is an operational problem, never a reason to crash the
      // scheduler and take every other cron job down with it.
      this.logger.error({ error }, 'commerce_retention_prune_failed')
    }
  }

  /**
   * Exposed so a test can pin the boundary without stubbing the clock globally,
   * and so the "24 months" figure has exactly one definition.
   */
  private retentionCutoff(now: Date = new Date()): Date {
    const cutoff = new Date(now.getTime())
    cutoff.setUTCMonth(cutoff.getUTCMonth() - COMMERCE_RETENTION_MONTHS)
    return cutoff
  }

  private async pruneInBatches(
    findIds: (limit: number) => Promise<readonly string[]>,
    deleteIds: (ids: readonly string[]) => Promise<number>
  ): Promise<number> {
    let deleted = 0

    for (let batch = 0; batch < MAX_PRUNE_BATCHES; batch += 1) {
      const ids = await findIds(PRUNE_BATCH_SIZE)
      if (ids.length === 0) {
        return deleted
      }

      deleted += await deleteIds(ids)

      if (ids.length < PRUNE_BATCH_SIZE) {
        return deleted
      }
    }

    this.logger.warn(
      { deleted, batchSize: PRUNE_BATCH_SIZE, maxBatches: MAX_PRUNE_BATCHES },
      'commerce_retention_batch_cap_reached'
    )
    return deleted
  }
}
