import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js'
import { sleep } from 'k6'
import { apiUrl, authHeaders } from '../helpers/config'
import { getJson } from '../helpers/http'

/* --------------------------------------------------------------------------
 * Story 5.2: the premium subscription status read.
 *
 * WHAT THIS MEASURES. `GET /api/v1/commerce/subscription` for the seeded
 * active subscriber (`premium-active-user`, from
 * `packages/db/prisma/seeds/commerce.ts`). The endpoint reads the LOCAL
 * entitlement mirror only: one indexed single-row `PremiumEntitlement` lookup
 * by unique `user_id`, plus the server-side `commerce_subscription_enabled`
 * flag evaluation that produces `purchasesEnabled`. Mobile calls this on every
 * launch to decide whether premium surfaces render, so it sits on the app's
 * warm path and gets its own SLO key (`subscriptionStatus`).
 *
 * WHY `POST /subscription/refresh` IS DELIBERATELY NOT IN k6. Refresh is the
 * client-initiated ledger pull: outside its per-user rate-limit window every
 * call reaches the RevenueCat subscriber API synchronously. A load run
 * hammering it would be load-testing RevenueCat's ledger, not our API, and
 * the service's own contract (see `SubscriptionService`) exists precisely so
 * that no client becomes a ledger hammer. Its latency is bounded by its
 * timeout/503 design and covered by integration specs, not by a throughput
 * harness. Keep refresh out of this file.
 * -------------------------------------------------------------------------- */

type SubscriptionBody = {
  data: {
    status: 'none' | 'active' | 'grace_period' | 'expired' | 'revoked'
    store: string | null
    productId: string | null
    willRenew: boolean | null
    currentPeriodEnd: string | null
    syncedAt: string | null
    purchasesEnabled: boolean
  }
}

export function testSubscriptionStatus() {
  describe('GET /api/v1/commerce/subscription (active subscriber)', () => {
    const { status, body } = getJson<SubscriptionBody>(
      apiUrl('/api/v1/commerce/subscription'),
      {
        headers: authHeaders('premium-active-user', 'guardian'),
        tags: { name: 'api/subscription-status' },
      }
    )
    expect(status, 'status is 200').to.equal(200)

    /*
     * The check that keeps this threshold honest. If the seed has not run, the
     * endpoint answers `status: 'none'` from a no-row read and the P95 below
     * measures a cheaper path than the one subscribers exercise. Asserting the
     * entitled variant makes that a reported failure instead of a silent one.
     */
    if (body?.data?.status !== 'active') {
      console.warn(
        '[premium] subscription status was not "active", so this iteration did NOT ' +
          'measure the entitled read path. Run `npm run db:seed` against the target ' +
          'database: the scenario needs the premium-active-user entitlement fixture ' +
          'and commerce_subscription_enabled resolving true.'
      )
    }
    expect(body?.data?.status, 'seeded subscriber is active').to.equal('active')
    expect(body?.data?.store, 'entitlement store is stripe').to.equal('stripe')
    expect(body?.data?.productId, 'seeded monthly product').to.equal('premium_monthly')
    expect(body?.data?.willRenew, 'seeded entitlement renews').to.equal(true)
    expect(
      body?.data?.purchasesEnabled,
      'purchasesEnabled reflects commerce_subscription_enabled'
    ).to.equal(true)
    expect(
      (body?.data?.currentPeriodEnd ?? '').length,
      'entitled variant carries currentPeriodEnd'
    ).to.be.at.least(1)
    expect(
      (body?.data?.syncedAt ?? '').length,
      'entitled variant carries syncedAt'
    ).to.be.at.least(1)
  })

  sleep(0.2)
}
