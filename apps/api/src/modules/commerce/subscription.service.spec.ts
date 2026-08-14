import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE } from '../../contracts/http.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type {
  EntitlementView,
  PremiumEntitlementService,
} from './premium-entitlement.service.js'
import type { RevenueCatClient } from './revenuecat-client.js'
import { SubscriptionService } from './subscription.service.js'

/**
 * Story 5.2: unit coverage for the status/refresh service. HTTP-visible
 * behaviour is proven over supertest in the integration suite; these cases pin
 * the branches the CI unit tier must keep honest — serialization, the rate
 * limit, the 503 mapping, and fail-open telemetry.
 */

const entitledView: EntitlementView = {
  status: 'active',
  store: 'stripe',
  productId: 'premium_monthly',
  willRenew: true,
  currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
  syncedAt: new Date('2026-08-01T00:00:00.000Z'),
}

function build(
  overrides: {
    entitlement?: EntitlementView | null
    flag?: boolean
    ledger?: () => Promise<EntitlementView | null>
  } = {}
) {
  const entitlements = {
    getEntitlement: vi.fn().mockResolvedValue(overrides.entitlement ?? null),
    applyLedgerSnapshot: vi.fn().mockResolvedValue({
      applied: true,
      from: 'none',
      to: 'active',
      store: 'stripe',
      productId: 'premium_monthly',
    }),
  }
  const featureFlags = {
    getFeatureFlag: vi.fn().mockResolvedValue(overrides.flag ?? false),
  }
  const telemetry = { captureEvent: vi.fn().mockResolvedValue(undefined) }
  const revenueCat = {
    getSubscriberEntitlement:
      overrides.ledger ??
      vi.fn().mockResolvedValue({
        status: 'active',
        store: 'stripe',
        productId: 'premium_monthly',
        willRenew: true,
        currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
      }),
  }

  const service = new SubscriptionService(
    entitlements as unknown as PremiumEntitlementService,
    featureFlags as unknown as FeatureFlagsService,
    telemetry as unknown as TelemetryService,
    revenueCat as unknown as RevenueCatClient
  )

  return { service, entitlements, featureFlags, telemetry, revenueCat }
}

describe('getSubscription serialization', () => {
  it('serializes never-subscribed as none with every key present as null', async () => {
    const { service } = build({ entitlement: null, flag: true })

    await expect(service.getSubscription('user-1')).resolves.toEqual({
      status: 'none',
      store: null,
      productId: null,
      willRenew: null,
      currentPeriodEnd: null,
      syncedAt: null,
      purchasesEnabled: true,
    })
  })

  it('serializes an entitlement with ISO timestamps and the evaluated flag', async () => {
    const { service, featureFlags } = build({ entitlement: entitledView, flag: false })

    await expect(service.getSubscription('user-1')).resolves.toEqual({
      status: 'active',
      store: 'stripe',
      productId: 'premium_monthly',
      willRenew: true,
      currentPeriodEnd: '2030-01-01T00:00:00.000Z',
      syncedAt: '2026-08-01T00:00:00.000Z',
      purchasesEnabled: false,
    })
    expect(featureFlags.getFeatureFlag).toHaveBeenCalledWith(
      'commerce_subscription_enabled',
      'user-1'
    )
  })
})

describe('refreshSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps a ledger failure onto 503 with the exported message', async () => {
    const { service } = build({
      ledger: vi.fn().mockRejectedValue(new Error('rc down')),
    })

    const attempt = service.refreshSubscription('user-1')
    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(attempt).rejects.toMatchObject({
      message: SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE,
    })
  })

  it('pulls once per window: a second refresh inside 10s serves local state', async () => {
    const { service, revenueCat } = build({})

    await service.refreshSubscription('user-1')
    vi.advanceTimersByTime(9_000)
    await service.refreshSubscription('user-1')
    expect(revenueCat.getSubscriberEntitlement).toHaveBeenCalledTimes(1)

    // Past the window the ledger is consulted again.
    vi.advanceTimersByTime(2_000)
    await service.refreshSubscription('user-1')
    expect(revenueCat.getSubscriberEntitlement).toHaveBeenCalledTimes(2)
  })

  it('does not start the rate-limit window on a FAILED pull', async () => {
    const ledger = vi
      .fn()
      .mockRejectedValueOnce(new Error('rc blip'))
      .mockResolvedValue(null)
    const { service } = build({ ledger })

    await expect(service.refreshSubscription('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
    // Immediately retryable: a transient outage must not pin the client to
    // local state for the window's duration.
    await service.refreshSubscription('user-1')
    expect(ledger).toHaveBeenCalledTimes(2)
  })

  it('emits activation telemetry after an applying pull, and stays fail-open', async () => {
    const { service, telemetry } = build({})
    await service.refreshSubscription('user-1')

    expect(telemetry.captureEvent).toHaveBeenCalledWith(
      'user-1',
      'premium_entitlement_activated',
      { store: 'stripe', productId: 'premium_monthly' }
    )

    // A throwing telemetry sink must never fail the refresh (5.1 Decision 12).
    telemetry.captureEvent.mockRejectedValue(new Error('posthog down'))
    vi.advanceTimersByTime(11_000)
    await expect(service.refreshSubscription('user-1')).resolves.toMatchObject({
      status: 'none',
    })
  })

  it('shares one in-flight pull between concurrent refreshes', async () => {
    let resolveLedger: (value: null) => void = () => undefined
    const ledger = vi.fn().mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          resolveLedger = resolve
        })
    )
    const { service } = build({ ledger })

    const first = service.refreshSubscription('user-1')
    const second = service.refreshSubscription('user-1')
    resolveLedger(null)
    await Promise.all([first, second])

    expect(ledger).toHaveBeenCalledTimes(1)
  })
})
