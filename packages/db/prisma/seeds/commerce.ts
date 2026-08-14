import type { PrismaClient } from '@prisma/client'

/**
 * Story 5.1 decision 14: making the affiliate feature reachable.
 *
 * Three independent gates default to off (the `commerce_affiliate_enabled`
 * feature flag, an empty catalog, and an unset partner secret). Without this
 * seed, AC 1's positive path cannot be demonstrated anywhere and every
 * end-to-end task in the story would be uncloseable.
 *
 * There is no public catalog API and there is not supposed to be one: the
 * catalog is operator-managed, and rows arrive only by seed or migration. So
 * end-to-end setup is "seeded catalog plus public-API user setup", never
 * public-API catalog setup.
 */

/**
 * Mirrors `allowsTestOnlySecrets` in
 * `apps/api/src/config/runtime-environment.ts`. It is duplicated rather than
 * imported because `packages/db` must not reach into `apps/api`; the two are
 * kept identical deliberately, and the commerce schema spec asserts the seed
 * writes nothing when this returns false.
 *
 * Everything in this file is gated on it. The partner host is synthetic, the
 * webhook secret resolves only through the same non-production fallback, and
 * the feature flag row it enables is the single lever that turns commerce on.
 * None of that may ever exist in production.
 */
export function allowsCommerceSeeding(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env.NODE_ENV === 'test' || (env.TEST_ENV ?? '').trim().toLowerCase() === 'local'
}

/** The seeded partner slug. Referenced by end-to-end and integration setup. */
export const SAMPLE_PARTNER_SLUG = 'sample-partner'

/**
 * A reserved-for-testing host, never a real domain. `.test` is reserved by
 * RFC 2606 precisely so it can never resolve on the public internet, which
 * means a leaked seed row cannot send a user anywhere real.
 */
export const SAMPLE_PARTNER_ALLOWED_HOST = 'partner.couturecast.test'

/**
 * The NAME of the environment variable holding the seeded partner's webhook
 * secret, never the secret itself. Matches the
 * `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$` check constraint on
 * `CommercePartner.webhook_secret_ref`.
 */
export const SAMPLE_PARTNER_WEBHOOK_SECRET_REF =
  'COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET'

/**
 * Wildcard offers: `comfort_range: null` matches any slot, and
 * `locale_region: '*'` publishes globally. Both are required for the seeded
 * catalog to match a `default-{category}` placeholder slot, which is what a
 * fresh end-to-end user's ritual actually contains before any real garment is
 * uploaded.
 */
const SAMPLE_OFFERS = [
  { category: 'top', title: 'Everyday Layering Tee', priority: 30 },
  { category: 'bottom', title: 'All-Weather Chino', priority: 20 },
  { category: 'dress', title: 'Transitional Midi Dress', priority: 20 },
  { category: 'shoes', title: 'City Rain Sneaker', priority: 10 },
] as const

export type SeededCommerceCatalog = {
  partnerId: string
  offerIds: string[]
}

export async function seedCommerceCatalog(
  prisma: PrismaClient,
  env: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<SeededCommerceCatalog | null> {
  if (!allowsCommerceSeeding(env)) {
    return null
  }

  const partner = await prisma.commercePartner.upsert({
    where: { slug: SAMPLE_PARTNER_SLUG },
    update: {
      display_name: 'Sample Partner',
      allowed_host: SAMPLE_PARTNER_ALLOWED_HOST,
      status: 'active',
      webhook_secret_ref: SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
    },
    create: {
      slug: SAMPLE_PARTNER_SLUG,
      display_name: 'Sample Partner',
      allowed_host: SAMPLE_PARTNER_ALLOWED_HOST,
      status: 'active',
      webhook_secret_ref: SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
    },
  })

  // `effective_from` is backdated so the window is already open the instant the
  // seed finishes, and `effective_to` stays null (open-ended). A seed that
  // opened its window at `now()` would race the very next request.
  const effectiveFrom = new Date('2020-01-01T00:00:00.000Z')

  const offerIds: string[] = []

  for (const offer of SAMPLE_OFFERS) {
    // AffiliateOffer has no natural unique key, so the seed reads before it
    // writes rather than upserting. `db:seed` runs after `db:reset` in this
    // repo but is also invoked standalone, and a seed that duplicated its own
    // catalog on a second run would make offer selection ambiguous and every
    // end-to-end assertion order-dependent.
    const existing = await prisma.affiliateOffer.findFirst({
      where: {
        partner_id: partner.id,
        garment_category: offer.category,
        comfort_range: null,
        locale_region: '*',
      },
      select: { id: true },
    })

    if (existing) {
      const updated = await prisma.affiliateOffer.update({
        where: { id: existing.id },
        data: {
          title: offer.title,
          deep_link_template: buildSampleDeepLinkTemplate(offer.category),
          priority: offer.priority,
          status: 'active',
          effective_from: effectiveFrom,
          effective_to: null,
        },
        select: { id: true },
      })
      offerIds.push(updated.id)
      continue
    }

    const created = await prisma.affiliateOffer.create({
      data: {
        partner_id: partner.id,
        garment_category: offer.category,
        comfort_range: null,
        locale_region: '*',
        title: offer.title,
        deep_link_template: buildSampleDeepLinkTemplate(offer.category),
        priority: offer.priority,
        status: 'active',
        effective_from: effectiveFrom,
        effective_to: null,
      },
      select: { id: true },
    })
    offerIds.push(created.id)
  }

  return { partnerId: partner.id, offerIds }
}

/**
 * The literal `{clickToken}` placeholder is mandatory: the click endpoint
 * rejects a template without it as operator misconfiguration rather than
 * redirecting to a URL that carries no attribution.
 */
function buildSampleDeepLinkTemplate(category: string): string {
  return `https://${SAMPLE_PARTNER_ALLOWED_HOST}/shop/${category}?cc={clickToken}`
}

/**
 * Story 5.2 decision 9: making the premium subscription state space reachable.
 *
 * PremiumEntitlement is worker-only (no public write path, by design — a
 * client-writable entitlement row is free Premium), so end-to-end suites cannot
 * arrange entitlement state through the public API the way the commerce specs
 * arrange preferences. These deterministic users are how Playwright and Maestro
 * reach the entitled, expired, and grace-period branches.
 *
 * The users are adults on purpose: a teen account is consent-gated by
 * `RequestAuthGuard` before any commerce code runs, and age is not what a
 * premium spec is exercising. `revoked` is deliberately NOT seeded — it is
 * constructed per-test via the factory.
 */
export const PREMIUM_SEED_USERS = {
  /** Active stripe monthly subscriber, with BillingCustomer + event pair. */
  active: { id: 'premium-active-user', email: 'premium-active@example.com' },
  /** Lapsed stripe subscriber: subscribe CTA plus "your subscription ended". */
  expired: { id: 'premium-expired-user', email: 'premium-expired@example.com' },
  /** App Store annual in billing grace: exercises the store-managed manage
   *  hint and the payment-issue banner. */
  grace: { id: 'premium-grace-user', email: 'premium-grace@example.com' },
} as const

/** Referenced by the E2E suites and the seeded BillingCustomer row. */
export const PREMIUM_SEED_STRIPE_CUSTOMER_ID = 'cus_seed_premium_active'

type PremiumSeedEntitlement = {
  user: { id: string; email: string }
  status: 'active' | 'expired' | 'grace_period'
  store: 'stripe' | 'app_store'
  productId: 'premium_monthly' | 'premium_annual'
  willRenew: boolean
  currentPeriodEnd: Date
}

/**
 * Fixed instants, far from the suite's runtime clock, so assertions about
 * period boundaries never race the wall clock. The active/grace period ends are
 * far-future; the expired one is safely past.
 */
const PREMIUM_SEED_ENTITLEMENTS: PremiumSeedEntitlement[] = [
  {
    user: PREMIUM_SEED_USERS.active,
    status: 'active',
    store: 'stripe',
    productId: 'premium_monthly',
    willRenew: true,
    currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
  },
  {
    user: PREMIUM_SEED_USERS.expired,
    status: 'expired',
    store: 'stripe',
    productId: 'premium_monthly',
    willRenew: false,
    currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
  },
  {
    user: PREMIUM_SEED_USERS.grace,
    status: 'grace_period',
    store: 'app_store',
    productId: 'premium_annual',
    willRenew: true,
    currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
  },
]

const PREMIUM_SEED_SYNCED_AT = new Date('2026-08-01T00:00:00.000Z')

export type SeededPremiumEntitlements = {
  userIds: string[]
}

export async function seedPremiumEntitlements(
  prisma: PrismaClient,
  env: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<SeededPremiumEntitlements | null> {
  if (!allowsCommerceSeeding(env)) {
    return null
  }

  for (const seed of PREMIUM_SEED_ENTITLEMENTS) {
    await prisma.user.upsert({
      where: { id: seed.user.id },
      update: { email: seed.user.email },
      create: { id: seed.user.id, email: seed.user.email },
    })

    // An adult birthdate so RequestAuthGuard never consent-gates the account.
    await prisma.userProfile.upsert({
      where: { user_id: seed.user.id },
      update: { birthdate: new Date('1990-01-01T00:00:00.000Z') },
      create: {
        user_id: seed.user.id,
        display_name: `Premium ${seed.status} fixture`,
        birthdate: new Date('1990-01-01T00:00:00.000Z'),
      },
    })

    await prisma.premiumEntitlement.upsert({
      where: { user_id: seed.user.id },
      update: {
        status: seed.status,
        store: seed.store,
        product_id: seed.productId,
        will_renew: seed.willRenew,
        current_period_end: seed.currentPeriodEnd,
        synced_at: PREMIUM_SEED_SYNCED_AT,
        last_event_occurred_at: PREMIUM_SEED_SYNCED_AT,
        last_event_id: `seed-premium-${seed.status}`,
      },
      create: {
        user_id: seed.user.id,
        status: seed.status,
        store: seed.store,
        product_id: seed.productId,
        will_renew: seed.willRenew,
        current_period_end: seed.currentPeriodEnd,
        synced_at: PREMIUM_SEED_SYNCED_AT,
        last_event_occurred_at: PREMIUM_SEED_SYNCED_AT,
        last_event_id: `seed-premium-${seed.status}`,
      },
    })
  }

  // The active web subscriber also carries the Stripe customer mapping (so the
  // portal-session path is reachable) and its BillingEvent pair: the Stripe
  // checkout completion (forward obligation already satisfied) and the
  // RevenueCat activation that the entitlement row mirrors.
  await prisma.billingCustomer.upsert({
    where: { user_id: PREMIUM_SEED_USERS.active.id },
    update: { stripe_customer_id: PREMIUM_SEED_STRIPE_CUSTOMER_ID },
    create: {
      user_id: PREMIUM_SEED_USERS.active.id,
      stripe_customer_id: PREMIUM_SEED_STRIPE_CUSTOMER_ID,
    },
  })

  const seededEvents = [
    {
      provider: 'stripe' as const,
      externalEventId: 'seed-premium-checkout-completed',
      eventType: 'checkout.session.completed',
      forwardDue: true,
      forwardedAt: PREMIUM_SEED_SYNCED_AT,
    },
    {
      provider: 'revenuecat' as const,
      externalEventId: 'seed-premium-initial-purchase',
      eventType: 'INITIAL_PURCHASE',
      forwardDue: false,
      forwardedAt: null,
    },
  ]

  for (const event of seededEvents) {
    const existing = await prisma.billingEvent.findUnique({
      where: {
        provider_external_event_id: {
          provider: event.provider,
          external_event_id: event.externalEventId,
        },
      },
      select: { id: true },
    })

    // BillingEvent is append-only past its outbox columns, so the seed inserts
    // once and leaves the row alone on later runs rather than upserting.
    if (existing) {
      continue
    }

    await prisma.billingEvent.create({
      data: {
        provider: event.provider,
        external_event_id: event.externalEventId,
        event_type: event.eventType,
        user_id: PREMIUM_SEED_USERS.active.id,
        store: 'stripe',
        product_id: 'premium_monthly',
        payload: {
          eventType: event.eventType,
          store: 'stripe',
          productId: 'premium_monthly',
          periodType: null,
          purchasedAtMs: PREMIUM_SEED_SYNCED_AT.getTime(),
          expirationAtMs: new Date('2030-01-01T00:00:00.000Z').getTime(),
          cancelReason: null,
          environment: 'sandbox',
        },
        occurred_at: PREMIUM_SEED_SYNCED_AT,
        forward_due: event.forwardDue,
        forwarded_at: event.forwardedAt,
      },
    })
  }

  return {
    userIds: PREMIUM_SEED_ENTITLEMENTS.map((entitlement) => entitlement.user.id),
  }
}
