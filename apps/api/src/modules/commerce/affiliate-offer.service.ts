import { Injectable } from '@nestjs/common'
import type { ShopThisLook } from '../../contracts/http.js'

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

@Injectable()
export class AffiliateOfferService {
  /**
   * Returns one entry per outfit id, in the same order as the input.
   *
   * NOT YET IMPLEMENTED. This foundation commit establishes the assembly seam
   * and the contract shape; story 5.1 Task 3 replaces the body with the
   * decision-4 eligibility chain (feature flag, then stored preference, then
   * offer selection) and the slot derivation that feeds it.
   *
   * Returning null for every outfit is the correct behaviour until then: it is
   * exactly what the eligibility chain produces when `commerce_affiliate_enabled`
   * resolves false, which is its code default in every environment.
   */
  resolveShopThisLook(
    input: ResolveShopThisLookInput
  ): Promise<ReadonlyMap<string, ShopThisLook | null>> {
    // Returns a resolved promise rather than being declared `async`, only
    // because there is nothing to await yet. Task 3 adds `async` back along with
    // the flag read, the preference read, and the offer query.
    return Promise.resolve(new Map(input.outfits.map((outfit) => [outfit.id, null])))
  }
}
