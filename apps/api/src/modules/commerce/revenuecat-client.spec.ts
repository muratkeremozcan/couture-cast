import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRevenueCatClient,
  permanentLedgerProjectionFailure,
  RealRevenueCatClient,
  RevenueCatRequestError,
  RevenueCatResponseShapeError,
  RevenueCatUnrepresentableEntitlementError,
  RevenueCatUnsupportedStoreError,
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
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({ entitlements: {}, subscriptions: {} })
    )

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

  // Learning path Step 55: story 6.15 R3-01. An unsupported store never becomes a real one.
  it.each([
    [
      'a RevenueCat Test Store subscription',
      { premium_monthly: { store: 'test_store' } },
    ],
    ['an Amazon subscription', { premium_monthly: { store: 'amazon' } }],
    // An inherited object key is not a store, so it can never pass as one.
    [
      'a store named after an inherited key',
      { premium_monthly: { store: 'constructor' } },
    ],
  ])('refuses %s instead of projecting it as Stripe', async (_label, subscriptions) => {
    // NODE_ENV is `test` here, which must not open the D15 Test Store path; `qa` stands for any
    // TEST_ENV other than local and preview.
    for (const testEnv of [undefined, 'staging', 'production', 'qa']) {
      if (testEnv === undefined) vi.stubEnv('TEST_ENV', undefined as unknown as string)
      else vi.stubEnv('TEST_ENV', testEnv)
      fetchMock.mockResolvedValueOnce(
        subscriberResponse({
          entitlements: {
            premium: {
              expires_date: '2026-09-12T12:00:00.000Z',
              product_identifier: 'premium_monthly',
            },
          },
          subscriptions,
        })
      )
      await expect(client.getSubscriberEntitlement('user-1')).rejects.toBeInstanceOf(
        RevenueCatUnsupportedStoreError
      )
    }
    vi.unstubAllEnvs()
  })

  // Learning path Step 55: story 6.15 D15. Under an explicit local or preview TEST_ENV the REST
  // pull projects a Test Store entitlement as test_store, so refresh and reconciliation converge.
  describe.each(['local', 'preview'])('with TEST_ENV %s', (testEnv) => {
    beforeEach(() => {
      vi.stubEnv('TEST_ENV', testEnv)
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it.each([
      ['active', '2026-09-12T12:00:00.000Z', null, true],
      ['active', '2026-09-12T12:00:00.000Z', '2026-08-11T00:00:00.000Z', false],
      ['expired', '2026-08-01T00:00:00.000Z', null, false],
    ] as const)(
      'projects a Test Store entitlement as %s test_store (expiry %s, unsubscribed %s)',
      async (status, expiresDate, unsubscribedAt, willRenew) => {
        fetchMock.mockResolvedValueOnce(
          subscriberResponse({
            entitlements: {
              premium: {
                expires_date: expiresDate,
                product_identifier: 'premium_monthly',
              },
            },
            subscriptions: {
              premium_monthly: {
                store: 'TEST_STORE',
                unsubscribe_detected_at: unsubscribedAt,
              },
            },
          })
        )

        await expect(client.getSubscriberEntitlement('user-1')).resolves.toEqual({
          status,
          store: 'test_store',
          productId: 'premium_monthly',
          willRenew,
          currentPeriodEnd: new Date(expiresDate),
        })
      }
    )

    it('still refuses every other store we do not sell', async () => {
      for (const subscriptions of [{ premium_monthly: { store: 'amazon' } }]) {
        fetchMock.mockResolvedValueOnce(
          subscriberResponse({
            entitlements: {
              premium: {
                expires_date: '2026-09-12T12:00:00.000Z',
                product_identifier: 'premium_monthly',
              },
            },
            subscriptions,
          })
        )
        await expect(client.getSubscriberEntitlement('user-1')).rejects.toBeInstanceOf(
          RevenueCatUnsupportedStoreError
        )
      }
    })

    it('still refuses a Test Store lifetime entitlement our model cannot represent', async () => {
      fetchMock.mockResolvedValueOnce(
        subscriberResponse({
          entitlements: {
            premium: { expires_date: null, product_identifier: 'premium_life' },
          },
          subscriptions: { premium_life: { store: 'test_store' } },
        })
      )
      await expect(client.getSubscriberEntitlement('user-1')).rejects.toBeInstanceOf(
        RevenueCatUnrepresentableEntitlementError
      )
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

  // Story 6.15 R4-01: a present entitlement that cannot be represented fails the pull rather than
  // reading as absent, which would expire a paying member.
  it.each([
    [
      'a supported lifetime entitlement',
      { expires_date: null, product_identifier: 'premium_life' },
      { premium_life: { store: 'app_store' } },
      RevenueCatUnrepresentableEntitlementError,
    ],
    [
      'a malformed expiry',
      { expires_date: 'soon', product_identifier: 'premium_monthly' },
      { premium_monthly: { store: 'play_store' } },
      RevenueCatUnrepresentableEntitlementError,
    ],
    [
      'a missing product',
      { expires_date: '2026-09-12T12:00:00.000Z', product_identifier: null },
      {},
      RevenueCatUnrepresentableEntitlementError,
    ],
    [
      'a Test Store lifetime entitlement',
      { expires_date: null, product_identifier: 'premium_life' },
      { premium_life: { store: 'test_store' } },
      RevenueCatUnsupportedStoreError,
    ],
    [
      'an Amazon entitlement with a malformed expiry',
      { expires_date: 'soon', product_identifier: 'premium_monthly' },
      { premium_monthly: { store: 'amazon' } },
      RevenueCatUnsupportedStoreError,
    ],
  ])(
    'refuses %s instead of answering no entitlement',
    async (_label, premium, subscriptions, error) => {
      fetchMock.mockResolvedValueOnce(
        subscriberResponse({ entitlements: { premium }, subscriptions })
      )
      await expect(client.getSubscriberEntitlement('user-1')).rejects.toBeInstanceOf(
        error
      )
    }
  )

  // Story 6.15 r38 P3-1: RevenueCat renaming or dropping a key the projection reads is a change
  // in its response, not a fact about the member. Each case would otherwise raise one of the
  // permanent projection errors and settle the row, so each must fail the shape check instead.
  // A renamed key reads as missing; every shape here is a 200.
  it.each([
    [
      'a renamed product_identifier',
      {
        entitlements: { premium: { expires_date: null, product_id: 'premium_life' } },
        subscriptions: {},
      },
      ['subscriber.entitlements.premium.product_identifier: invalid_type'],
    ],
    [
      'a renamed expires_date',
      {
        entitlements: {
          premium: {
            expiry: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: { premium_monthly: { store: 'play_store' } },
      },
      ['subscriber.entitlements.premium.expires_date: invalid_type'],
    ],
    [
      'a renamed subscriptions',
      {
        entitlements: {
          premium: {
            expires_date: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscription_records: { premium_monthly: { store: 'play_store' } },
      },
      ['subscriber.subscriptions: invalid_type'],
    ],
    [
      'a renamed store',
      {
        entitlements: {
          premium: {
            expires_date: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: { premium_monthly: { store_name: 'play_store' } },
      },
      ['subscriber.subscriptions.premium_monthly.store: invalid_type'],
    ],
    ['no subscriber at all', null, ['subscriber: invalid_type']],
  ])('fails the shape check, transiently, on %s', async (_label, subscriber, issues) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(subscriber === null ? {} : { subscriber }), {
        status: 200,
      })
    )

    const caught: unknown = await client
      .getSubscriberEntitlement('user-1')
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(RevenueCatResponseShapeError)
    expect((caught as RevenueCatResponseShapeError).issues).toEqual(issues)
    expect(permanentLedgerProjectionFailure(caught)).toBeNull()
  })

  // Story 6.15 r40 P3: only the premium entitlement and its own purchase record are held to the
  // strict schemas; a sibling this API never reads cannot fail the pull.
  it('projects premium while an unrelated sibling entitlement and subscription are malformed (unrelated_sibling)', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
          beta_perk: { product_identifier: 'beta_perk_sku' },
        },
        subscriptions: {
          premium_monthly: { store: 'play_store', unsubscribe_detected_at: null },
          beta_perk_sku: { store_name: 'app_store' },
        },
      })
    )

    await expect(client.getSubscriberEntitlement('user-1')).resolves.toEqual({
      status: 'active',
      store: 'play_store',
      productId: 'premium_monthly',
      willRenew: true,
      currentPeriodEnd: new Date('2026-09-12T12:00:00.000Z'),
    })
  })

  // A product RC records in neither map means its keys changed: transient, and the member's row
  // is left for the next pull. Under every TEST_ENV, so no Test Store path can change that.
  it.each([undefined, 'staging', 'production', 'qa', 'local', 'preview'])(
    'fails the shape check on a premium product recorded in neither map, TEST_ENV %s (renamed_subscription_key_format)',
    async (testEnv) => {
      if (testEnv === undefined) vi.stubEnv('TEST_ENV', undefined as unknown as string)
      else vi.stubEnv('TEST_ENV', testEnv)
      fetchMock.mockResolvedValueOnce(
        subscriberResponse({
          entitlements: {
            premium: {
              expires_date: '2026-09-12T12:00:00.000Z',
              product_identifier: 'premium_monthly',
            },
          },
          // Keyed by a store transaction id instead of the product id.
          subscriptions: { 'GPA.3312-0000-1111': { store: 'play_store' } },
          non_subscriptions: {},
        })
      )

      const caught = await client
        .getSubscriberEntitlement('user-1')
        .catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(RevenueCatResponseShapeError)
      expect((caught as RevenueCatResponseShapeError).issues).toEqual([
        'subscriber.subscriptions.premium_monthly: missing',
      ])
      expect(permanentLedgerProjectionFailure(caught)).toBeNull()
      vi.unstubAllEnvs()
    }
  )

  it('refuses a premium product found only in non_subscriptions as permanently unrepresentable (lifetime_in_non_subscriptions_only)', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: { expires_date: null, product_identifier: 'premium_lifetime' },
        },
        subscriptions: {},
        non_subscriptions: {
          premium_lifetime: [
            { id: 'np-1', purchase_date: '2026-08-01T00:00:00Z', store: 'app_store' },
          ],
        },
      })
    )

    const caught = await client
      .getSubscriberEntitlement('user-1')
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(RevenueCatUnrepresentableEntitlementError)
    expect(permanentLedgerProjectionFailure(caught)).toEqual({
      reason: 'non_subscription',
    })
  })

  it('holds the premium subscription record to its schema', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: {
          premium: {
            expires_date: '2026-09-12T12:00:00.000Z',
            product_identifier: 'premium_monthly',
          },
        },
        subscriptions: {
          premium_monthly: { store: 'play_store', unsubscribe_detected_at: 7 },
        },
      })
    )

    const caught = await client
      .getSubscriberEntitlement('user-1')
      .catch((error: unknown) => error)

    expect((caught as RevenueCatResponseShapeError).issues).toEqual([
      'subscriber.subscriptions.premium_monthly.unsubscribe_detected_at: invalid_type',
    ])
  })

  it('names the failing paths only, never a response value', async () => {
    fetchMock.mockResolvedValueOnce(
      subscriberResponse({
        entitlements: { premium: { expires_date: 42, product_identifier: 'secret-sku' } },
        subscriptions: {},
        subscriber_attributes: { $email: { value: 'person@example.com' } },
      })
    )

    const caught = (await client
      .getSubscriberEntitlement('user-1')
      .catch((error: unknown) => error)) as Error

    expect(caught).toBeInstanceOf(RevenueCatResponseShapeError)
    expect(caught.message).not.toContain('example.com')
    expect(caught.message).not.toContain('secret-sku')
    expect(caught.message).not.toContain('42')
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

// Story 6.15: refresh and the drift sweep retry a transient ledger failure and settle a permanent
// one, so the classification is pinned for every error the pull can raise.
describe('permanentLedgerProjectionFailure', () => {
  it.each([
    [
      new RevenueCatUnsupportedStoreError('amazon'),
      { reason: 'unsupported_store', store: 'amazon' },
    ],
    [
      new RevenueCatUnsupportedStoreError(null),
      { reason: 'unsupported_store', store: null },
    ],
    [
      new RevenueCatUnrepresentableEntitlementError('missing_product'),
      { reason: 'missing_product' },
    ],
    [new RevenueCatUnrepresentableEntitlementError('no_expiry'), { reason: 'no_expiry' }],
    [
      new RevenueCatUnrepresentableEntitlementError('invalid_expiry'),
      { reason: 'invalid_expiry' },
    ],
  ])('classifies %s as permanent', (error, failure) => {
    expect(permanentLedgerProjectionFailure(error)).toEqual(failure)
  })

  it.each([
    new RevenueCatRequestError(503, 'subscriber GET'),
    new RevenueCatRequestError(429, 'subscriber GET'),
    new Error('RevenueCat ledger pull timed out'),
    new TypeError('fetch failed'),
    new RevenueCatResponseShapeError(['subscriber.subscriptions: invalid_type']),
    'not an error',
  ])('classifies %s as transient', (error) => {
    expect(permanentLedgerProjectionFailure(error)).toBeNull()
  })
})
