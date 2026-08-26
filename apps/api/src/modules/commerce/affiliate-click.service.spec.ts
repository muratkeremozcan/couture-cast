// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_INVALID_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
} from '../../contracts/http.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { AffiliateClickService } from './affiliate-click.service.js'
import type { AffiliateClickTelemetry } from './affiliate-click.telemetry.js'
import type { CommerceClickOffer, CommerceRepository } from './commerce.repository.js'

const OFFER: CommerceClickOffer = {
  offer_id: 'offer-1',
  partner_id: 'partner-1',
  partner_slug: 'sample-partner',
  partner_display_name: 'Sample Partner',
  allowed_host: 'partner.couturecast.test',
  deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}',
  // A garment offer: Story 5.4 adds advisor_slot, null on every non-advisor row.
  advisor_slot: null,
}

const REQUEST = {
  userId: 'user-1',
  offerId: 'offer-1',
  recommendationId: 'rec-1',
  surface: 'mobile_hero',
} as const

function conflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

describe('AffiliateClickService', () => {
  const featureFlags = { getFeatureFlag: vi.fn() }
  const repository = {
    findUserCommerceContext: vi.fn(),
    findAffiliateCtasEnabled: vi.fn(),
    findActiveClickOffer: vi.fn(),
    findRecentClick: vi.fn(),
    findRecommendationScenario: vi.fn(),
    findPaletteProfileId: vi.fn(),
    createClick: vi.fn(),
    findLatestClick: vi.fn(),
  }
  const telemetry = { recordCtaClicked: vi.fn(), recordAdvisorOfferClicked: vi.fn() }

  let service: AffiliateClickService

  beforeEach(() => {
    featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
    repository.findUserCommerceContext
      .mockReset()
      .mockResolvedValue({ birthdate: null, locale: 'en-US' })
    repository.findAffiliateCtasEnabled.mockReset().mockResolvedValue(null)
    repository.findActiveClickOffer.mockReset().mockResolvedValue(OFFER)
    repository.findRecentClick.mockReset().mockResolvedValue(null)
    repository.findRecommendationScenario.mockReset().mockResolvedValue('morning')
    repository.findPaletteProfileId.mockReset().mockResolvedValue('palette-profile-1')
    repository.createClick
      .mockReset()
      .mockImplementation(
        ({ id, token, offerId }: { id: string; token: string; offerId: string }) =>
          Promise.resolve({ id, token, offer_id: offerId })
      )
    repository.findLatestClick.mockReset().mockResolvedValue(null)
    telemetry.recordCtaClicked.mockReset().mockResolvedValue(undefined)
    telemetry.recordAdvisorOfferClicked.mockReset().mockResolvedValue(undefined)

    service = new AffiliateClickService(
      featureFlags as unknown as FeatureFlagsService,
      repository as unknown as CommerceRepository,
      telemetry as unknown as AffiliateClickTelemetry
    )
  })

  describe('construction', () => {
    it('constructs without COMMERCE_CLICK_TOKEN_SECRET, even outside a test environment', () => {
      /*
       * REGRESSION. This constructor used to call `requireClickTokenSecret()`,
       * on the reasoning that a missing production secret should fail at boot
       * rather than on the first click. Nest instantiates every provider while
       * the application bootstraps, so that throw took down the ENTIRE API and
       * the first preview deployment of this story answered
       * FUNCTION_INVOCATION_FAILED on every route, health included.
       *
       * Affiliate commerce is behind a kill switch that defaults to false, so an
       * environment with no secret configured is normal. The blast radius has to
       * be the click endpoint alone.
       *
       * NODE_ENV and TEST_ENV are cleared because `requireClickTokenSecret`
       * falls back to a test-only value through `allowsTestOnlySecrets()`; with
       * them set this test would pass without proving anything.
       */
      const previousNodeEnv = process.env.NODE_ENV
      const previousTestEnv = process.env.TEST_ENV
      const previousSecret = process.env.COMMERCE_CLICK_TOKEN_SECRET
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV
      delete process.env.COMMERCE_CLICK_TOKEN_SECRET

      try {
        expect(
          () =>
            new AffiliateClickService(
              featureFlags as unknown as FeatureFlagsService,
              repository as unknown as CommerceRepository,
              telemetry as unknown as AffiliateClickTelemetry
            )
        ).not.toThrow()
      } finally {
        process.env.NODE_ENV = previousNodeEnv
        if (previousTestEnv === undefined) {
          delete process.env.TEST_ENV
        } else {
          process.env.TEST_ENV = previousTestEnv
        }
        if (previousSecret === undefined) {
          delete process.env.COMMERCE_CLICK_TOKEN_SECRET
        } else {
          process.env.COMMERCE_CLICK_TOKEN_SECRET = previousSecret
        }
      }
    })
  })

  describe('decision 9 status precedence', () => {
    it('returns 503 when the flag is off, ahead of every other check', async () => {
      featureFlags.getFeatureFlag.mockResolvedValue(false)
      repository.findAffiliateCtasEnabled.mockResolvedValue(false)
      repository.findActiveClickOffer.mockResolvedValue(null)

      await expect(service.recordClick(REQUEST)).rejects.toMatchObject({
        status: 503,
        message: COMMERCE_DISABLED_MESSAGE,
      })
      // A disabled feature reports as disabled, never as a permission problem,
      // and it does not read anything else.
      expect(repository.findAffiliateCtasEnabled).not.toHaveBeenCalled()
      expect(repository.createClick).not.toHaveBeenCalled()
    })

    it('returns 403 opted out ahead of an unknown offer', async () => {
      repository.findAffiliateCtasEnabled.mockResolvedValue(false)
      repository.findActiveClickOffer.mockResolvedValue(null)

      await expect(service.recordClick(REQUEST)).rejects.toMatchObject({
        status: 403,
        message: COMMERCE_OPTED_OUT_MESSAGE,
      })
      expect(repository.findActiveClickOffer).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown, inactive, or out-of-window offer', async () => {
      repository.findActiveClickOffer.mockResolvedValue(null)

      await expect(service.recordClick(REQUEST)).rejects.toMatchObject({
        status: 404,
        message: COMMERCE_OFFER_NOT_FOUND_MESSAGE,
      })
      expect(repository.createClick).not.toHaveBeenCalled()
    })

    it('has an audience message wired to the same constant the contract exports', () => {
      // The audience predicate always returns true today (decision 1, resolved
      // 2026-08-11), so this branch is unreachable by construction. The constant
      // is asserted here so the 403 message cannot drift from the contract while
      // no test can exercise the branch.
      expect(COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE).toBe(
        'Affiliate suggestions are unavailable for this account.'
      )
    })

    it('proceeds when the preference row explicitly enables CTAs', async () => {
      repository.findAffiliateCtasEnabled.mockResolvedValue(true)

      await expect(service.recordClick(REQUEST)).resolves.toMatchObject({ created: true })
    })
  })

  describe('invalid catalog data', () => {
    it.each([
      {
        name: 'a template with no {clickToken}',
        offer: { ...OFFER, deep_link_template: 'https://partner.couturecast.test/shop' },
      },
      {
        name: 'a non-https template',
        offer: {
          ...OFFER,
          deep_link_template: 'http://partner.couturecast.test/shop?cc={clickToken}',
        },
      },
      {
        name: 'a template carrying userinfo',
        offer: {
          ...OFFER,
          deep_link_template: 'https://a:b@partner.couturecast.test/shop?cc={clickToken}',
        },
      },
      {
        name: 'a template pointing off the allowed host',
        offer: {
          ...OFFER,
          deep_link_template: 'https://notpartner.couturecast.test/shop?cc={clickToken}',
        },
      },
      {
        name: 'a template that does not parse',
        offer: { ...OFFER, deep_link_template: 'shop?cc={clickToken}' },
      },
    ])('returns 500 and creates no row for $name', async ({ offer }) => {
      repository.findActiveClickOffer.mockResolvedValue(offer)

      await expect(service.recordClick(REQUEST)).rejects.toMatchObject({
        status: 500,
        message: COMMERCE_OFFER_INVALID_MESSAGE,
      })
      expect(repository.createClick).not.toHaveBeenCalled()
      expect(telemetry.recordCtaClicked).not.toHaveBeenCalled()
    })

    it('returns 500 when a deduped replay resolves against a since-broken template', async () => {
      repository.findRecentClick.mockResolvedValue({
        id: 'click-0',
        token: 'existing-token',
        offer_id: 'offer-1',
      })
      repository.findActiveClickOffer.mockResolvedValue({
        ...OFFER,
        deep_link_template: 'https://evil.test/shop?cc={clickToken}',
      })

      await expect(service.recordClick(REQUEST)).rejects.toMatchObject({ status: 500 })
    })
  })

  describe('minting', () => {
    it('creates one row, returns 201-shaped output, and emits once', async () => {
      const result = await service.recordClick(REQUEST)

      expect(result.created).toBe(true)
      expect(result.redirectUrl).toMatch(
        /^https:\/\/partner\.couturecast\.test\/shop\?cc=[A-Za-z0-9_-]+$/
      )
      expect(repository.createClick).toHaveBeenCalledTimes(1)
      expect(telemetry.recordCtaClicked).toHaveBeenCalledTimes(1)
    })

    it('puts the HMAC token in the URL, never the row id', async () => {
      const result = await service.recordClick(REQUEST)

      const created = repository.createClick.mock.calls[0]?.[0] as {
        id: string
        token: string
      }
      expect(result.redirectUrl).toContain(created.token)
      expect(result.redirectUrl).not.toContain(created.id)
    })

    it('derives scenario and locale region server-side rather than from the client', async () => {
      repository.findRecommendationScenario.mockResolvedValue('evening')
      repository.findUserCommerceContext.mockResolvedValue({
        birthdate: null,
        locale: 'fr-CA',
      })

      await service.recordClick(REQUEST)

      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: 'evening', localeRegion: 'CA' })
      )
      expect(telemetry.recordCtaClicked).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: 'evening', localeRegion: 'CA' })
      )
    })

    it('falls back to the global region when no locale resolves', async () => {
      repository.findUserCommerceContext.mockResolvedValue({
        birthdate: null,
        locale: undefined,
      })

      await service.recordClick(REQUEST)

      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ localeRegion: '*' })
      )
    })

    it('keeps the click but skips the event when the recommendation has rotated away', async () => {
      repository.findRecommendationScenario.mockResolvedValue(null)

      const result = await service.recordClick(REQUEST)

      expect(result.created).toBe(true)
      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: 'unknown' })
      )
      // The analytics `scenario` property is a closed enum, so emitting here
      // would mean inventing one of three values.
      expect(telemetry.recordCtaClicked).not.toHaveBeenCalled()
    })

    it('emits only after the row has committed', async () => {
      await service.recordClick(REQUEST)

      const createOrder = repository.createClick.mock.invocationCallOrder[0] ?? Number.NaN
      const emitOrder =
        telemetry.recordCtaClicked.mock.invocationCallOrder[0] ?? Number.NaN
      expect(createOrder).toBeLessThan(emitOrder)
    })

    it('carries the partner slug rather than the internal partner id into analytics', async () => {
      await service.recordClick(REQUEST)

      expect(telemetry.recordCtaClicked).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: 'sample-partner', offerId: 'offer-1' })
      )
      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: 'partner-1' })
      )
    })
  })

  describe('dedupe', () => {
    it('returns the existing row URL, creates nothing, and emits nothing', async () => {
      repository.findRecentClick.mockResolvedValue({
        id: 'click-0',
        token: 'existing-token',
        offer_id: 'offer-1',
      })

      const result = await service.recordClick(REQUEST)

      expect(result).toEqual({
        created: false,
        redirectUrl: 'https://partner.couturecast.test/shop?cc=existing-token',
      })
      expect(repository.createClick).not.toHaveBeenCalled()
      expect(telemetry.recordCtaClicked).not.toHaveBeenCalled()
      expect(repository.findRecentClick).toHaveBeenCalledWith(
        'user-1',
        'offer-1',
        'rec-1'
      )
    })

    it('re-reads the winner when the unique dedupe index rejects a concurrent insert', async () => {
      repository.createClick.mockRejectedValue(conflict())
      repository.findLatestClick.mockResolvedValue({
        id: 'click-winner',
        token: 'winner-token',
        offer_id: 'offer-1',
      })

      const result = await service.recordClick(REQUEST)

      expect(result).toEqual({
        created: false,
        redirectUrl: 'https://partner.couturecast.test/shop?cc=winner-token',
      })
      expect(telemetry.recordCtaClicked).not.toHaveBeenCalled()
    })

    it('rethrows a conflict whose winning row cannot be found', async () => {
      const error = conflict()
      repository.createClick.mockRejectedValue(error)
      repository.findLatestClick.mockResolvedValue(null)

      await expect(service.recordClick(REQUEST)).rejects.toBe(error)
    })

    it('rethrows a database error that is not a unique-constraint conflict', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
        code: 'P2003',
        clientVersion: 'test',
      })
      repository.createClick.mockRejectedValue(error)

      await expect(service.recordClick(REQUEST)).rejects.toBe(error)
      expect(repository.findLatestClick).not.toHaveBeenCalled()
    })

    it('rethrows a non-Prisma failure untouched', async () => {
      const error = new Error('connection reset')
      repository.createClick.mockRejectedValue(error)

      await expect(service.recordClick(REQUEST)).rejects.toBe(error)
    })
  })

  describe('story 5.4 advisor branch (Decision 7)', () => {
    const ADVISOR_OFFER: CommerceClickOffer = {
      offer_id: 'advisor-offer-1',
      partner_id: 'partner-1',
      partner_slug: 'sample-partner',
      partner_display_name: 'Sample Partner',
      allowed_host: 'partner.couturecast.test',
      deep_link_template: 'https://partner.couturecast.test/shop/advisor?cc={clickToken}',
      advisor_slot: 'foundation',
    }

    it('5.4-INT-022 branches on the OFFER ROW advisor_slot, not on input.surface: a garment offer id sent with surface "palette_advisor" still emits affiliate_cta_clicked', async () => {
      // OFFER (module-level fixture) is a garment offer: advisor_slot is null.
      repository.findActiveClickOffer.mockResolvedValue(OFFER)

      await service.recordClick({ ...REQUEST, surface: 'palette_advisor' })

      expect(telemetry.recordCtaClicked).toHaveBeenCalledTimes(1)
      expect(telemetry.recordAdvisorOfferClicked).not.toHaveBeenCalled()
      expect(repository.findRecommendationScenario).toHaveBeenCalled()
    })

    it('5.4-INT-023 branches on the OFFER ROW advisor_slot, not on input.surface: an advisor offer id sent with surface "mobile_hero" still emits advisor_offer_clicked', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)

      await service.recordClick({
        ...REQUEST,
        offerId: ADVISOR_OFFER.offer_id,
        surface: 'mobile_hero',
        platform: 'mobile',
      })

      expect(telemetry.recordAdvisorOfferClicked).toHaveBeenCalledTimes(1)
      expect(telemetry.recordAdvisorOfferClicked).toHaveBeenCalledWith({
        userId: REQUEST.userId,
        partnerId: ADVISOR_OFFER.partner_slug,
        offerId: ADVISOR_OFFER.offer_id,
        advisorSlot: 'foundation',
        platform: 'mobile',
      })
      expect(telemetry.recordCtaClicked).not.toHaveBeenCalled()
      // The garment scenario lookup never runs for an advisor click: it has no
      // ScenarioOutfit, and a lookup here would either invent a scenario or
      // route the click into the UNRESOLVED_SCENARIO dead end that emits
      // nothing.
      expect(repository.findRecommendationScenario).not.toHaveBeenCalled()
    })

    it('defaults platform to web when the client omits it', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)

      await service.recordClick({
        ...REQUEST,
        offerId: ADVISOR_OFFER.offer_id,
        surface: 'palette_advisor',
      })

      expect(telemetry.recordAdvisorOfferClicked).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'web' })
      )
    })

    it('stores the ADVISOR_SCENARIO sentinel rather than falling into UNRESOLVED_SCENARIO', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)

      await service.recordClick({
        ...REQUEST,
        offerId: ADVISOR_OFFER.offer_id,
      })

      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ scenario: 'advisor' })
      )
    })

    /**
     * 5.4-INT-024. The dedupe index is `(user_id, offer_id, recommendation_id,
     * minute)`, so a client that can choose the third column can mint unlimited
     * attributed clicks for one offer inside one minute. An advisor click's
     * `recommendation_id` is therefore resolved from the caller's own
     * `PaletteProfile`, and whatever the request body carried is discarded.
     */
    it('5.4-INT-024 derives the advisor recommendation id server-side, ignoring the request body', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)
      repository.findPaletteProfileId.mockResolvedValue('real-palette-profile')

      await service.recordClick({
        ...REQUEST,
        offerId: ADVISOR_OFFER.offer_id,
        recommendationId: 'forged-by-the-client',
      })

      expect(repository.findPaletteProfileId).toHaveBeenCalledWith(REQUEST.userId)
      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ recommendationId: 'real-palette-profile' })
      )
      // The dedupe lookup uses the derived id too, or the derivation would only
      // protect the insert and leave the replay window client-controlled.
      expect(repository.findRecentClick).toHaveBeenCalledWith(
        REQUEST.userId,
        ADVISOR_OFFER.offer_id,
        'real-palette-profile'
      )
    })

    /**
     * 5.4-INT-025. A caller with no `PaletteProfile` has never granted consent, so
     * no advisor card was ever rendered for them and there is nothing to attribute.
     */
    it('5.4-INT-025 refuses an advisor click from a caller with no palette profile', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)
      repository.findPaletteProfileId.mockResolvedValue(null)

      await expect(
        service.recordClick({ ...REQUEST, offerId: ADVISOR_OFFER.offer_id })
      ).rejects.toMatchObject({ status: 403 })
      expect(repository.createClick).not.toHaveBeenCalled()
      expect(telemetry.recordAdvisorOfferClicked).not.toHaveBeenCalled()
    })

    /** A garment click never touches the palette profile lookup. */
    it("5.4-INT-026 leaves a garment click's recommendation id exactly as sent", async () => {
      repository.findActiveClickOffer.mockResolvedValue(OFFER)

      await service.recordClick(REQUEST)

      expect(repository.findPaletteProfileId).not.toHaveBeenCalled()
      expect(repository.createClick).toHaveBeenCalledWith(
        expect.objectContaining({ recommendationId: REQUEST.recommendationId })
      )
    })

    it('dedupes an advisor click replay the same way as a garment click', async () => {
      repository.findActiveClickOffer.mockResolvedValue(ADVISOR_OFFER)
      repository.findRecentClick.mockResolvedValue({
        id: 'existing-click',
        token: 'existing-token',
        offer_id: ADVISOR_OFFER.offer_id,
      })

      const result = await service.recordClick({
        ...REQUEST,
        offerId: ADVISOR_OFFER.offer_id,
      })

      expect(result.created).toBe(false)
      expect(repository.createClick).not.toHaveBeenCalled()
      expect(telemetry.recordAdvisorOfferClicked).not.toHaveBeenCalled()
    })
  })
})
