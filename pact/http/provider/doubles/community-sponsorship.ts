import { CommunitySponsorshipService } from '../../../../apps/api/src/modules/commerce/community-sponsorship.service.js'
import type {
  CommerceRepository,
  CommerceUserContext,
  CommunitySponsorshipMatch,
} from '../../../../apps/api/src/modules/commerce/commerce.repository.js'
import type { FeatureFlagsService } from '../../../../apps/api/src/modules/feature-flags/feature-flags.service.js'
import {
  PACT_COMMERCE_OFFER_ID,
  PACT_COMMERCE_OFFER_TITLE,
  PACT_COMMERCE_PARTNER_NAME,
  PACT_COMMERCE_PARTNER_SLUG,
  PACT_COMMUNITY_SPONSORED_POST_ID,
  PACT_COMMUNITY_SPONSORSHIP_REGION,
  PACT_COMMUNITY_VIEWER_LOCALE,
} from '../fixtures'
import { getProviderCommerceState } from '../state'

/**
 * Story 6.7b sponsorship seams.
 *
 * Provider verification runs the real `CommunitySponsorshipService`: the flag
 * check, the stored preference, the region from the saved locale and
 * `Accept-Language`, the batched eligibility lookup and the strict
 * `communitySponsorshipSchema` parse that builds each block. Only what it
 * injects is faked here, the `commerce_affiliate_enabled` flag and the three
 * `CommerceRepository` reads it makes, and each fake reads the commerce
 * scenario the provider state set.
 *
 * The world is one link: `PACT_COMMUNITY_SPONSORED_POST_ID` sponsored by the
 * commerce fixture's offer in `PACT_COMMUNITY_SPONSORSHIP_REGION`, live only
 * under the `eligible` scenario. The eligibility rule itself (window, offer
 * and partner status, garment offers only, public adult posts) is SQL, and it
 * belongs to `community-sponsorship.service.spec.ts` and the API integration
 * suite against real PostgreSQL; restating it here would make this suite agree
 * with itself.
 *
 * The same instance serves the community reads and the click double, so the
 * click's re-check is `isClickable` itself, decided by the post id and offer id
 * the request carried.
 */
export function createCommunitySponsorshipDoubles() {
  const scenarioOf = () => getProviderCommerceState()?.scenario

  const featureFlags = {
    getFeatureFlag: (key: string) => {
      if (key !== 'commerce_affiliate_enabled') {
        return Promise.reject(new Error(`Unexpected feature flag read: ${key}`))
      }
      // No commerce state means the flag's own default, which is off.
      const scenario = scenarioOf()
      return Promise.resolve(scenario !== undefined && scenario !== 'flag-disabled')
    },
  } as unknown as FeatureFlagsService

  const repository = {
    // Null is "no stored row", which the service reads as the default `true`.
    findAffiliateCtasEnabled: () =>
      Promise.resolve(scenarioOf() === 'opted-out' ? false : null),
    findUserCommerceContext: (): Promise<CommerceUserContext> =>
      Promise.resolve({ birthdate: null, locale: PACT_COMMUNITY_VIEWER_LOCALE }),
    findEligibleCommunitySponsorships: (
      postIds: readonly string[],
      localeRegion: string,
      offerId?: string
    ): Promise<readonly CommunitySponsorshipMatch[]> => {
      const linked =
        scenarioOf() === 'eligible' &&
        localeRegion === PACT_COMMUNITY_SPONSORSHIP_REGION &&
        postIds.includes(PACT_COMMUNITY_SPONSORED_POST_ID) &&
        (offerId === undefined || offerId === PACT_COMMERCE_OFFER_ID)
      return Promise.resolve(
        linked
          ? [
              {
                post_id: PACT_COMMUNITY_SPONSORED_POST_ID,
                offer_id: PACT_COMMERCE_OFFER_ID,
                offer_title: PACT_COMMERCE_OFFER_TITLE,
                partner_slug: PACT_COMMERCE_PARTNER_SLUG,
                partner_display_name: PACT_COMMERCE_PARTNER_NAME,
              },
            ]
          : []
      )
    },
  } as unknown as CommerceRepository

  const communitySponsorshipService = new CommunitySponsorshipService(
    featureFlags,
    repository
  )

  return { communitySponsorshipService }
}
