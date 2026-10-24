import { Inject, Injectable } from '@nestjs/common'
import {
  communitySponsorshipSchema,
  type CommunitySponsorship,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { resolveLocaleRegion } from './affiliate-offer.service.js'
import { CommerceRepository } from './commerce.repository.js'

export type ResolveCommunitySponsorshipsInput = {
  readonly userId: string
  readonly postIds: readonly string[]
  readonly acceptLanguage?: string | undefined
}

export type FindClickableCommunitySponsorshipInput = {
  readonly postId: string
  readonly offerId: string
  readonly locale: string | undefined
  readonly acceptLanguage?: string | undefined
}

/**
 * Story 6.7b: the per-viewer sponsorship block for opted-in community reads.
 *
 * It runs after the community read has produced its items, so the spotlight's
 * Redis read model, which keeps post ids only, never holds a viewer's block, and
 * linking or ending a sponsorship applies on the very next read with no cache
 * action.
 *
 * The chain matches the hero CTA's: the `commerce_affiliate_enabled` flag, then
 * the stored preference (a missing row means `true`), then one batched
 * eligibility query for the whole page. The region comes from
 * `resolveLocaleRegion` with the saved locale and `Accept-Language`, the same
 * inputs the click re-check uses, so a read and the click that follows it agree.
 * There is no viewer age step, per Story 5.1 Decision 1.
 *
 * Any failure yields no blocks and the community read still succeeds. The log
 * line carries no user, post or offer identifier.
 */
@Injectable()
export class CommunitySponsorshipService {
  private readonly logger = createBaseLogger().child({
    feature: 'community-sponsorship',
  })

  constructor(
    @Inject(FeatureFlagsService)
    private readonly featureFlags: FeatureFlagsService,
    @Inject(CommerceRepository)
    private readonly repository: CommerceRepository
  ) {}

  async resolveForPosts(
    input: ResolveCommunitySponsorshipsInput
  ): Promise<ReadonlyMap<string, CommunitySponsorship>> {
    const none = new Map<string, CommunitySponsorship>()
    if (input.postIds.length === 0) {
      return none
    }

    try {
      // A truthiness check: the flag's literal default type is `false`.
      const flagEnabled = await this.featureFlags.getFeatureFlag(
        'commerce_affiliate_enabled',
        input.userId
      )
      if (!flagEnabled) {
        return none
      }

      const [storedPreference, userContext] = await Promise.all([
        this.repository.findAffiliateCtasEnabled(input.userId),
        this.repository.findUserCommerceContext(input.userId),
      ])
      if (storedPreference === false) {
        return none
      }

      const localeRegion = resolveLocaleRegion({
        savedLocale: userContext.locale,
        acceptLanguage: input.acceptLanguage,
      })
      const matches = await this.repository.findEligibleCommunitySponsorships(
        [...new Set(input.postIds)],
        localeRegion
      )

      const blocks = new Map<string, CommunitySponsorship>()
      for (const match of matches) {
        blocks.set(
          match.post_id,
          communitySponsorshipSchema.parse({
            partnerId: match.partner_slug,
            partnerDisplayName: match.partner_display_name,
            offerId: match.offer_id,
            offerTitle: match.offer_title,
          })
        )
      }
      return blocks
    } catch (error: unknown) {
      this.logger.error(
        { errorName: error instanceof Error ? error.name : typeof error },
        'community_sponsorship_resolution_failed'
      )
      return none
    }
  }

  /**
   * The click re-check: whether `offerId` is sponsored on `postId` for this
   * viewer right now, by the identical eligibility rule. The caller has already
   * run the flag, audience and opt-out checks.
   */
  async isClickable(input: FindClickableCommunitySponsorshipInput): Promise<boolean> {
    const localeRegion = resolveLocaleRegion({
      savedLocale: input.locale,
      acceptLanguage: input.acceptLanguage,
    })
    const matches = await this.repository.findEligibleCommunitySponsorships(
      [input.postId],
      localeRegion,
      input.offerId
    )
    return matches.length > 0
  }
}
