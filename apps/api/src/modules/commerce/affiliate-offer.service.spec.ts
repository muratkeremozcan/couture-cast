// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AffiliateOfferService,
  GLOBAL_LOCALE_REGION,
  isAffiliateAudienceEligible,
  resolveLocaleRegion,
  type AffiliateOutfitSlot,
} from './affiliate-offer.service.js'
import type { CommerceOfferMatch, CommerceRepository } from './commerce.repository.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'

const OFFER: CommerceOfferMatch = {
  offer_id: 'offer-1',
  offer_title: 'Merino base layer',
  garment_category: 'top',
  partner_slug: 'sample-partner',
  partner_display_name: 'Sample Partner',
}

function outfit(overrides: Partial<AffiliateOutfitSlot> = {}): AffiliateOutfitSlot {
  return {
    id: 'outfit-morning',
    scenario: 'morning',
    garmentIds: ['default-top'],
    ...overrides,
  }
}

describe('AffiliateOfferService', () => {
  const featureFlags = { getFeatureFlag: vi.fn() }
  const repository = {
    findAffiliateCtasEnabled: vi.fn(),
    findUserCommerceContext: vi.fn(),
    findGarmentSlots: vi.fn(),
    findBestOffer: vi.fn(),
  }

  let service: AffiliateOfferService

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    repository.findAffiliateCtasEnabled.mockReset().mockResolvedValue(null)
    repository.findUserCommerceContext
      .mockReset()
      .mockResolvedValue({ birthdate: null, locale: undefined })
    repository.findGarmentSlots.mockReset().mockResolvedValue([])
    repository.findBestOffer.mockReset().mockResolvedValue(OFFER)

    service = new AffiliateOfferService(
      featureFlags as unknown as FeatureFlagsService,
      repository as unknown as CommerceRepository
    )
  })

  describe('decision 4 short-circuit order', () => {
    it('returns null for every outfit and reads nothing when the flag is off', async () => {
      featureFlags.getFeatureFlag.mockResolvedValue(false)

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ id: 'a' }), outfit({ id: 'b' })],
      })

      expect([...resolved.values()]).toEqual([null, null])
      expect(repository.findAffiliateCtasEnabled).not.toHaveBeenCalled()
      expect(repository.findBestOffer).not.toHaveBeenCalled()
    })

    it('stops at the stored preference when the user has opted out', async () => {
      repository.findAffiliateCtasEnabled.mockResolvedValue(false)

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
      expect(repository.findBestOffer).not.toHaveBeenCalled()
    })

    it('treats a missing preference row as enabled', async () => {
      repository.findAffiliateCtasEnabled.mockResolvedValue(null)

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(resolved.get('outfit-morning')).toEqual({
        partnerId: 'sample-partner',
        partnerDisplayName: 'Sample Partner',
        offerId: 'offer-1',
        offerTitle: 'Merino base layer',
        garmentCategory: 'top',
      })
    })

    it('resolves an offer when the preference row explicitly enables CTAs', async () => {
      repository.findAffiliateCtasEnabled.mockResolvedValue(true)

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(resolved.get('outfit-morning')?.offerId).toBe('offer-1')
    })
  })

  describe('slot derivation', () => {
    it('derives a wildcard-only slot from a default-{category} placeholder', async () => {
      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ garmentIds: ['default-shoes'] })],
      })

      expect(repository.findGarmentSlots).toHaveBeenCalledWith('user-1', [])
      expect(repository.findBestOffer).toHaveBeenCalledWith(
        [{ category: 'shoes', comfortRange: null }],
        GLOBAL_LOCALE_REGION
      )
    })

    it('ignores a placeholder whose suffix is not a garment category', async () => {
      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ garmentIds: ['default-sunglasses'] })],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
      expect(repository.findBestOffer).not.toHaveBeenCalled()
    })

    it('derives category and comfort range from a real garment row', async () => {
      repository.findGarmentSlots.mockResolvedValue([
        { id: 'garment-1', category: 'top', comfort_range: 'cold' },
      ])

      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ garmentIds: ['garment-1'] })],
      })

      expect(repository.findGarmentSlots).toHaveBeenCalledWith('user-1', ['garment-1'])
      expect(repository.findBestOffer).toHaveBeenCalledWith(
        [{ category: 'top', comfortRange: 'cold' }],
        GLOBAL_LOCALE_REGION
      )
    })

    it('contributes no slot for a garment whose category is null', async () => {
      repository.findGarmentSlots.mockResolvedValue([
        { id: 'garment-1', category: null, comfort_range: 'cold' },
      ])

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ garmentIds: ['garment-1'] })],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
      expect(repository.findBestOffer).not.toHaveBeenCalled()
    })

    it('contributes no slot for a garment id the acting user does not own', async () => {
      repository.findGarmentSlots.mockResolvedValue([])

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ garmentIds: ['someone-elses-garment'] })],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
      expect(repository.findBestOffer).not.toHaveBeenCalled()
    })

    it('batches every real garment id across all outfits into one read', async () => {
      repository.findGarmentSlots.mockResolvedValue([
        { id: 'garment-1', category: 'top', comfort_range: 'mild' },
        { id: 'garment-2', category: 'bottom', comfort_range: 'mild' },
      ])

      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [
          outfit({ id: 'a', garmentIds: ['garment-1', 'default-shoes'] }),
          outfit({ id: 'b', garmentIds: ['garment-2', 'garment-1'] }),
        ],
      })

      expect(repository.findGarmentSlots).toHaveBeenCalledTimes(1)
      expect(repository.findGarmentSlots).toHaveBeenCalledWith('user-1', [
        'garment-1',
        'garment-2',
      ])
    })

    it('runs one offer query per distinct slot set, not one per outfit', async () => {
      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [
          outfit({ id: 'a', garmentIds: ['default-top'] }),
          outfit({ id: 'b', garmentIds: ['default-top'] }),
          outfit({ id: 'c', garmentIds: ['default-bottom'] }),
        ],
      })

      expect(repository.findBestOffer).toHaveBeenCalledTimes(2)
    })

    it('orders slots deterministically regardless of garment order', async () => {
      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [
          outfit({ id: 'a', garmentIds: ['default-top', 'default-bottom'] }),
          outfit({ id: 'b', garmentIds: ['default-bottom', 'default-top'] }),
        ],
      })

      expect(repository.findBestOffer).toHaveBeenCalledTimes(1)
      expect(repository.findBestOffer).toHaveBeenCalledWith(
        [
          { category: 'bottom', comfortRange: null },
          { category: 'top', comfortRange: null },
        ],
        GLOBAL_LOCALE_REGION
      )
    })
  })

  describe('offer outcomes', () => {
    it('emits null when no offer matches the outfit', async () => {
      repository.findBestOffer.mockResolvedValue(null)

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
    })

    it('carries no URL in the emitted block', async () => {
      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(Object.keys(resolved.get('outfit-morning') ?? {}).sort()).toEqual([
        'garmentCategory',
        'offerId',
        'offerTitle',
        'partnerDisplayName',
        'partnerId',
      ])
    })

    it('degrades to no CTA rather than throwing when a catalog row is malformed', async () => {
      repository.findBestOffer.mockResolvedValue({ ...OFFER, offer_title: '' })

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
      })

      expect(resolved.get('outfit-morning')).toBeNull()
    })

    it('degrades to no CTA rather than failing the ritual when a read throws', async () => {
      repository.findBestOffer.mockRejectedValue(new Error('commerce tables unreachable'))

      const resolved = await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit({ id: 'a' }), outfit({ id: 'b' })],
      })

      expect([...resolved.values()]).toEqual([null, null])
    })
  })

  describe('locale region resolution', () => {
    it.each([
      {
        name: 'an explicit ?locale= override wins',
        input: { requestedLocale: 'en-US', savedLocale: 'fr-CA' },
        expected: 'US',
      },
      {
        name: 'the stored profile locale is next',
        input: { savedLocale: 'fr-CA', acceptLanguage: 'de-DE' },
        expected: 'CA',
      },
      {
        name: 'Accept-Language is the last real source',
        input: { acceptLanguage: 'es-419' },
        expected: '419',
      },
      {
        name: 'a UN M.49 macro-region is a legal value',
        input: { requestedLocale: 'es-419' },
        expected: '419',
      },
      {
        name: 'nothing resolvable yields the global sentinel',
        input: {},
        expected: GLOBAL_LOCALE_REGION,
      },
      {
        name: 'an unresolvable Accept-Language yields the global sentinel',
        input: { acceptLanguage: 'zz' },
        expected: GLOBAL_LOCALE_REGION,
      },
      {
        name: 'a locale with no region subtag yields the global sentinel',
        input: { requestedLocale: 'fr' },
        expected: GLOBAL_LOCALE_REGION,
      },
      {
        name: 'a region subtag outside the check constraint yields the sentinel',
        input: { requestedLocale: 'en-latn-us' },
        expected: GLOBAL_LOCALE_REGION,
      },
    ])('$name', ({ input, expected }) => {
      expect(resolveLocaleRegion(input)).toBe(expected)
    })

    it('passes the resolved region to the offer query', async () => {
      repository.findUserCommerceContext.mockResolvedValue({
        birthdate: null,
        locale: 'fr-CA',
      })

      await service.resolveShopThisLook({
        userId: 'user-1',
        outfits: [outfit()],
        acceptLanguage: 'de-DE',
      })

      expect(repository.findBestOffer).toHaveBeenCalledWith(expect.anything(), 'CA')
    })
  })

  describe('isAffiliateAudienceEligible', () => {
    /**
     * Decision 1 was resolved by product on 2026-08-11: affiliate CTAs are shown
     * to users under 18. This asserts the stub still says yes for everyone,
     * including the null-birthdate case a reversal must never suppress on.
     */
    it.each([
      { name: 'a profile with no birthdate', profile: { birthdate: null } },
      { name: 'a minor', profile: { birthdate: new Date('2015-01-01T00:00:00.000Z') } },
      { name: 'an adult', profile: { birthdate: new Date('1990-01-01T00:00:00.000Z') } },
      { name: 'no profile at all', profile: null },
    ])('returns true for $name', ({ profile }) => {
      expect(isAffiliateAudienceEligible(profile)).toBe(true)
    })
  })
})
