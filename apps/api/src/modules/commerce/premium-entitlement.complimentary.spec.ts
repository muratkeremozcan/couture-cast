import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PremiumEntitlementService } from './premium-entitlement.service.js'
import { FakeRevenueCatClient } from './revenuecat-client.js'
import { FakeStripeBillingClient } from './stripe-client.js'

/**
 * Story 6.14 D5, TEA-16 (U-PREMIUM-PAID-FIRST, U-PREMIUM-GRANT, U-PREMIUM-NONE) and the
 * D6 source precedence. The paid row is read first; the grant seam is asked only when the
 * paid row does not entitle, so a paying member costs no grant read. `premiumAccessSource`
 * needs both answers, and a grant wins when both apply.
 */
describe('PremiumEntitlementService with complimentary access', () => {
  const findUnique = vi.fn()
  const isActive = vi.fn()
  const prisma = { premiumEntitlement: { findUnique } } as unknown as PrismaClient
  const service = () =>
    new PremiumEntitlementService(
      prisma,
      new FakeRevenueCatClient(),
      new FakeStripeBillingClient(),
      { isActive }
    )
  const paidRow = (status: string | null) =>
    findUnique.mockResolvedValue(status === null ? null : { status })

  beforeEach(() => {
    findUnique.mockReset()
    isActive.mockReset().mockResolvedValue(false)
  })

  describe('U-PREMIUM-PAID-FIRST', () => {
    it.each(['active', 'grace_period'])(
      'paid %s answers true with zero grant reads',
      async (status) => {
        paidRow(status)
        isActive.mockResolvedValue(true)

        await expect(service().hasPremiumAccess('member-1')).resolves.toBe(true)
        expect(isActive).not.toHaveBeenCalled()
        expect(findUnique).toHaveBeenCalledTimes(1)
      }
    )
  })

  describe('U-PREMIUM-GRANT', () => {
    it.each([null, 'expired', 'revoked'])(
      'paid row %s with an active grant answers true for that member',
      async (status) => {
        paidRow(status)
        isActive.mockResolvedValue(true)

        await expect(service().hasPremiumAccess('member-1')).resolves.toBe(true)
        expect(isActive).toHaveBeenCalledTimes(1)
        expect(isActive.mock.calls[0]?.[0]).toBe('member-1')
      }
    )
  })

  describe('U-PREMIUM-NONE', () => {
    it.each([null, 'expired', 'revoked'])(
      'paid row %s and no grant answers false',
      async (status) => {
        paidRow(status)

        await expect(service().hasPremiumAccess('member-1')).resolves.toBe(false)
        expect(isActive).toHaveBeenCalledTimes(1)
      }
    )
  })

  describe('premiumAccessSource', () => {
    it.each([
      { paid: null, granted: false, source: 'none' },
      { paid: 'expired', granted: false, source: 'none' },
      { paid: 'active', granted: false, source: 'subscription' },
      { paid: 'grace_period', granted: false, source: 'subscription' },
      { paid: null, granted: true, source: 'complimentary' },
      { paid: 'revoked', granted: true, source: 'complimentary' },
      { paid: 'active', granted: true, source: 'complimentary' },
      { paid: 'grace_period', granted: true, source: 'complimentary' },
    ] as const)(
      'paid $paid, granted $granted answers $source',
      async ({ paid, granted, source }) => {
        paidRow(paid)
        isActive.mockResolvedValue(granted)

        await expect(service().premiumAccessSource('member-1')).resolves.toBe(source)
      }
    )
  })
})
