import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBillingEventCreateInput,
  buildPremiumEntitlementCreateInput,
  createBillingEvent,
  createPremiumEntitlement,
} from '@couture/testing'
import { BillingReconciliationService } from '../src/modules/commerce/billing-reconciliation.service.js'
import { PremiumEntitlementService } from '../src/modules/commerce/premium-entitlement.service.js'
import { FakeRevenueCatClient } from '../src/modules/commerce/revenuecat-client.js'
import { FakeStripeBillingClient } from '../src/modules/commerce/stripe-client.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'

/**
 * Story 5.2 Decision 4a: the reconciliation sweep against real PostgreSQL —
 * 5.2-INT-025 (a failed forward is re-driven by the sweep and the entitlement
 * activates through the same read path the product uses) and 5.2-INT-042
 * (drift correction downgrades a stale local `active` the ledger says is
 * gone, with the audit row). The sweep is invoked directly, which is exactly
 * how the worker's job processor calls it — deterministic, no queue, no
 * wall-clock sleeps.
 *
 * NOTE: no workflow runs `test:integration` in CI (deferred-work #10); this
 * evidence exists where `npm run test --workspace api` runs against a live
 * database.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "PremiumEntitlement" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "BillingEvent" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[premium-reconciliation.integration] Skipped: PostgreSQL is missing the Story 5.2 billing schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

/**
 * The sweep's table scans are global by design (that IS the production job),
 * but this database is shared: seed fixtures and parallel suite files own
 * stale entitlement rows of their own. Pulls for any user this file does not
 * own THROW, and the sweep's per-row crash isolation leaves those rows
 * untouched — proving the isolation property while keeping the shared
 * database's state out of this file's blast radius.
 */
class ScopedLedger extends FakeRevenueCatClient {
  constructor(private readonly ownedUserId: () => string) {
    super()
  }

  override getSubscriberEntitlement(appUserId: string) {
    if (appUserId !== this.ownedUserId()) {
      return Promise.reject(
        new Error('out-of-scope subscriber pull; row belongs to another suite')
      )
    }
    return super.getSubscriberEntitlement(appUserId)
  }
}

describe('5.2 billing reconciliation sweep against real PostgreSQL', () => {
  const namespace = `recon52-${randomUUID().slice(0, 8)}`
  let userId: string
  let ledger: ScopedLedger
  let service: BillingReconciliationService
  const telemetry = { captureEvent: vi.fn() }

  function buildService(): BillingReconciliationService {
    ledger = new ScopedLedger(() => userId)
    const entitlements = new PremiumEntitlementService(
      prisma,
      ledger,
      new FakeStripeBillingClient()
    )
    return new BillingReconciliationService(
      prisma,
      ledger,
      entitlements,
      telemetry as unknown as TelemetryService
    )
  }

  async function seedDueForwardRow(fetchToken: string | null): Promise<string> {
    const fixture = createBillingEvent({
      provider: 'stripe',
      externalEventId: `${namespace}-evt-${randomUUID().slice(0, 8)}`,
      eventType: 'checkout.session.completed',
      userId,
      // The factory pins the Decision 6 allowlist; spreading it keeps this
      // suite from re-stating the projection keys, which is what made a
      // projection change a multi-file edit. `fetchToken` is the forward
      // trigger's one addition and is the only key set by hand.
      payload: {
        ...createBillingEvent().payload,
        eventType: 'checkout.session.completed',
        periodType: null,
        purchasedAtMs: null,
        expirationAtMs: null,
        environment: 'false',
        fetchToken,
      },
      forwardDue: true,
      forwardAttempts: 1,
      forwardLastError: 'inline attempt failed: simulated outage',
    })

    const row = await prisma.billingEvent.create({
      data: {
        ...buildBillingEventCreateInput(fixture),
        // Backdated past the settling window so the sweep owns it; freshly
        // received rows belong to their inline attempt (and to whichever
        // parallel suite just created them). `received_at` is defaulted by the
        // column, so it is set here rather than on the fixture.
        received_at: new Date(Date.now() - 60 * 60 * 1000),
      },
      select: { id: true },
    })
    return row.id
  }

  beforeAll(async () => {
    await probeSchema()
    if (!schemaReady) return
    const user = await prisma.user.create({
      data: { email: `${namespace}-user@synthetic.test` },
    })
    userId = user.id
  })

  beforeEach(async () => {
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    service = buildService()
    if (schemaReady) {
      await prisma.billingEvent.deleteMany({
        where: { external_event_id: { startsWith: namespace } },
      })
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
    }
  })

  afterAll(async () => {
    if (schemaReady) {
      await prisma.billingEvent.deleteMany({
        where: { external_event_id: { startsWith: namespace } },
      })
      await prisma.premiumEntitlement.deleteMany({ where: { user_id: userId } })
      // The user is NOT deleted: drift corrections wrote immutable AuditLog
      // rows and AuditLog->User is RESTRICT (namespaced synthetic on a
      // disposable database).
    }
    await prisma.$disconnect()
  })

  it('5.2-INT-025: re-drives a due forward and the entitlement activates', async (context) => {
    if (!requireSchema(context)) return

    const rowId = await seedDueForwardRow(`sub_${namespace}`)

    const result = await service.sweep()

    expect(result.forwardsRedriven).toBe(1)
    const row = await prisma.billingEvent.findUnique({ where: { id: rowId } })
    expect(row?.forwarded_at).not.toBeNull()
    expect(row?.forward_last_error).toBeNull()
    expect(row?.forward_attempts).toBe(2)

    // The fake ledger materialized the forwarded subscription (mirroring RC's
    // real Stripe integration), the sweep pulled it, and the mirror now shows
    // the paid-but-locked window closed.
    const entitlement = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(entitlement).toMatchObject({ status: 'active', store: 'stripe' })
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      userId,
      'premium_entitlement_activated',
      expect.objectContaining({ store: 'stripe' })
    )
  })

  it('a still-failing forward stays due for the next sweep, attempts counted', async (context) => {
    if (!requireSchema(context)) return

    const rowId = await seedDueForwardRow(`sub_${namespace}`)
    ledger.failNextCall()

    const result = await service.sweep()

    expect(result.forwardsFailed).toBe(1)
    const row = await prisma.billingEvent.findUnique({ where: { id: rowId } })
    expect(row?.forward_due).toBe(true)
    expect(row?.forwarded_at).toBeNull()
    expect(row?.forward_attempts).toBe(2)
  })

  it('5.2-INT-042: drift correction downgrades a stale active the ledger disowns, with the audit row', async (context) => {
    if (!requireSchema(context)) return

    // 48 hours against the sweep's 24-hour staleness bound: an order of
    // magnitude of margin, so JS-vs-database clock skew cannot flip this.
    const staleSyncedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({
          userId,
          status: 'active',
          syncedAt: staleSyncedAt,
          lastEventOccurredAt: staleSyncedAt,
          lastEventId: `${namespace}-stale-seed`,
        })
      ),
    })
    // The fake ledger reports no entitlement: the mirror must follow.
    const auditsBefore = await prisma.auditLog.count({
      where: { user_id: userId, event_type: 'premium_entitlement_changed' },
    })

    const result = await service.sweep()

    // >= because the shared database's seed fixtures are also stale; their
    // out-of-scope pulls throw and leave them untouched (crash isolation).
    expect(result.entitlementsChecked).toBeGreaterThanOrEqual(1)
    expect(result.entitlementsCorrected).toBe(1)
    const row = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(row).toMatchObject({ status: 'expired', will_renew: false })
    const auditsAfter = await prisma.auditLog.count({
      where: { user_id: userId, event_type: 'premium_entitlement_changed' },
    })
    expect(auditsAfter - auditsBefore).toBe(1)
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      userId,
      'premium_entitlement_deactivated',
      expect.objectContaining({ reason: 'expired' })
    )
  })

  it('leaves a freshly-synced entitlement alone (staleness bound respected)', async (context) => {
    if (!requireSchema(context)) return

    const freshSyncedAt = new Date()
    await prisma.premiumEntitlement.create({
      data: buildPremiumEntitlementCreateInput(
        createPremiumEntitlement({
          userId,
          status: 'active',
          syncedAt: freshSyncedAt,
          lastEventOccurredAt: freshSyncedAt,
          lastEventId: `${namespace}-fresh-seed`,
        })
      ),
    })

    const before = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })

    await service.sweep()

    // A fresh row is outside the staleness bound: no pull, no change. The
    // untouched synced_at is the proof (a pull would have restamped it).
    const after = await prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    expect(after?.status).toBe('active')
    expect(after?.synced_at.toISOString()).toBe(before?.synced_at.toISOString())
  })
})
