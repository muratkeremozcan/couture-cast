import { Inject, Injectable } from '@nestjs/common'
import { garmentCategoryEnum } from '@couture/api-client'
import {
  advisorSponsoredOfferSchema,
  resolveAcceptLanguage,
  resolveSupportedLocale,
  shopThisLookSchema,
  type AdvisorSlot,
  type AdvisorSponsoredOffer,
  type ShopThisLook,
  type SkinUndertone,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  CommerceRepository,
  type CommerceAdvisorOfferMatch,
  type CommerceGarmentRow,
  type CommerceOfferMatch,
  type CommerceOfferSlot,
} from './commerce.repository.js'

/**
 * Story 5.1: resolves the single affiliate offer, if any, for one outfit card.
 *
 * WHERE THIS IS CALLED FROM, AND WHY IT MATTERS.
 *
 * This runs in `RitualController.getOrCreateRitual`, between the service call
 * and `ritualResponseSchema.parse`, not inside `RitualService`. That is a
 * deliberate choice, not an accident of layering:
 *
 *   * `RitualService` has no single "after the cache read" point. It returns
 *     `cachedPayload.data` at step 3, before forecast-segment resolution, before
 *     the garment query, and hundreds of lines before response assembly. On the
 *     warm-cache path neither `segment`, `adjustedFeelsLike`, nor `comfortPrefs`
 *     is in scope.
 *   * `RitualService`'s constructor is instantiated positionally at twelve sites
 *     in its spec with no DI container, so adding a dependency there is a
 *     twelve-site change.
 *
 * The consequence, stated so nobody has to re-derive it: `shopThisLook` is never
 * written into the Redis or database recommendation cache, and toggling the
 * preference performs no cache invalidation. The rejected alternative -- a
 * commerce revision in the ritual cache key -- multiplies cache entries by
 * preference state and makes a single catalog edit evict every user's
 * personalization cache.
 */
/**
 * Structurally the subset of a scenario outfit this service reads, rather than
 * the full `ScenarioOutfit` contract type.
 *
 * That is not fussiness. `ScenarioOutfit` now REQUIRES `shopThisLook`, and this
 * service runs on outfits that do not have it yet -- it is what produces it.
 * Typing the input as the full contract shape would be circular.
 */
export type AffiliateOutfitSlot = {
  readonly id: string
  readonly scenario: string
  readonly garmentIds: readonly string[]
}

export type ResolveShopThisLookInput = {
  userId: string
  outfits: readonly AffiliateOutfitSlot[]
  acceptLanguage?: string
  requestedLocale?: string
}

/**
 * Story 5.4 Decision 7: the advisor's own resolution input. `slots` is the
 * distinct set of advisor slots the current recommendation card list needs
 * (deduplicated by the caller -- both blush cards share one slot lookup),
 * and `undertone` is the acting user's already-classified undertone, never
 * re-derived here.
 */
export type ResolveAdvisorOffersInput = {
  userId: string
  slots: readonly AdvisorSlot[]
  undertone: SkinUndertone
  acceptLanguage?: string
  requestedLocale?: string
}

/**
 * The subset of `UserProfile` an age-based audience rule would need. Declared
 * structurally so {@link isAffiliateAudienceEligible} does not drag the whole
 * Prisma model, and its callers do not have to load columns nothing reads.
 */
export type AffiliateAudienceProfile = {
  readonly birthdate: Date | null
}

/**
 * DECISION 1, RESOLVED 2026-08-11 BY PRODUCT: affiliate CTAs are shown to users
 * under 18, on the same terms as adults. There is no age-based suppression, so
 * this predicate always returns `true`.
 *
 * It exists as a real call site rather than as a comment so that reversing the
 * policy is a change to this function alone. The regulatory exposure of
 * advertising to identified minors was put on record and accepted knowingly;
 * this is not an oversight.
 *
 * TO REVERSE THE POLICY, in this order:
 *
 *   1. Implement the age check here. Use
 *      `hasReachedAgeOfMajority(birthdate, today)` from `guardian.service.ts`.
 *      Do NOT key on `apiRole === 'teen'`: that role is read verbatim from
 *      Supabase `app_metadata.app_role` and is never derived from age, so a user
 *      who signed up at 15 still carries it at 25 and would lose commerce
 *      forever. The emancipation sweep revokes consent rows without touching the
 *      Supabase role.
 *   2. A null `birthdate` must NOT suppress. The column is nullable, so
 *      suppressing on unknown age would disable commerce for every legacy
 *      account. Record the count of null-birthdate users who saw a CTA as an
 *      operational metric instead.
 *   3. Add it back as a step in the decision-4 chain in
 *      {@link AffiliateOfferService.resolveShopThisLook}, between the stored
 *      preference and offer selection. The click endpoint already calls it.
 */
export function isAffiliateAudienceEligible(
  // Unread on purpose, and load-bearing. The caller already loads and passes
  // the profile, so a policy reversal is a change to this function's body
  // alone. Deleting the parameter because today's body ignores it would make
  // that reversal a change at every call site instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  profile: AffiliateAudienceProfile | null
): boolean {
  return true
}

/** Catalog rows carry this to publish globally, and it is also the fallback. */
export const GLOBAL_LOCALE_REGION = '*'

/** Mirrors the migration's `locale_region` check constraint. */
const LOCALE_REGION_PATTERN = /^[A-Z0-9]{2,3}$/

const PLACEHOLDER_GARMENT_PREFIX = 'default-'

export type LocaleRegionInput = {
  readonly requestedLocale?: string | undefined
  readonly savedLocale?: string | undefined
  readonly acceptLanguage?: string | undefined
}

/**
 * The UI-language region, NOT a commerce jurisdiction.
 *
 * It follows the same precedence the ritual already uses: explicit `?locale=`,
 * then the stored `UserProfile.preferences.locale`, then `Accept-Language`. It
 * then takes the region subtag of whatever that resolves to: `en-US` yields
 * `US`, `fr-CA` yields `CA`, and `es-419` yields `419`, which is a UN M.49
 * macro-region rather than a country. A US-based user reading the app in `fr-FR`
 * therefore sees `FR` offers. A real jurisdiction source does not exist in this
 * codebase and introducing one is a separate story.
 *
 * The ritual's own chain ends in a `defaultSupportedLocale` fallback and this
 * one deliberately does not: an unresolvable locale yields the `'*'` sentinel so
 * the user sees globally published offers, rather than silently being treated as
 * a `US` reader.
 */
export function resolveLocaleRegion(input: LocaleRegionInput): string {
  const locale =
    input.requestedLocale ??
    resolveSupportedLocale(input.savedLocale) ??
    resolveAcceptLanguage(input.acceptLanguage)

  if (!locale) {
    return GLOBAL_LOCALE_REGION
  }

  const region = locale.split('-')[1]?.toUpperCase()
  if (!region || !LOCALE_REGION_PATTERN.test(region)) {
    return GLOBAL_LOCALE_REGION
  }

  return region
}

function isPlaceholderGarmentId(garmentId: string): boolean {
  return garmentId.startsWith(PLACEHOLDER_GARMENT_PREFIX)
}

/**
 * A `default-{category}` placeholder yields `(category, null)`, which matches
 * wildcard offers only.
 *
 * It cannot contribute a comfort range: the scenario's `targetComfortRange` is
 * computed inside the cold-generate branch of `RitualService` and is out of
 * scope on the warm-cache path, so using it here would produce a different
 * answer depending on whether the recommendation was cached.
 */
function parsePlaceholderSlot(garmentId: string): CommerceOfferSlot | null {
  const parsed = garmentCategoryEnum.safeParse(
    garmentId.slice(PLACEHOLDER_GARMENT_PREFIX.length)
  )
  return parsed.success ? { category: parsed.data, comfortRange: null } : null
}

function slotKey(slot: CommerceOfferSlot): string {
  return `${slot.category}:${slot.comfortRange ?? GLOBAL_LOCALE_REGION}`
}

@Injectable()
export class AffiliateOfferService {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-offers' })

  constructor(
    @Inject(FeatureFlagsService)
    private readonly featureFlags: FeatureFlagsService,
    @Inject(CommerceRepository)
    private readonly repository: CommerceRepository
  ) {}

  /**
   * Returns one entry per outfit id, in the same order as the input.
   *
   * The decision-4 chain runs in a fixed order and short-circuits on the first
   * failure: the `commerce_affiliate_enabled` flag, then the stored preference
   * (a missing row means the `true` default), then offer selection. Any failure
   * yields `null` for every outfit.
   *
   * `isAffiliateAudienceEligible` is deliberately NOT a step here; see its doc
   * comment for why, and for how to add it back.
   */
  async resolveShopThisLook(
    input: ResolveShopThisLookInput
  ): Promise<ReadonlyMap<string, ShopThisLook | null>> {
    const ineligible = (): ReadonlyMap<string, ShopThisLook | null> =>
      new Map(input.outfits.map((outfit) => [outfit.id, null]))

    try {
      const flagEnabled = await this.featureFlags.getFeatureFlag(
        'commerce_affiliate_enabled',
        input.userId
      )
      // A truthiness check rather than `!== true`: `FeatureFlagValue` resolves to
      // the literal type of the flag's `defaultValue`, so this key is statically
      // `false` even though it is `boolean` at runtime, and an equality
      // comparison is rejected as having no overlap.
      if (!flagEnabled) {
        return ineligible()
      }

      const storedPreference = await this.repository.findAffiliateCtasEnabled(
        input.userId
      )
      if (storedPreference === false) {
        return ineligible()
      }

      return await this.selectOffers(input)
    } catch (error) {
      /**
       * An affiliate CTA must never take down the daily ritual. A catalog row
       * with a malformed title, an unreachable commerce table, or a feature-flag
       * outage degrades to "no CTA" rather than to a 500 on the app's primary
       * screen.
       */
      this.logger.error(
        { error, userId: input.userId },
        'commerce_shop_this_look_resolution_failed'
      )
      return ineligible()
    }
  }

  /**
   * Story 5.4 Decision 7: the advisor's own offer resolution, running the
   * IDENTICAL short-circuit chain `resolveShopThisLook` documents above --
   * the `commerce_affiliate_enabled` flag, then the stored preference (a
   * missing row means the `true` default), then selection -- with any
   * failure degrading to "no offer" rather than to an error, so a catalog
   * fault can never take down the advisor's first-party recommendations.
   *
   * `isAffiliateAudienceEligible` is deliberately NOT a step here either, for
   * the same reason `resolveShopThisLook` omits it: a third posture on the
   * same catalog is how that policy stops being reversible in one place.
   */
  async resolveAdvisorOffers(
    input: ResolveAdvisorOffersInput
  ): Promise<ReadonlyMap<AdvisorSlot, AdvisorSponsoredOffer | null>> {
    const ineligible = (): ReadonlyMap<AdvisorSlot, AdvisorSponsoredOffer | null> =>
      new Map(input.slots.map((slot) => [slot, null]))

    try {
      const flagEnabled = await this.featureFlags.getFeatureFlag(
        'commerce_affiliate_enabled',
        input.userId
      )
      if (!flagEnabled) {
        return ineligible()
      }

      const storedPreference = await this.repository.findAffiliateCtasEnabled(
        input.userId
      )
      if (storedPreference === false) {
        return ineligible()
      }

      const userContext = await this.repository.findUserCommerceContext(input.userId)
      const localeRegion = resolveLocaleRegion({
        requestedLocale: input.requestedLocale,
        savedLocale: userContext.locale,
        acceptLanguage: input.acceptLanguage,
      })

      const resolved = new Map<AdvisorSlot, AdvisorSponsoredOffer | null>()
      for (const slot of new Set(input.slots)) {
        const match = await this.repository.findBestAdvisorOffer(
          slot,
          input.undertone,
          localeRegion
        )
        resolved.set(slot, match ? this.toAdvisorSponsoredOffer(match) : null)
      }
      return resolved
    } catch (error) {
      this.logger.error(
        { error, userId: input.userId },
        'commerce_advisor_offer_resolution_failed'
      )
      return ineligible()
    }
  }

  private toAdvisorSponsoredOffer(
    match: CommerceAdvisorOfferMatch
  ): AdvisorSponsoredOffer {
    // Parsed rather than cast, for the same reason `toShopThisLook` parses:
    // a catalog row with an empty title or display name must degrade to no
    // offer via the caller's catch, not reach a client with a broken card.
    return advisorSponsoredOfferSchema.parse({
      partnerId: match.partner_slug,
      partnerDisplayName: match.partner_display_name,
      offerId: match.offer_id,
      offerTitle: match.offer_title,
    })
  }

  private async selectOffers(
    input: ResolveShopThisLookInput
  ): Promise<ReadonlyMap<string, ShopThisLook | null>> {
    const realGarmentIds = [
      ...new Set(
        input.outfits.flatMap((outfit) =>
          outfit.garmentIds.filter((garmentId) => !isPlaceholderGarmentId(garmentId))
        )
      ),
    ]

    const [userContext, garmentRows] = await Promise.all([
      this.repository.findUserCommerceContext(input.userId),
      this.repository.findGarmentSlots(input.userId, realGarmentIds),
    ])

    const localeRegion = resolveLocaleRegion({
      requestedLocale: input.requestedLocale,
      savedLocale: userContext.locale,
      acceptLanguage: input.acceptLanguage,
    })

    const garmentsById = new Map<string, CommerceGarmentRow>(
      garmentRows.map((row) => [row.id, row])
    )

    const resolved = new Map<string, ShopThisLook | null>()
    /**
     * The three scenario outfits usually share garment categories, so their slot
     * sets collide. Memoizing on the slot signature turns the common case into
     * one offer query per ritual instead of three, and the ordering is total so
     * two identical slot sets cannot legitimately resolve differently.
     */
    const bySlotSignature = new Map<string, ShopThisLook | null>()

    for (const outfit of input.outfits) {
      const slots = this.deriveSlots(outfit.garmentIds, garmentsById)
      if (slots.length === 0) {
        resolved.set(outfit.id, null)
        continue
      }

      const signature = slots.map(slotKey).join('|')
      let offer = bySlotSignature.get(signature)
      if (offer === undefined) {
        const match = await this.repository.findBestOffer(slots, localeRegion)
        offer = match ? this.toShopThisLook(match) : null
        bySlotSignature.set(signature, offer)
      }

      resolved.set(outfit.id, offer)
    }

    return resolved
  }

  private deriveSlots(
    garmentIds: readonly string[],
    garmentsById: ReadonlyMap<string, CommerceGarmentRow>
  ): readonly CommerceOfferSlot[] {
    const slots = new Map<string, CommerceOfferSlot>()

    for (const garmentId of garmentIds) {
      const slot = isPlaceholderGarmentId(garmentId)
        ? parsePlaceholderSlot(garmentId)
        : this.toGarmentSlot(garmentsById.get(garmentId))

      if (slot) {
        slots.set(slotKey(slot), slot)
      }
    }

    // Sorted so the memoization signature is stable regardless of the order the
    // recommendation happens to list its garments in.
    return [...slots.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s)
  }

  /**
   * A garment the acting user does not own, or one whose category is null,
   * contributes no slot. Category is nullable until tagging completes, and an
   * untagged garment has nothing an offer could match on.
   */
  private toGarmentSlot(row: CommerceGarmentRow | undefined): CommerceOfferSlot | null {
    if (!row?.category) {
      return null
    }
    return { category: row.category, comfortRange: row.comfort_range }
  }

  private toShopThisLook(match: CommerceOfferMatch): ShopThisLook {
    // Parsed rather than cast: a catalog row with an empty title or display name
    // would otherwise reach `ritualResponseSchema.parse` in the controller and
    // fail the entire ritual response. Here it throws into the caller's catch
    // and degrades to no CTA, which is the correct blast radius for bad operator
    // data.
    return shopThisLookSchema.parse({
      partnerId: match.partner_slug,
      partnerDisplayName: match.partner_display_name,
      offerId: match.offer_id,
      offerTitle: match.offer_title,
      garmentCategory: match.garment_category,
    })
  }
}
