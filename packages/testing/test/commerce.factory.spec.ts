// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  createAffiliateClick,
  createAffiliateConversion,
  createAffiliateOffer,
  createCommercePartner,
  createCommercePreference,
  persistAffiliateClick,
  persistAffiliateConversion,
  persistAffiliateOffer,
  persistCommerceCatalog,
  persistCommercePartner,
  persistCommercePreference,
} from '../src/factories/commerce.factory.js'

/**
 * Story 5.1 commerce factories.
 *
 * The defaults in this factory encode migration constraints, so a fixture that
 * drifts fails at the database with an opaque error rather than in an
 * assertion. These cases pin the constraints that are easy to break silently:
 * the `webhook_secret_ref` pattern, the wildcard offer defaults that let a
 * `default-{category}` placeholder slot match at all, and the camelCase to
 * snake_case column mapping every persist function performs.
 *
 * Persistence is asserted against a stubbed Prisma client. These are unit
 * tests of the mapping and the cleanup registration; whether the columns
 * actually exist is the schema suite's job in `packages/db/test`.
 */

type CreateStub = { create: ReturnType<typeof vi.fn> }

function stubPrisma(): {
  prisma: PrismaClient
  commercePartner: CreateStub
  affiliateOffer: CreateStub
  commercePreference: CreateStub
  affiliateClick: CreateStub
  affiliateConversion: CreateStub
} {
  // Each stub echoes back the row Prisma would have returned, keyed on the id
  // the fixture chose, so the registry assertions below are meaningful.
  const make = (): CreateStub => ({
    create: vi.fn(({ data }: { data: { id: string } }) => Promise.resolve(data)),
  })
  const commercePartner = make()
  const affiliateOffer = make()
  const commercePreference = make()
  const affiliateClick = make()
  const affiliateConversion = make()

  return {
    prisma: {
      commercePartner,
      affiliateOffer,
      commercePreference,
      affiliateClick,
      affiliateConversion,
    } as unknown as PrismaClient,
    commercePartner,
    affiliateOffer,
    commercePreference,
    affiliateClick,
    affiliateConversion,
  }
}

describe('commerce factories', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  describe('CommercePartner', () => {
    it('5.1-FACTORY-01 derives a webhook secret ref that satisfies the check constraint', () => {
      const partner = createCommercePartner()

      // ^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$ is enforced by the
      // migration, so a fixture that violates it fails at insert time.
      expect(partner.webhookSecretRef).toMatch(
        /^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$/
      )
      expect(partner.status).toBe('active')
      expect(partner.allowedHost).toBe('partner.couturecast.test')
    })

    it('5.1-FACTORY-02 re-derives the secret ref when only the slug is overridden', () => {
      const partner = createCommercePartner({ slug: 'acme-outfitters' })

      // Carrying the default slug's derived name would be legal but misleading,
      // and would point a webhook test at the wrong environment variable.
      expect(partner.webhookSecretRef).toBe(
        'COMMERCE_PARTNER_ACME_OUTFITTERS_WEBHOOK_SECRET'
      )
    })

    it('5.1-FACTORY-03 keeps an explicit secret ref even when the slug is overridden', () => {
      const partner = createCommercePartner({
        slug: 'acme-outfitters',
        webhookSecretRef: 'COMMERCE_PARTNER_EXPLICIT_WEBHOOK_SECRET',
      })

      expect(partner.webhookSecretRef).toBe('COMMERCE_PARTNER_EXPLICIT_WEBHOOK_SECRET')
    })

    it('5.1-FACTORY-04 normalises a slug whose characters fall outside the constraint', () => {
      const partner = createCommercePartner({ slug: 'partner.with spaces+symbols' })

      expect(partner.webhookSecretRef).toMatch(
        /^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$/
      )
    })

    it('5.1-FACTORY-05 never puts a secret VALUE in the fixture', () => {
      const partner = createCommercePartner()

      // The row stores the NAME of an environment variable. A value here would
      // be a committed secret the moment a test snapshot landed.
      expect(JSON.stringify(partner)).not.toMatch(/secret[-_]?value|password|Bearer /i)
    })

    it('5.1-FACTORY-06 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, commercePartner } = stubPrisma()
      const fixture = createCommercePartner({ id: 'partner-1', slug: 'acme' })

      await persistCommercePartner(prisma, fixture)

      expect(commercePartner.create).toHaveBeenCalledWith({
        data: {
          id: 'partner-1',
          slug: 'acme',
          display_name: 'Test Partner',
          allowed_host: 'partner.couturecast.test',
          status: 'active',
          webhook_secret_ref: 'COMMERCE_PARTNER_ACME_WEBHOOK_SECRET',
        },
      })
      expect(getTrackedEntityIds('commercePartners')).toEqual(['partner-1'])
    })
  })

  describe('AffiliateOffer', () => {
    it('5.1-FACTORY-07 defaults to a wildcard that a placeholder slot can match', () => {
      const offer = createAffiliateOffer()

      // A `default-{category}` slot matches only `comfort_range IS NULL`, and
      // '*' publishes globally. Defaulting to a concrete range would make the
      // common fresh-user case silently return no offer.
      expect(offer.comfortRange).toBeNull()
      expect(offer.localeRegion).toBe('*')
      expect(offer.status).toBe('active')
    })

    it('5.1-FACTORY-08 backdates the window so it is open on the next query', () => {
      const offer = createAffiliateOffer()

      expect(offer.effectiveFrom.getTime()).toBeLessThan(
        Date.parse('2021-01-01T00:00:00Z')
      )
      // Open-ended: null effective_to means the offer never expires.
      expect(offer.effectiveTo).toBeNull()
    })

    it('5.1-FACTORY-09 carries the clickToken placeholder on the partner host', () => {
      const offer = createAffiliateOffer()

      // The click endpoint rejects a template without the placeholder, and
      // rejects a resolved URL off the partner's allowed host.
      expect(offer.deepLinkTemplate).toContain('{clickToken}')
      expect(new URL(offer.deepLinkTemplate).hostname).toBe('partner.couturecast.test')
      expect(new URL(offer.deepLinkTemplate).protocol).toBe('https:')
    })

    it('5.1-FACTORY-10 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, affiliateOffer } = stubPrisma()

      await persistAffiliateOffer(
        prisma,
        createAffiliateOffer({
          id: 'offer-1',
          partnerId: 'partner-1',
          garmentCategory: 'shoes',
          comfortRange: 'cool',
          priority: 30,
        })
      )

      expect(affiliateOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'offer-1',
          partner_id: 'partner-1',
          garment_category: 'shoes',
          comfort_range: 'cool',
          locale_region: '*',
          priority: 30,
          status: 'active',
          effective_to: null,
        }) as unknown,
      })
      expect(getTrackedEntityIds('affiliateOffers')).toEqual(['offer-1'])
    })
  })

  describe('CommercePreference', () => {
    it('5.1-FACTORY-11 defaults to enabled, matching the column default', () => {
      // A missing row reads as enabled, so an explicit fixture and an absent
      // row must be indistinguishable to a caller.
      expect(createCommercePreference().affiliateCtasEnabled).toBe(true)
      expect(
        createCommercePreference({ affiliateCtasEnabled: false }).affiliateCtasEnabled
      ).toBe(false)
    })

    it('5.1-FACTORY-12 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, commercePreference } = stubPrisma()

      await persistCommercePreference(
        prisma,
        createCommercePreference({
          id: 'preference-1',
          userId: 'user-1',
          affiliateCtasEnabled: false,
        })
      )

      expect(commercePreference.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'preference-1',
          user_id: 'user-1',
          affiliate_ctas_enabled: false,
        }) as unknown,
      })
      expect(getTrackedEntityIds('commercePreferences')).toEqual(['preference-1'])
    })
  })

  describe('AffiliateClick', () => {
    it('5.1-FACTORY-13 uses a synthetic token, not a real HMAC', () => {
      const click = createAffiliateClick()

      // A test that cares about the token being a genuine HMAC over the row id
      // must mint it through the service; this default exists so unrelated
      // tests are not forced to.
      expect(click.token).toMatch(/^test-click-token-/)
      expect(click.surface).toBe('mobile_hero')
    })

    it('5.1-FACTORY-14 omits created_at unless the fixture pins it', async () => {
      const { prisma, affiliateClick } = stubPrisma()

      await persistAffiliateClick(prisma, createAffiliateClick({ id: 'click-1' }))

      // Letting the column default apply is what keeps an ordinary test honest
      // about wall-clock ordering.
      const [[call]] = affiliateClick.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ]
      expect(call.data).not.toHaveProperty('created_at')
      expect(getTrackedEntityIds('affiliateClicks')).toEqual(['click-1'])
    })

    it('5.1-FACTORY-15 pins created_at when a dedupe-boundary test needs it', async () => {
      const { prisma, affiliateClick } = stubPrisma()
      const createdAt = new Date('2026-08-11T10:00:00.000Z')

      await persistAffiliateClick(
        prisma,
        createAffiliateClick({ id: 'click-2', createdAt })
      )

      // An explicit created_at is what lets the 60-second dedupe test place two
      // rows either side of the boundary without sleeping.
      const [[call]] = affiliateClick.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ]
      expect(call.data.created_at).toBe(createdAt)
    })
  })

  describe('AffiliateConversion', () => {
    it('5.1-FACTORY-16 defaults to integer minor units and an unmatched click', () => {
      const conversion = createAffiliateConversion()

      expect(Number.isInteger(conversion.orderValueMinorUnits)).toBe(true)
      expect(conversion.currency).toMatch(/^[A-Z]{3}$/)
      // Unmatched by default: an unknown click token is still recorded, which is
      // the case most webhook tests need to reach.
      expect(conversion.affiliateClickId).toBeNull()
    })

    it('5.1-FACTORY-17 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, affiliateConversion } = stubPrisma()

      await persistAffiliateConversion(
        prisma,
        createAffiliateConversion({
          id: 'conversion-1',
          partnerId: 'partner-1',
          affiliateClickId: 'click-1',
          status: 'reversed',
        })
      )

      expect(affiliateConversion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'conversion-1',
          partner_id: 'partner-1',
          affiliate_click_id: 'click-1',
          status: 'reversed',
          order_value_minor_units: 12_900,
          currency: 'USD',
        }) as unknown,
      })
      expect(getTrackedEntityIds('affiliateConversions')).toEqual(['conversion-1'])
    })
  })

  describe('persistCommerceCatalog', () => {
    it('5.1-FACTORY-18 links the offer to the partner it just created', async () => {
      const { prisma, affiliateOffer } = stubPrisma()

      const { partner, offer } = await persistCommerceCatalog(prisma)

      // Building these separately and forgetting to link them is the single
      // most common way a commerce test fails with "no offer matched" for a
      // reason unrelated to what it meant to assert.
      const [[call]] = affiliateOffer.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ]
      expect(call.data.partner_id).toBe(partner.id)
      expect(offer.partner_id).toBe(partner.id)
    })

    it('5.1-FACTORY-19 forces the link even when an override names another partner', async () => {
      const { prisma, affiliateOffer } = stubPrisma()

      const { partner } = await persistCommerceCatalog(prisma, {
        offer: { partnerId: 'some-other-partner', priority: 50 },
      })

      // The override is honoured for everything except the link, which the
      // helper owns; otherwise the helper's whole reason to exist is defeated.
      const [[call]] = affiliateOffer.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ]
      expect(call.data.partner_id).toBe(partner.id)
      expect(call.data.priority).toBe(50)
    })

    it('5.1-FACTORY-20 applies partner overrides and tracks both rows for cleanup', async () => {
      const { prisma } = stubPrisma()

      const { partner } = await persistCommerceCatalog(prisma, {
        partner: { slug: 'acme', status: 'inactive' },
      })

      expect(partner.slug).toBe('acme')
      expect(partner.status).toBe('inactive')
      expect(getTrackedEntityIds('commercePartners')).toHaveLength(1)
      expect(getTrackedEntityIds('affiliateOffers')).toHaveLength(1)
    })
  })
})
