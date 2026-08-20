import type { AffiliateClickService } from '../../../../apps/api/src/modules/commerce/affiliate-click.service'
import type { AffiliateOfferService } from '../../../../apps/api/src/modules/commerce/affiliate-offer.service'
import type { AffiliateWebhookService } from '../../../../apps/api/src/modules/commerce/affiliate-webhook.service'
import type { CommercePreferencesService } from '../../../../apps/api/src/modules/commerce/commerce-preferences.service'
import {
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
  affiliateWebhookPayloadSchema,
} from '@couture/api-client/contracts/http'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import {
  PACT_COMMERCE_OFFER_ID,
  PACT_COMMERCE_OFFER_TITLE,
  PACT_COMMERCE_PARTNER_NAME,
  PACT_COMMERCE_PARTNER_SLUG,
  PACT_COMMERCE_REDIRECT_URL,
} from '../fixtures'
import { getProviderCommerceState } from '../state'

/**
 * Provider doubles for the commerce-affiliate surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createCommerceAffiliateDoubles() {
  const mockAffiliateOfferService = {
    resolveShopThisLook: (input: { outfits: readonly { id: string }[] }) => {
      const state = getProviderCommerceState()
      if (state?.scenario !== 'eligible') {
        return Promise.resolve(new Map<string, null>())
      }
      return Promise.resolve(
        new Map(
          input.outfits.map((outfit) => [
            outfit.id,
            {
              partnerId: PACT_COMMERCE_PARTNER_SLUG,
              partnerDisplayName: PACT_COMMERCE_PARTNER_NAME,
              offerId: PACT_COMMERCE_OFFER_ID,
              offerTitle: PACT_COMMERCE_OFFER_TITLE,
              garmentCategory: 'top' as const,
            },
          ])
        )
      )
    },
  } as unknown as AffiliateOfferService

  /**
   * The preference endpoints are ungated by the commerce kill switch, so this
   * double answers under every scenario. Only `opted-out` reads as disabled.
   */
  const mockCommercePreferencesService = {
    getPreference: () =>
      Promise.resolve({
        affiliateCtasEnabled: getProviderCommerceState()?.scenario !== 'opted-out',
      }),
    setPreference: (_userId: string, affiliateCtasEnabled: boolean) =>
      Promise.resolve({ affiliateCtasEnabled }),
  } as unknown as CommercePreferencesService

  /**
   * Decision 9's status precedence, expressed as scenarios rather than as
   * re-derived rules. The consumer pins one status per interaction; which
   * condition wins when several hold at once is asserted in
   * `apps/api/src/modules/commerce/affiliate-click.service.spec.ts`.
   */
  const mockAffiliateClickService = {
    recordClick: () => {
      const scenario = getProviderCommerceState()?.scenario
      if (scenario === 'flag-disabled') {
        throw new ServiceUnavailableException(COMMERCE_DISABLED_MESSAGE)
      }
      if (scenario === 'audience-ineligible') {
        throw new ForbiddenException(COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE)
      }
      if (scenario === 'opted-out') {
        throw new ForbiddenException(COMMERCE_OPTED_OUT_MESSAGE)
      }
      if (scenario === 'unknown-offer') {
        throw new NotFoundException(COMMERCE_OFFER_NOT_FOUND_MESSAGE)
      }
      return Promise.resolve({
        redirectUrl: PACT_COMMERCE_REDIRECT_URL,
        // A replay inside the dedupe window returns the SAME URL with a 200.
        created: scenario !== 'click-deduped',
      })
    },
  } as unknown as AffiliateClickService

  /**
   * Signature verification is a scenario flag here, not a real HMAC: the
   * consumer cannot compute one without the partner secret, and proving the
   * five-step verification order is the API suite's job. Body validation is real
   * though, because the 400 the contract records is exactly "the signature
   * passed and then Zod rejected the payload", and running the schema is the
   * only way to record that ordering honestly.
   */
  const mockAffiliateWebhookService = {
    recordConversion: (input: { rawBody?: Buffer }) => {
      if (getProviderCommerceState()?.scenario === 'invalid-signature') {
        throw new UnauthorizedException(WEBHOOK_SIGNATURE_INVALID_MESSAGE)
      }

      const parsed = affiliateWebhookPayloadSchema.safeParse(
        JSON.parse(input.rawBody?.toString('utf8') ?? '{}')
      )
      if (!parsed.success) {
        throw new BadRequestException('Invalid affiliate webhook payload')
      }

      return Promise.resolve({ data: { received: true as const } })
    },
  } as unknown as AffiliateWebhookService

  /**
   * Story 5.2 premium subscription doubles, wired against the real
   * `SubscriptionController`. Same stance as the 5.1 doubles above: the
   * scenario the verifier sets decides the answer; WHEN each status is
   * produced (the flag resolution, the refresh throttle, the entitlement
   * transition table, real Stripe calls) is proven in the API unit and
   * integration suites, where a database and a flag actually exist. An
   * unconfigured scenario fails loudly rather than verifying against stale
   * in-memory data.
   */

  return {
    mockAffiliateOfferService,
    mockCommercePreferencesService,
    mockAffiliateClickService,
    mockAffiliateWebhookService,
  }
}
