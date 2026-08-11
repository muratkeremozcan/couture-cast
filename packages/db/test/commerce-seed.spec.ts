import { afterAll, describe, expect, it, onTestFinished } from 'vitest'
import { PrismaClient } from '@prisma/client'

import {
  SAMPLE_PARTNER_ALLOWED_HOST,
  SAMPLE_PARTNER_SLUG,
  SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
  allowsCommerceSeeding,
  seedCommerceCatalog,
} from '../prisma/seeds/commerce.js'

/**
 * Story 5.1 decision 14.
 *
 * The commerce seed is the only lever that turns affiliate commerce on outside
 * production: it publishes an active partner, publishes active offers, and (via
 * feature-flags.ts) flips `commerce_affiliate_enabled` to true. That makes its
 * production guard a security property, not a convenience, so it is tested here
 * rather than assumed.
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

afterAll(async () => {
  await prisma.$disconnect()
})

describe('commerce catalog seed', () => {
  it('5.1-DB-030 refuses to seed anything outside a test or local environment', async () => {
    // Registered before the assertions so a failure below cannot leave a live
    // partner behind for a sibling test to trip over.
    onTestFinished(removeSeededCatalog)

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
    onTestFinished(removeSeededCatalog)

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
    onTestFinished(removeSeededCatalog)

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
