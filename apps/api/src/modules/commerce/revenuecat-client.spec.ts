import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRevenueCatClient,
  RealRevenueCatClient,
  RevenueCatRequestError,
} from './revenuecat-client.js'

/**
 * The real REST client against a stubbed `fetch`: the projection rules that
 * turn RC's subscriber document into our LedgerEntitlementState are the
 * refresh endpoint's and the drift sweep's entire view of ledger truth, so
 * each rule is pinned here. No network anywhere.
 */
describe('RealRevenueCatClient', () => {
  const fetchMock = vi.fn()
  const client = new RealRevenueCatClient('sk_test_rc_key')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function subscriberResponse(subscriber: Record<string, unknown>): Response {
    return new Response(JSON.stringify({ subscriber }), { status: 200 })
  }

  it('sends the Bearer key and the encoded app user id on the subscriber GET', async () => {
    fetchMock.mockResolvedValueOnce(subscriberResponse({}))

    await client.getSubscriberEntitlement('user/with special')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v1/subscribers/user%2Fwith%20special',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_rc_key',
        }) as Record<string, string>,
      })
    )
  })

  it('projects a future-dated premium entitlement as active with the store and renewal state', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: {
          premium_monthly: { store: 'app_store', unsubscribe_detected_at: null },
        },
      })
    )

    await expect(client.getSubscriberEntitlement('user-1')).resolves.toEqual({
      status: 'active',
      store: 'app_store',
      productId: 'premium_monthly',
      willRenew: true,
      currentPeriodEnd: new Date('2026-09-12T12:00:00.000Z'),
    })
  })

  it('projects billing issues on an unexpired entitlement as grace_period', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-08-20T00:00:00.000Z',
            product_identifier: 'premium_annual',
          },
        },
        subscriptions: {
          premium_annual: {
            store: 'play_store',
            billing_issues_detected_at: '2026-08-10T00:00:00.000Z',
          },
        },
      })
    )

    const state = await client.getSubscriberEntitlement('user-1')
    expect(state?.status).toBe('grace_period')
    expect(state?.store).toBe('play_store')
  })

  it('projects a past expiry as expired with willRenew false, keeping the record', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-08-01T00:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: { premium_monthly: { store: 'stripe' } },
      })
    )

    await expect(client.getSubscriberEntitlement('user-1')).resolves.toEqual({
      status: 'expired',
      store: 'stripe',
      productId: 'premium_monthly',
      willRenew: false,
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it('projects a cancelled-but-paid-up subscription as active with willRenew false', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-09-01T00:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: {
          premium_monthly: {
            store: 'stripe',
            unsubscribe_detected_at: '2026-08-05T00:00:00.000Z',
          },
        },
      })
    )

    const state = await client.getSubscriberEntitlement('user-1')
    expect(state).toMatchObject({ status: 'active', willRenew: false })
  })

  it('returns null when the subscriber has no premium entitlement', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({ entitlements: {}, subscriptions: {} })
    )

    await expect(client.getSubscriberEntitlement('user-1')).resolves.toBeNull()
  })

  it('throws a status-bearing error on a failed GET, echoing no response body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":"secret stuff"}', { status: 503 })
    )

    let caught: unknown
    try {
      await client.getSubscriberEntitlement('user-1')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RevenueCatRequestError)
    expect((caught as Error).message).toBe(
      'RevenueCat subscriber GET failed with status 503'
    )
    expect((caught as Error).message).not.toContain('secret stuff')
  })

  it('forwards a Stripe subscription as an X-Platform stripe receipt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await client.forwardStripeSubscription('user-1', 'sub_123')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.revenuecat.com/v1/receipts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Platform': 'stripe' }) as Record<
          string,
          string
        >,
        body: JSON.stringify({ app_user_id: 'user-1', fetch_token: 'sub_123' }),
      })
    )
  })

  it('throws on a failed forward so the outbox records the attempt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }))

    await expect(client.forwardStripeSubscription('user-1', 'sub_123')).rejects.toThrow(
      'receipt forward failed with status 429'
    )
  })

  it('treats DELETE 404 as successfully erased (idempotent erasure)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))

    await expect(client.deleteSubscriber('user-gone')).resolves.toBeUndefined()
  })

  it('throws on a non-404 DELETE failure so erasure is never silently skipped', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))

    await expect(client.deleteSubscriber('user-1')).rejects.toBeInstanceOf(
      RevenueCatRequestError
    )
  })
})

describe('FakeRevenueCatClient forward idempotency (5.2-INT-026 contract)', () => {
  it('re-forwarding the same fetch token does not create a second subscription', async () => {
    const fake = new FakeRevenueCatClient()

    await fake.forwardStripeSubscription('user-1', 'sub_abc')
    const first = await fake.getSubscriberEntitlement('user-1')

    await fake.forwardStripeSubscription('user-1', 'sub_abc')
    const second = await fake.getSubscriberEntitlement('user-1')

    expect(fake.getForwardedSubscription('user-1')).toBe('sub_abc')
    expect(second).toEqual(first)
  })
})
