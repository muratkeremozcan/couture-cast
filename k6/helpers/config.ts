export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '')

export const TEST_ENV = __ENV.TEST_ENV || __ENV.ENVIRONMENT || 'local'

export const infraDelay = Number.parseInt(__ENV.INFRA_DELAY || '0', 10)

const isSmoke = __ENV.K6_RUN_MODE === 'smoke'

export const SLO = isSmoke
  ? {
      aggregate: 5000,
      health: 2000,
      eventsPoll: 3000,
      queueHealth: 3000,
      signup: 5000,
      guardianInvite: 5000,
      guardianAccept: 5000,
      guardianRevoke: 5000,
      userProfile: 3000,
      moderationAction: 3000,
      // Story 4.3 capsule capacity contract, relaxed for smoke runs.
      capsuleRead: 3000,
      capsuleWrite: 5000,
      capsuleRitualCold: 5000,
      // Story 5.1 affiliate eligibility, relaxed for smoke runs.
      ritualEligible: 3000,
      // Story 5.2 subscription status read, relaxed for smoke runs.
      subscriptionStatus: 3000,
    }
  : {
      aggregate: 1500,
      health: 400,
      eventsPoll: 800,
      queueHealth: 800,
      signup: 1200,
      guardianInvite: 1500,
      guardianAccept: 1800,
      guardianRevoke: 1500,
      userProfile: 800,
      moderationAction: 800,
      /**
       * Story 4.3: list, detail, and filtered search at or below 300ms P95;
       * create, PATCH, favorite, and delete at or below 500ms; cold ritual
       * generation with capsule evaluation at or below 800ms.
       */
      capsuleRead: 300,
      capsuleWrite: 500,
      capsuleRitualCold: 800,
      /**
       * Story 5.1: a warm `GET /api/v1/ritual` for a user who IS affiliate
       * eligible, so the full decision-4 chain runs -- a feature-flag read, a
       * commerce preference read, a batched garment query, and the offer
       * selection query -- on top of the cached ritual payload.
       *
       * ABSOLUTE, NOT RELATIVE, and that is deliberate. An earlier draft of the
       * story budgeted "adds no more than 50 ms" over a baseline. This harness
       * has no baseline-diff facility: `handleSummary` writes one run's summary
       * and nothing compares two runs, so a relative budget would have been a
       * threshold nobody could ever evaluate, which is worse than no threshold
       * because it reads as a guarantee.
       *
       * 300 ms, chosen the same way `capsuleRead` was and for the same reason:
       * this is an indexed read path with no generation work in it, and 300 ms
       * is the number this repo already commits to for that shape. Four extra
       * round trips against a warm cache cannot approach it unless the offer
       * lookup has stopped using its index, which
       * `commerce-affiliate-offers-query-plan.integration.spec.ts` asserts
       * directly against a 4,000-row catalog.
       *
       * Observed at **37.2 ms** in the `k6 smoke` CI run recorded in the Story 5.1
       * release QA artifact, against a real API and the seeded catalog, with the
       * eligibility assertion passing so the measurement is of the eligible path
       * rather than a ritual read that skipped offer selection. That is one sample
       * at one VU, not a distribution, and smoke mode enforces the 3000 ms branch
       * above rather than this one. So treat 300 ms as a bound with roughly 8x
       * observed headroom, not as a tuned figure; tighten it once a load-profile
       * run exists.
       *
       * Cold generation on the eligible path is NOT this key's job. It is
       * already bounded by `capsuleRitualCold`, and folding generation in here
       * would let a slow generator mask a regression in the commerce chain,
       * which is the only thing this story added to the hot path.
       */
      ritualEligible: 300,
      /**
       * Story 5.2: `GET /api/v1/commerce/subscription` for the seeded active
       * subscriber, i.e. the status read mobile performs on every launch to
       * decide whether premium surfaces render. The route reads the LOCAL
       * entitlement mirror only: one indexed single-row `PremiumEntitlement`
       * lookup by unique `user_id` plus the `commerce_subscription_enabled`
       * flag evaluation, run in parallel — no ledger call, no generation work.
       *
       * ABSOLUTE, NOT RELATIVE, for the same reason as `ritualEligible`: this
       * harness has no baseline-diff facility (`handleSummary` writes one
       * run's summary and nothing compares two runs), so a relative budget
       * would be a threshold nobody could ever evaluate.
       *
       * 300 ms, chosen the same way `capsuleRead` and `ritualEligible` were:
       * this is an indexed read path on a warm API, and 300 ms is the number
       * this repo already commits to for that shape. For this bound to breach,
       * either the unique-index lookup on `PremiumEntitlement.user_id` would
       * have to stop being an index hit, or the feature-flag read would have
       * to start blocking — both regressions this threshold exists to name.
       *
       * No observed figure yet: the first measurement comes from the Story 5.2
       * verification smoke run and will be recorded in the story evidence.
       * Until then treat 300 ms as the committed bound for this read shape,
       * not a tuned figure; tighten it once a load-profile run exists.
       *
       * `POST /subscription/refresh` deliberately has NO SLO key and NO
       * scenario: it pulls the RevenueCat ledger per call outside its
       * rate-limit window, and a load run must not become a ledger hammer.
       * See k6/scenarios/premium.scenarios.ts for the full rationale.
       */
      subscriptionStatus: 300,
    }

export function apiUrl(path: string) {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function authHeaders(userId: string, role: string) {
  return {
    Authorization: `Bearer k6-${role}-${userId}`,
    'x-user-id': userId,
    'x-user-role': role,
  }
}

export function uniqueEmail(prefix: string) {
  const suffix = `${Date.now()}-${__VU}-${__ITER}-${Math.random()
    .toString(36)
    .slice(2, 8)}`

  return `${prefix}+${suffix}@k6.couturecast.test`
}
