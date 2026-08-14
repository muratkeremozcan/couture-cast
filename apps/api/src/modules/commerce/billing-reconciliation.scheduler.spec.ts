import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BILLING_RECONCILIATION_JOB_NAME,
  BILLING_RECONCILIATION_SWEEP_EVERY_MS,
  COMMERCE_RETENTION_CRON_PATTERN,
  COMMERCE_RETENTION_JOB_NAME,
  registerBillingReconciliationSchedulers,
} from './billing-reconciliation.scheduler.js'

/**
 * 5.2-INT-042 (substrate half): the Decision 4a schedulers are asserted, not
 * assumed. The 15-minute cadence is what bounds paid-but-locked recovery after
 * a RevenueCat outage, so a drive-by change to it must fail a test.
 */
describe('registerBillingReconciliationSchedulers', () => {
  it('registers the 15-minute reconciliation sweep and the monthly retention sweep', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)

    await registerBillingReconciliationSchedulers({ upsertJobScheduler })

    expect(upsertJobScheduler).toHaveBeenCalledTimes(2)
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BILLING_RECONCILIATION_JOB_NAME,
      { every: BILLING_RECONCILIATION_SWEEP_EVERY_MS },
      expect.objectContaining({ name: BILLING_RECONCILIATION_JOB_NAME })
    )
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      COMMERCE_RETENTION_JOB_NAME,
      { pattern: COMMERCE_RETENTION_CRON_PATTERN },
      expect.objectContaining({ name: COMMERCE_RETENTION_JOB_NAME })
    )
  })

  it('pins the cadences themselves: 15 minutes and the first of the month', () => {
    expect(BILLING_RECONCILIATION_SWEEP_EVERY_MS).toBe(15 * 60 * 1000)
    expect(COMMERCE_RETENTION_CRON_PATTERN).toBe('0 3 1 * *')
  })

  /**
   * Structural, like 4.4-UNIT-15: BullMQ splits a queue's jobs
   * nondeterministically across every subscribed Worker in any process, so the
   * queue must be consumed by exactly one bootstrap — and that bootstrap must
   * actually register the schedulers, or Decision 4a's substrate is a
   * decorator-on-a-serverless-function all over again.
   */
  it('the worker bootstrap consumes the queue exactly once and registers the schedulers', () => {
    const workersDir = path.resolve(__dirname, '../../workers')
    const bootstrapSources = readdirSync(workersDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => [file, readFileSync(path.join(workersDir, file), 'utf8')] as const)

    const consumers = bootstrapSources
      .filter(([, source]) => /createWorker\(\s*'billing-reconciliation'/.test(source))
      .map(([file]) => file)
    expect(consumers).toEqual(['bootstrap.ts'])

    const registrars = bootstrapSources
      .filter(([, source]) => source.includes('registerBillingReconciliationSchedulers('))
      .map(([file]) => file)
    expect(registrars).toEqual(['bootstrap.ts'])
  })
})
