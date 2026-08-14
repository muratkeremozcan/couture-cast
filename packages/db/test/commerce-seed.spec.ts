// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

import {
  PREMIUM_SEED_STRIPE_CUSTOMER_ID,
  PREMIUM_SEED_USERS,
  SAMPLE_PARTNER_ALLOWED_HOST,
  SAMPLE_PARTNER_SLUG,
  SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
  allowsCommerceSeeding,
  seedCommerceCatalog,
  seedPremiumEntitlements,
} from '../prisma/seeds/commerce.js'

/**
 * Story 5.1 decision 14.
 *
 * The commerce seed is the only lever that turns affiliate commerce on outside
 * production: it publishes an active partner, publishes active offers, and (via
 * feature-flags.ts) flips `commerce_affiliate_enabled` to true. That makes its
 * production guard a security property, not a convenience, so it is tested here
 * rather than assumed.
 *
 * SHARED STATE. This suite operates on the ONE real seeded row, `sample-partner`,
 * because that row is the subject under test. That row also normally exists,
 * having been written by `db:seed` during `db:reset`, and Playwright and Maestro
 * setup depend on it. So the suite snapshots whether it was present on entry and
 * restores that exact state on exit. An earlier version simply deleted it in
 * cleanup and asserted it was globally absent, which failed on the first run
 * after a reset and passed on the second: it had destroyed the seeded catalog
 * that made its own first run fail.
 */

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

const removeSeededCatalog = async () => {
  const partner = await prisma.commercePartner.findUnique({
    where: { slug: SAMPLE_PARTNER_SLUG },
    select: { id: true },
  })

  if (!partner) {
    return
  }

  await prisma.affiliateOffer.deleteMany({ where: { partner_id: partner.id } })
  await prisma.commercePartner.delete({ where: { id: partner.id } })
}

let seededCatalogExistedOnEntry = false

beforeAll(async () => {
  seededCatalogExistedOnEntry =
    (await prisma.commercePartner.count({ where: { slug: SAMPLE_PARTNER_SLUG } })) > 0
})

// Each test starts from a known-empty catalog rather than from whatever the
// previous test or a prior `db:reset` left behind, so no assertion here depends
// on execution order.
beforeEach(removeSeededCatalog)

afterAll(async () => {
  if (seededCatalogExistedOnEntry) {
    // The seed is idempotent, so re-running it restores the row exactly.
    await seedCommerceCatalog(prisma, { NODE_ENV: 'test' })
  } else {
    await removeSeededCatalog()
  }

  await prisma.$disconnect()
})

describe('commerce catalog seed', () => {
  it('5.1-DB-030 refuses to seed anything outside a test or local environment', async () => {
    const productionEnvironments = [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', TEST_ENV: 'preview' },
      { NODE_ENV: 'development' },
      {},
    ]

    for (const env of productionEnvironments) {
      expect(allowsCommerceSeeding(env)).toBe(false)
      await expect(seedCommerceCatalog(prisma, env)).resolves.toBeNull()
    }

    const partner = await prisma.commercePartner.findUnique({
      where: { slug: SAMPLE_PARTNER_SLUG },
    })
    expect(partner).toBeNull()
  })

  it('5.1-DB-031 recognises both non-production signals', () => {
    expect(allowsCommerceSeeding({ NODE_ENV: 'test' })).toBe(true)
    expect(allowsCommerceSeeding({ TEST_ENV: 'local' })).toBe(true)
    // Whitespace and casing tolerated, matching allowsTestOnlySecrets.
    expect(allowsCommerceSeeding({ TEST_ENV: '  LOCAL  ' })).toBe(true)
    expect(allowsCommerceSeeding({ TEST_ENV: 'localhost' })).toBe(false)
  })

  it('5.1-DB-032 publishes one active partner and wildcard offers for four slots', async () => {
    const result = await seedCommerceCatalog(prisma, { NODE_ENV: 'test' })

    expect(result).not.toBeNull()
    expect(result?.offerIds).toHaveLength(4)

    const partner = await prisma.commercePartner.findUnique({
      where: { slug: SAMPLE_PARTNER_SLUG },
    })

    expect(partner).toMatchObject({
      status: 'active',
      allowed_host: SAMPLE_PARTNER_ALLOWED_HOST,
      webhook_secret_ref: SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
    })

    const offers = await prisma.affiliateOffer.findMany({
      where: { partner_id: result?.partnerId },
      orderBy: { garment_category: 'asc' },
    })

    expect(offers).toHaveLength(4)
    expect(offers.map((offer) => offer.garment_category).sort()).toEqual([
      'bottom',
      'dress',
      'shoes',
      'top',
    ])

    for (const offer of offers) {
      expect(offer.status).toBe('active')
      // Wildcard on both axes: this is what lets a fresh end-to-end user, whose
      // ritual still holds `default-{category}` placeholder slots, match at all.
      expect(offer.comfort_range).toBeNull()
      expect(offer.locale_region).toBe('*')
      expect(offer.effective_to).toBeNull()
      expect(offer.effective_from.getTime()).toBeLessThan(Date.now())
      // Without the placeholder the click endpoint rejects the offer as
      // misconfigured, so a seed that omitted it would publish a dead catalog.
      expect(offer.deep_link_template).toContain('{clickToken}')
      expect(
        offer.deep_link_template.startsWith(`https://${SAMPLE_PARTNER_ALLOWED_HOST}/`)
      ).toBe(true)
    }
  })

  it('5.1-DB-033 is idempotent across repeated runs', async () => {
    const first = await seedCommerceCatalog(prisma, { NODE_ENV: 'test' })
    const second = await seedCommerceCatalog(prisma, { NODE_ENV: 'test' })

    // `db:seed` is invoked standalone as well as after `db:reset`. A seed that
    // duplicated its own catalog on a second run would make offer selection
    // ambiguous and every end-to-end assertion order-dependent.
    expect(second?.partnerId).toBe(first?.partnerId)
    expect(second?.offerIds.sort()).toEqual(first?.offerIds.sort())

    const offerCount = await prisma.affiliateOffer.count({
      where: { partner_id: first?.partnerId },
    })
    expect(offerCount).toBe(4)
  })
})

describe('premium entitlement seed', () => {
  // The seeded ids are deterministic and every write is an upsert or an
  // insert-once, so this suite can run against whatever state `db:reset` left
  // behind without a snapshot/restore dance: re-running the seed IS the
  // restore.
  const seededUserIds = Object.values(PREMIUM_SEED_USERS).map((user) => user.id)

  it('5.2-DB-030 refuses to seed anything outside a test or local environment', async () => {
    // Guard behaviour only — asserting on row absence would be falsified by
    // the standing `db:reset` seed state this suite deliberately preserves.
    for (const env of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', TEST_ENV: 'preview' },
      { NODE_ENV: 'development' },
      {},
    ]) {
      await expect(seedPremiumEntitlements(prisma, env)).resolves.toBeNull()
    }
  })

  it('5.2-DB-031 publishes the three entitlement states the E2E suites need', async () => {
    const result = await seedPremiumEntitlements(prisma, { NODE_ENV: 'test' })

    expect(result?.userIds).toEqual(seededUserIds)

    const entitlements = await prisma.premiumEntitlement.findMany({
      where: { user_id: { in: seededUserIds } },
    })
    const byUser = new Map(entitlements.map((row) => [row.user_id, row]))

    expect(byUser.get(PREMIUM_SEED_USERS.active.id)).toMatchObject({
      status: 'active',
      store: 'stripe',
      product_id: 'premium_monthly',
      will_renew: true,
    })
    expect(byUser.get(PREMIUM_SEED_USERS.expired.id)).toMatchObject({
      status: 'expired',
      store: 'stripe',
      will_renew: false,
    })
    expect(byUser.get(PREMIUM_SEED_USERS.grace.id)).toMatchObject({
      status: 'grace_period',
      store: 'app_store',
      product_id: 'premium_annual',
    })

    // `revoked` is deliberately not seeded; it is constructed per-test.
    expect(entitlements.map((row) => row.status).sort()).toEqual([
      'active',
      'expired',
      'grace_period',
    ])

    // The active web subscriber carries the portal-capable customer mapping
    // and its event pair (checkout completion + RevenueCat activation).
    const customer = await prisma.billingCustomer.findUnique({
      where: { user_id: PREMIUM_SEED_USERS.active.id },
    })
    expect(customer?.stripe_customer_id).toBe(PREMIUM_SEED_STRIPE_CUSTOMER_ID)

    const events = await prisma.billingEvent.findMany({
      where: { user_id: PREMIUM_SEED_USERS.active.id },
    })
    expect(events.map((event) => event.event_type).sort()).toEqual([
      'INITIAL_PURCHASE',
      'checkout.session.completed',
    ])
    // The seeded checkout event's forward obligation is already satisfied, so
    // the reconciliation sweep never re-drives a fixture.
    const checkout = events.find(
      (event) => event.event_type === 'checkout.session.completed'
    )
    expect(checkout?.forward_due).toBe(true)
    expect(checkout?.forwarded_at).not.toBeNull()

    // Adult birthdates: a consent-gated fixture user would 403 before any
    // premium code ran.
    const profiles = await prisma.userProfile.findMany({
      where: { user_id: { in: seededUserIds } },
      select: { birthdate: true },
    })
    expect(profiles).toHaveLength(3)
    for (const profile of profiles) {
      expect(profile.birthdate?.getFullYear()).toBeLessThan(2000)
    }
  })

  it('5.2-DB-032 is idempotent across repeated runs', async () => {
    const first = await seedPremiumEntitlements(prisma, { NODE_ENV: 'test' })
    const second = await seedPremiumEntitlements(prisma, { NODE_ENV: 'test' })

    expect(second?.userIds).toEqual(first?.userIds)

    // One entitlement row per user, and the append-only event pair is inserted
    // once, never duplicated (BillingEvent cannot be upserted past its outbox
    // columns, so the seed must read before writing).
    expect(
      await prisma.premiumEntitlement.count({
        where: { user_id: { in: seededUserIds } },
      })
    ).toBe(3)
    expect(
      await prisma.billingEvent.count({
        where: { user_id: PREMIUM_SEED_USERS.active.id },
      })
    ).toBe(2)
  })
})
