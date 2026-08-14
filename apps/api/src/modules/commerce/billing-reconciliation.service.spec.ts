import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'
import { BillingReconciliationService } from './billing-reconciliation.service.js'
import { FakeRevenueCatClient } from './revenuecat-client.js'

/**
 * Story 5.2 Decision 4a: the sweep's failure isolation and abandonment rules
 * against mocks. The end-to-end re-drive (fail → sweep → entitlement active)
 * and drift correction run against real PostgreSQL in
 * `integration/premium-reconciliation.integration.spec.ts`.
 */
describe('BillingReconciliationService', () => {
  const billingEvent = { findMany: vi.fn(), update: vi.fn() }
  const premiumEntitlement = { findMany: vi.fn() }
  const prisma = { billingEvent, premiumEntitlement } as unknown as PrismaClient
  const entitlements = { applyLedgerSnapshot: vi.fn() }
  const telemetry = { captureEvent: vi.fn() }
  let ledger: FakeRevenueCatClient
  let service: BillingReconciliationService

  beforeEach(() => {
    billingEvent.findMany.mockReset().mockResolvedValue([])
    billingEvent.update.mockReset().mockResolvedValue({})
    premiumEntitlement.findMany.mockReset().mockResolvedValue([])
    entitlements.applyLedgerSnapshot.mockReset().mockResolvedValue(null)
    telemetry.captureEvent.mockReset().mockResolvedValue(undefined)
    ledger = new FakeRevenueCatClient()
    service = new BillingReconciliationService(
      prisma,
      ledger,
      entitlements as unknown as PremiumEntitlementService,
      telemetry as unknown as TelemetryService
    )
  })

  it('crash-isolates the duties: a forward-duty throw cannot kill drift correction', async () => {
    billingEvent.findMany.mockRejectedValue(new Error('forward scan exploded'))
    premiumEntitlement.findMany.mockResolvedValue([{ user_id: 'user-1' }])

    const result = await service.sweep()

    // Duty 1 died, duty 2 still ran its scan and its pull.
    expect(result.entitlementsChecked).toBe(1)
    expect(entitlements.applyLedgerSnapshot).toHaveBeenCalledWith(
      'user-1',
      null,
      expect.any(String)
    )
  })

  /**
   * One due forward-outbox row as the sweep's scan returns it. The shape is
   * repeated across five cases that each vary exactly one field, so the
   * variation is what the call site shows and the rest stays out of the way.
   */
  const dueForwardRow = (
    overrides: { userId?: string | null; fetchToken?: string | null } = {}
  ) => ({
    id: 'be-1',
    user_id: overrides.userId === undefined ? 'user-1' : overrides.userId,
    payload: {
      fetchToken: overrides.fetchToken === undefined ? 'sub_123' : overrides.fetchToken,
    },
  })

  it('crash-isolates the duties the other way: a drift-duty throw is contained', async () => {
    premiumEntitlement.findMany.mockRejectedValue(new Error('drift scan exploded'))

    await expect(service.sweep()).resolves.toMatchObject({ forwardsRedriven: 0 })
  })

  it('re-drives a due forward, stamps the outbox, and pulls the ledger for the user', async () => {
    billingEvent.findMany.mockResolvedValue([dueForwardRow()])

    const result = await service.sweep()

    expect(result.forwardsRedriven).toBe(1)
    expect(ledger.getForwardedSubscription('user-1')).toBe('sub_123')
    expect(billingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'be-1' },
        data: expect.objectContaining({
          forwarded_at: expect.any(Date) as Date,
          forward_last_error: null,
        }) as Record<string, unknown>,
      })
    )
    // The post-forward pull ends the paid-but-locked window with this sweep.
    expect(entitlements.applyLedgerSnapshot).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'active', store: 'stripe' }),
      expect.any(String)
    )
  })

  it('keeps a failed re-drive due and records the error for the next sweep', async () => {
    billingEvent.findMany.mockResolvedValue([dueForwardRow()])
    ledger.failNextCall()

    const result = await service.sweep()

    expect(result.forwardsFailed).toBe(1)
    const update = billingEvent.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(update.data.forwarded_at).toBeUndefined()
    expect(update.data.forward_last_error).toContain('simulated ledger outage')
  })

  it('abandons an obligation with no user LOUDLY rather than rescanning it forever', async () => {
    billingEvent.findMany.mockResolvedValue([dueForwardRow({ userId: null })])

    const result = await service.sweep()

    expect(result.forwardsAbandoned).toBe(1)
    expect(billingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          forward_due: false,
          forward_last_error: expect.stringContaining('no local user') as string,
        }) as Record<string, unknown>,
      })
    )
  })

  it('abandons an obligation with no fetch token the same way', async () => {
    billingEvent.findMany.mockResolvedValue([dueForwardRow({ fetchToken: null })])

    const result = await service.sweep()

    expect(result.forwardsAbandoned).toBe(1)
    expect(ledger.getForwardedSubscription('user-1')).toBeUndefined()
  })

  it('one poisoned drift row cannot stall the rest of the batch', async () => {
    premiumEntitlement.findMany.mockResolvedValue([
      { user_id: 'user-1' },
      { user_id: 'user-2' },
    ])
    ledger.failNextCall()

    const result = await service.sweep()

    expect(result.entitlementsChecked).toBe(2)
    expect(entitlements.applyLedgerSnapshot).toHaveBeenCalledTimes(1)
    expect(entitlements.applyLedgerSnapshot).toHaveBeenCalledWith(
      'user-2',
      null,
      expect.any(String)
    )
  })

  it('emits deactivation telemetry fail-open when drift correction downgrades', async () => {
    premiumEntitlement.findMany.mockResolvedValue([{ user_id: 'user-1' }])
    entitlements.applyLedgerSnapshot.mockResolvedValue({
      applied: true,
      from: 'active',
      to: 'expired',
      store: 'stripe',
      productId: 'premium_monthly',
    })
    telemetry.captureEvent.mockRejectedValue(new Error('posthog down'))

    const result = await service.sweep()

    expect(result.entitlementsCorrected).toBe(1)
    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'premium_entitlement_deactivated',
      { store: 'stripe', productId: 'premium_monthly', reason: 'expired' }
    )
  })
})
