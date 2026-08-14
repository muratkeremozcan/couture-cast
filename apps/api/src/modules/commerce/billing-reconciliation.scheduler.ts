import type { Queue } from 'bullmq'

/**
 * Story 5.2 Decision 4a: the two Job Schedulers on the `billing-reconciliation`
 * queue, registered by the worker bootstrap (`weather-scheduler.ts` precedent).
 *
 *   - `billing-reconciliation-sweep` every 15 minutes: forward-outbox re-drive
 *     plus entitlement drift correction. This cadence is what bounds
 *     paid-but-locked recovery after a RevenueCat outage — change it and the
 *     runbook's recovery promise changes with it.
 *   - `commerce-retention-sweep` monthly: the 5.1 affiliate prune re-hosted
 *     off the never-firing serverless @Cron, now also pruning BillingEvent
 *     rows at the same 24-month horizon.
 */

export const BILLING_RECONCILIATION_JOB_NAME = 'billing-reconciliation-sweep'
export const COMMERCE_RETENTION_JOB_NAME = 'commerce-retention-sweep'

export const BILLING_RECONCILIATION_SWEEP_EVERY_MS = 15 * 60 * 1000

/** First day of the month at 03:00 UTC — off the midnight thundering herd. */
export const COMMERCE_RETENTION_CRON_PATTERN = '0 3 1 * *'

type BillingSchedulerQueue = Pick<Queue, 'upsertJobScheduler'>

export async function registerBillingReconciliationSchedulers(
  queue: BillingSchedulerQueue
): Promise<void> {
  await Promise.all([
    queue.upsertJobScheduler(
      BILLING_RECONCILIATION_JOB_NAME,
      { every: BILLING_RECONCILIATION_SWEEP_EVERY_MS },
      {
        name: BILLING_RECONCILIATION_JOB_NAME,
        data: { type: 'billing-reconciliation' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    ),
    queue.upsertJobScheduler(
      COMMERCE_RETENTION_JOB_NAME,
      { pattern: COMMERCE_RETENTION_CRON_PATTERN },
      {
        name: COMMERCE_RETENTION_JOB_NAME,
        data: { type: 'commerce-retention' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }
    ),
  ])
}
