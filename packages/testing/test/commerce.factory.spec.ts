import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'

/**
 * Story 5.1 commerce fixtures.
 *
 * These factories encode real database constraints, and a fixture that violates
 * one fails at the database rather than in an assertion, which is a slow and
 * confusing way to find out. So the assertions here are mostly about those
 * constraints holding by construction:
 *
 *   * `webhookSecretRef` must match `^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$`
 *   * `deepLinkTemplate` must contain the literal `{clickToken}` and sit on the
 *     partner's `allowedHost`
 *   * hosts stay under `.test`, reserved by RFC 2606 so they can never resolve
 *   * money is integer minor units
 */

const SECRET_REF_PATTERN = /^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$/

/**
 * Each factory persists through exactly one delegate, so the stub models only
 * the delegate under test and is cast to the client type the factory expects.
 */
function createDelegateStub(row: { id: string }) {
  // Not generic: `mockResolvedValue` takes `Awaited<T>`, and a bare
  // `T extends { id: string }` is not provably non-thenable, so the generic
  // version failed to typecheck even though every caller passes a plain row.
  const create =
    vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>()
  create.mockResolvedValue(row)
  return create
}

function prismaWith(delegates: Record<string, unknown>): PrismaClient {
  return delegates as unknown as PrismaClient
}

afterEach(() => {
  resetTrackedEntities()
  vi.restoreAllMocks()
})

describe('commerce partner factory', () => {
  it('builds an active partner whose secret ref is derived from its slug', () => {
    const partner = createCommercePartner()

    // Active by default on purpose: an inactive partner makes every offer
    // unreachable, and a fixture whose default is invisible costs a debugging
    // session per use.
    expect(partner.status).toBe('active')
    expect(partner.slug).toMatch(/^test-partner-[a-z0-9]{8}$/)
    expect(partner.webhookSecretRef).toMatch(SECRET_REF_PATTERN)
    expect(partner.allowedHost).toBe('partner.couturecast.test')
    expect(partner.allowedHost.endsWith('.test')).toBe(true)
  })

  it('re-derives the secret ref when the slug is overridden but the ref is not', () => {
    const partner = createCommercePartner({ slug: 'acme-outfitters' })

    expect(partner.webhookSecretRef).toBe(
      'COMMERCE_PARTNER_ACME_OUTFITTERS_WEBHOOK_SECRET'
    )
    expect(partner.webhookSecretRef).toMatch(SECRET_REF_PATTERN)
  })

  it('keeps an explicitly supplied secret ref alongside an overridden slug', () => {
    const partner = createCommercePartner({
      slug: 'acme-outfitters',
      webhookSecretRef: 'COMMERCE_PARTNER_CUSTOM_WEBHOOK_SECRET',
    })

    expect(partner.webhookSecretRef).toBe('COMMERCE_PARTNER_CUSTOM_WEBHOOK_SECRET')
  })

  it('normalizes punctuation and truncates a long slug to the allowed 40 characters', () => {
    const partner = createCommercePartner({ slug: `${'a'.repeat(60)}.co/uk` })

    expect(partner.webhookSecretRef).toMatch(SECRET_REF_PATTERN)
    const middle = partner.webhookSecretRef.replace(
      /^COMMERCE_PARTNER_|_WEBHOOK_SECRET$/g,
      ''
    )
    expect(middle.length).toBeLessThanOrEqual(40)
  })

  it('falls back to a placeholder when a slug normalizes to nothing', () => {
    // The `|| 'FIXTURE'` guard exists so the derived name can never collapse to
    // `COMMERCE_PARTNER__WEBHOOK_SECRET`, which the check constraint rejects.
    const partner = createCommercePartner({ slug: '' })

    expect(partner.webhookSecretRef).toBe('COMMERCE_PARTNER_FIXTURE_WEBHOOK_SECRET')
    expect(partner.webhookSecretRef).toMatch(SECRET_REF_PATTERN)
  })

  it('persists a partner and registers it for cleanup', async () => {
    const create = createDelegateStub({ id: 'partner-1' })
    const fixture = createCommercePartner({ slug: 'acme', status: 'inactive' })

    const persisted = await persistCommercePartner(
      prismaWith({ commercePartner: { create } }),
      fixture
    )

    expect(persisted.id).toBe('partner-1')
    expect(create).toHaveBeenCalledWith({
      data: {
        id: fixture.id,
        slug: 'acme',
        display_name: fixture.displayName,
        allowed_host: fixture.allowedHost,
        status: 'inactive',
        webhook_secret_ref: fixture.webhookSecretRef,
      },
    })
    expect(getTrackedEntityIds('commercePartners')).toEqual(['partner-1'])
  })
})

describe('affiliate offer factory', () => {
  it('defaults to a globally published wildcard offer with an open window', () => {
    const offer = createAffiliateOffer()

    // Null comfort range is the wildcard a `default-{category}` placeholder slot
    // matches, which is the common fresh-user case.
    expect(offer.comfortRange).toBeNull()
    expect(offer.localeRegion).toBe('*')
    expect(offer.status).toBe('active')
    expect(offer.garmentCategory).toBe('top')
    expect(offer.effectiveTo).toBeNull()
    // Backdated so the window is open the instant the row lands; an
    // `effectiveFrom` of now() races the very next query.
    expect(offer.effectiveFrom.getTime()).toBeLessThan(Date.now())
    expect(offer.deepLinkTemplate).toContain('{clickToken}')
    expect(offer.deepLinkTemplate).toContain('partner.couturecast.test')
  })

  it('accepts overrides for every selection-relevant column', () => {
    const effectiveTo = new Date('2027-01-01T00:00:00.000Z')
    const offer = createAffiliateOffer({
      garmentCategory: 'shoes',
      comfortRange: 'cold',
      localeRegion: 'US',
      priority: 42,
      status: 'inactive',
      effectiveTo,
    })

    expect(offer.garmentCategory).toBe('shoes')
    expect(offer.comfortRange).toBe('cold')
    expect(offer.localeRegion).toBe('US')
    expect(offer.priority).toBe(42)
    expect(offer.status).toBe('inactive')
    expect(offer.effectiveTo).toBe(effectiveTo)
  })

  it('persists an offer and registers it for cleanup', async () => {
    const create = createDelegateStub({ id: 'offer-1' })
    const fixture = createAffiliateOffer({ partnerId: 'partner-1', priority: 7 })

    const persisted = await persistAffiliateOffer(
      prismaWith({ affiliateOffer: { create } }),
      fixture
    )

    expect(persisted.id).toBe('offer-1')
    expect(create).toHaveBeenCalledWith({
      data: {
        id: fixture.id,
        partner_id: 'partner-1',
        garment_category: 'top',
        comfort_range: null,
        locale_region: '*',
        title: fixture.title,
        deep_link_template: fixture.deepLinkTemplate,
        priority: 7,
        status: 'active',
        effective_from: fixture.effectiveFrom,
        effective_to: null,
      },
    })
    expect(getTrackedEntityIds('affiliateOffers')).toEqual(['offer-1'])
  })
})

describe('commerce preference factory', () => {
  it('defaults to enabled so a fixture and an absent row behave identically', () => {
    expect(createCommercePreference().affiliateCtasEnabled).toBe(true)
  })

  it('persists an opted-out preference and registers it for cleanup', async () => {
    const create = createDelegateStub({ id: 'preference-1' })
    const fixture = createCommercePreference({
      userId: 'user-1',
      affiliateCtasEnabled: false,
    })

    await persistCommercePreference(
      prismaWith({ commercePreference: { create } }),
      fixture
    )

    expect(create).toHaveBeenCalledWith({
      data: {
        id: fixture.id,
        user_id: 'user-1',
        affiliate_ctas_enabled: false,
      },
    })
    expect(getTrackedEntityIds('commercePreferences')).toEqual(['preference-1'])
  })
})

describe('affiliate click factory', () => {
  it('builds a synthetic token rather than a real HMAC', () => {
    const click = createAffiliateClick()

    // Stated in the factory and worth pinning: a test that cares about the token
    // being a genuine HMAC over the row id must mint it through the service.
    expect(click.token).toMatch(/^test-click-token-[A-Za-z0-9]{24}$/)
    expect(click.scenario).toBe('morning')
    expect(click.surface).toBe('mobile_hero')
    expect(click.localeRegion).toBe('US')
    expect(click.createdAt).toBeUndefined()
  })

  it('omits created_at when the fixture leaves it unset', async () => {
    const create = createDelegateStub({ id: 'click-1' })
    const fixture = createAffiliateClick({ userId: 'user-1', offerId: 'offer-1' })

    await persistAffiliateClick(prismaWith({ affiliateClick: { create } }), fixture)

    const data = create.mock.calls[0]?.[0].data
    expect(data).not.toHaveProperty('created_at')
    expect(data).toMatchObject({ user_id: 'user-1', offer_id: 'offer-1' })
    expect(getTrackedEntityIds('affiliateClicks')).toEqual(['click-1'])
  })

  it('passes an explicit created_at through, which is what makes the dedupe boundary testable without sleeping', async () => {
    const create = createDelegateStub({ id: 'click-2' })
    const createdAt = new Date('2026-08-11T10:00:00.000Z')

    await persistAffiliateClick(
      prismaWith({ affiliateClick: { create } }),
      createAffiliateClick({ createdAt })
    )

    expect(create.mock.calls[0]?.[0].data).toMatchObject({ created_at: createdAt })
  })
})

describe('affiliate conversion factory', () => {
  it('defaults to an unattributed confirmed conversion in integer minor units', () => {
    const conversion = createAffiliateConversion()

    expect(conversion.affiliateClickId).toBeNull()
    expect(conversion.status).toBe('confirmed')
    expect(conversion.currency).toBe('USD')
    expect(Number.isInteger(conversion.orderValueMinorUnits)).toBe(true)
    expect(conversion.externalEventId).toMatch(/^evt-[A-Za-z0-9]{16}$/)
  })

  it('persists a matched conversion and registers it for cleanup', async () => {
    const create = createDelegateStub({ id: 'conversion-1' })
    const fixture = createAffiliateConversion({
      partnerId: 'partner-1',
      affiliateClickId: 'click-1',
      status: 'reversed',
      orderValueMinorUnits: 0,
    })

    await persistAffiliateConversion(
      prismaWith({ affiliateConversion: { create } }),
      fixture
    )

    expect(create).toHaveBeenCalledWith({
      data: {
        id: fixture.id,
        partner_id: 'partner-1',
        external_event_id: fixture.externalEventId,
        affiliate_click_id: 'click-1',
        status: 'reversed',
        order_value_minor_units: 0,
        currency: 'USD',
        occurred_at: fixture.occurredAt,
      },
    })
    expect(getTrackedEntityIds('affiliateConversions')).toEqual(['conversion-1'])
  })
})

describe('persistCommerceCatalog', () => {
  it('links the offer to the partner it just created', async () => {
    // The whole reason this helper exists: building the two separately and
    // forgetting to link them is the most common way a commerce test fails with
    // "no offer matched" for a reason unrelated to what it meant to assert.
    const partnerCreate = createDelegateStub({ id: 'partner-9' })
    const offerCreate = createDelegateStub({ id: 'offer-9' })

    const catalog = await persistCommerceCatalog(
      prismaWith({
        commercePartner: { create: partnerCreate },
        affiliateOffer: { create: offerCreate },
      })
    )

    expect(catalog.partner.id).toBe('partner-9')
    expect(catalog.offer.id).toBe('offer-9')
    expect(offerCreate.mock.calls[0]?.[0].data).toMatchObject({
      partner_id: 'partner-9',
    })
    expect(getTrackedEntityIds('commercePartners')).toEqual(['partner-9'])
    expect(getTrackedEntityIds('affiliateOffers')).toEqual(['offer-9'])
  })

  it('applies partner and offer overrides while still linking them', async () => {
    const partnerCreate = createDelegateStub({ id: 'partner-10' })
    const offerCreate = createDelegateStub({ id: 'offer-10' })

    await persistCommerceCatalog(
      prismaWith({
        commercePartner: { create: partnerCreate },
        affiliateOffer: { create: offerCreate },
      }),
      {
        partner: { slug: 'scoped-partner', status: 'inactive' },
        offer: { localeRegion: 'ZZ9', garmentCategory: 'dress' },
      }
    )

    expect(partnerCreate.mock.calls[0]?.[0].data).toMatchObject({
      slug: 'scoped-partner',
      status: 'inactive',
      webhook_secret_ref: 'COMMERCE_PARTNER_SCOPED_PARTNER_WEBHOOK_SECRET',
    })
    expect(offerCreate.mock.calls[0]?.[0].data).toMatchObject({
      locale_region: 'ZZ9',
      garment_category: 'dress',
      // The caller's partnerId override must lose to the real linkage.
      partner_id: 'partner-10',
    })
  })

  it('ignores a caller-supplied offer partnerId so the linkage cannot be broken', async () => {
    const partnerCreate = createDelegateStub({ id: 'partner-11' })
    const offerCreate = createDelegateStub({ id: 'offer-11' })

    await persistCommerceCatalog(
      prismaWith({
        commercePartner: { create: partnerCreate },
        affiliateOffer: { create: offerCreate },
      }),
      { offer: { partnerId: 'some-other-partner' } }
    )

    expect(offerCreate.mock.calls[0]?.[0].data).toMatchObject({
      partner_id: 'partner-11',
    })
  })
})
