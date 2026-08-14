import { Inject, Injectable } from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type GarmentCategory,
  type GarmentComfortRange,
} from '@prisma/client'

/**
 * Story 5.1: every database access the commerce module makes.
 *
 * Two of these queries are raw SQL rather than Prisma delegates, and both for
 * reasons the query builder cannot express:
 *
 *   * Offer selection orders by `(comfort_range IS NULL) ASC` so an exact
 *     comfort-range match beats a wildcard row regardless of priority. Prisma's
 *     `orderBy` has no expression form, and dropping that leg would silently
 *     turn "exactness beats priority" into "priority wins", which no unit test
 *     of the delegate call would catch.
 *   * Both the offer window and the click dedupe window read the database's own
 *     `now()` inside the same statement. Comparing against a JavaScript `new
 *     Date()` would put the boundary on the API process's clock, so the 59-second
 *     and 60.000-second dedupe cases would be decided by clock skew rather than
 *     by the rule.
 *
 * EVERY CLOCK COMPARISON BELOW IS `now() AT TIME ZONE 'UTC'`, NEVER BARE `now()`.
 *
 * `effective_from`, `effective_to`, and `created_at` are all
 * `timestamp without time zone`, and Prisma writes them as UTC instants. `now()`
 * returns `timestamptz`. PostgreSQL resolves a comparison between the two by
 * reading the naive side in the SESSION time zone, so on any server whose
 * TimeZone is not UTC every window boundary silently shifts by that offset. On
 * the local Supabase container, whose session TimeZone is America/Chicago, that
 * is five to six hours: a partner window scheduled to open at midnight UTC would
 * open five hours late, and the 60-second dedupe window would never match.
 *
 * `now() AT TIME ZONE 'UTC'` yields a naive timestamp whose wall-clock reading
 * IS the UTC instant, which is the same frame the columns were written in. Do not
 * simplify these back to bare `now()`.
 */

/** One `(category, comfortRange)` pair derived from an outfit's garment list. */
export type CommerceOfferSlot = {
  readonly category: GarmentCategory
  readonly comfortRange: GarmentComfortRange | null
}

/** The profile facts the eligibility chain and the click endpoint read. */
export type CommerceUserContext = {
  readonly birthdate: Date | null
  readonly locale: string | undefined
}

export type CommerceGarmentRow = {
  readonly id: string
  readonly category: GarmentCategory | null
  readonly comfort_range: GarmentComfortRange | null
}

/** The winning offer for one outfit, joined to the partner that owns it. */
export type CommerceOfferMatch = {
  readonly offer_id: string
  readonly offer_title: string
  readonly garment_category: GarmentCategory
  readonly partner_slug: string
  readonly partner_display_name: string
}

/**
 * Everything the click endpoint needs to build and validate an outbound URL.
 * `allowed_host` and `deep_link_template` are loaded together because
 * validating one without the other is meaningless.
 */
export type CommerceClickOffer = {
  readonly offer_id: string
  readonly partner_id: string
  readonly partner_slug: string
  readonly partner_display_name: string
  readonly allowed_host: string
  readonly deep_link_template: string
}

export type CommerceClickRow = {
  readonly id: string
  readonly token: string
  readonly offer_id: string
}

export type CreateAffiliateClickInput = {
  readonly id: string
  readonly token: string
  readonly userId: string
  readonly offerId: string
  readonly partnerId: string
  readonly recommendationId: string
  readonly scenario: string
  readonly surface: string
  readonly localeRegion: string
}

@Injectable()
export class CommerceRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  // --- Preferences ---------------------------------------------------------

  async findAffiliateCtasEnabled(userId: string): Promise<boolean | null> {
    const row = await this.prisma.commercePreference.findUnique({
      where: { user_id: userId },
      select: { affiliate_ctas_enabled: true },
    })
    // Null means "no stored row", which the caller reads as the default `true`.
    // Returning `true` here instead would erase the distinction the audit path
    // needs to decide whether a value actually changed.
    return row?.affiliate_ctas_enabled ?? null
  }

  /**
   * Writes the preference and its audit row in one transaction, and only when
   * the effective value actually changes.
   *
   * The read happens inside the transaction so two concurrent toggles cannot
   * both observe the old value and both write an audit row for the same
   * transition.
   */
  async setAffiliateCtasEnabled(
    userId: string,
    enabled: boolean,
    ipAddress: string | undefined
  ): Promise<{ affiliateCtasEnabled: boolean; auditWritten: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.commercePreference.findUnique({
        where: { user_id: userId },
        select: { affiliate_ctas_enabled: true },
      })
      const current = existing?.affiliate_ctas_enabled ?? true

      if (current === enabled) {
        // Unchanged: no preference row, no audit row, still a 200 carrying the
        // current state. Materializing a row that merely restates the column
        // default would add a write and change nothing observable.
        return { affiliateCtasEnabled: current, auditWritten: false }
      }

      await tx.commercePreference.upsert({
        where: { user_id: userId },
        create: { user_id: userId, affiliate_ctas_enabled: enabled },
        update: { affiliate_ctas_enabled: enabled },
      })

      await tx.auditLog.create({
        data: {
          user_id: userId,
          event_type: 'commerce_affiliate_opt_out_changed',
          event_data: { enabled },
          ip_address: ipAddress ?? null,
        },
      })

      return { affiliateCtasEnabled: enabled, auditWritten: true }
    })
  }

  // --- Slot derivation -----------------------------------------------------

  /**
   * One batched read for every real garment id across all three scenario
   * outfits. Scoped to the acting user so a caller cannot learn another user's
   * garment categories by pasting their ids into a recommendation.
   */
  async findGarmentSlots(
    userId: string,
    garmentIds: readonly string[]
  ): Promise<readonly CommerceGarmentRow[]> {
    if (garmentIds.length === 0) {
      return []
    }
    return this.prisma.garmentItem.findMany({
      where: { id: { in: [...garmentIds] }, user_id: userId },
      select: { id: true, category: true, comfort_range: true },
    })
  }

  /**
   * The two profile facts commerce reads, in one query.
   *
   * `birthdate` is loaded for {@link isAffiliateAudienceEligible}, which always
   * returns true today. It is read anyway so that reversing decision 1 stays a
   * change to that one predicate rather than a change to the query, the
   * repository interface, and every call site.
   */
  async findUserCommerceContext(userId: string): Promise<CommerceUserContext> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { user_id: userId },
      select: { preferences: true, birthdate: true },
    })
    const preferences = profile?.preferences
    const locale =
      preferences &&
      typeof preferences === 'object' &&
      !Array.isArray(preferences) &&
      'locale' in preferences &&
      typeof preferences.locale === 'string'
        ? preferences.locale
        : undefined

    return { birthdate: profile?.birthdate ?? null, locale }
  }

  /**
   * The scenario the CTA was rendered under, scoped to the acting user so a
   * caller cannot read another user's recommendation by pasting its id.
   *
   * `ScenarioOutfit.id` is `OutfitRecommendation.id`, which is why this resolves
   * at all. It returns null rather than throwing for a recommendation that has
   * since been replaced: decision 7 is explicit that a click must not fail
   * because the recommendation rotated behind the cache.
   */
  async findRecommendationScenario(
    userId: string,
    recommendationId: string
  ): Promise<string | null> {
    const recommendation = await this.prisma.outfitRecommendation.findFirst({
      where: { id: recommendationId, user_id: userId },
      select: { scenario: true },
    })
    return recommendation?.scenario ?? null
  }

  // --- Offer selection -----------------------------------------------------

  /**
   * The single offer for one outfit, or null.
   *
   * The ordering is total on purpose. `(comfort_range IS NULL) ASC` puts exact
   * matches first, `priority DESC` ranks within each group, and `id ASC` breaks
   * every remaining tie. Without that last leg two equally ranked rows return in
   * whatever order the plan happens to produce, which makes attribution
   * incomparable between two requests for the same outfit and makes every E2E
   * assertion on `offerId` flaky.
   */
  async findBestOffer(
    slots: readonly CommerceOfferSlot[],
    localeRegion: string
  ): Promise<CommerceOfferMatch | null> {
    if (slots.length === 0) {
      return null
    }

    const slotClauses = slots.map(
      (slot) => Prisma.sql`(
        o."garment_category" = ${slot.category}::"GarmentCategory"
        AND (
          o."comfort_range" = ${slot.comfortRange}::"GarmentComfortRange"
          OR o."comfort_range" IS NULL
        )
      )`
    )

    const rows = await this.prisma.$queryRaw<CommerceOfferMatch[]>(Prisma.sql`
      SELECT o."id"             AS offer_id,
             o."title"          AS offer_title,
             o."garment_category" AS garment_category,
             p."slug"           AS partner_slug,
             p."display_name"   AS partner_display_name
      FROM "AffiliateOffer" o
      JOIN "CommercePartner" p ON p."id" = o."partner_id"
      WHERE o."status" = 'active'::"AffiliateOfferStatus"
        -- The PARTNER must be active too, not only the offer.
        --
        -- Decision 4 enumerates the offer-level predicate and says nothing about
        -- partner status, but leaving it out makes CommercePartner.status
        -- mean one thing on the webhook (decision 8 rejects an inactive partner
        -- outright) and nothing at all on the CTA path. The operator runbook
        -- deactivates a partner by setting exactly this column, so without this
        -- line pausing a partner keeps serving its CTAs until someone remembers
        -- to deactivate every offer row by hand.
        AND p."status" = 'active'::"CommercePartnerStatus"
        -- Story 5.1 decision 4: '*' on a CATALOG ROW means "published globally"
        -- and matches every request region. Matching only exactly would make the
        -- entire seeded catalog from decision 14 unreachable, because it is
        -- published at '*' while any real user resolves to a country subtag, and
        -- that would leave AC 1's positive path undemonstrable anywhere.
        --
        -- '*' also arrives as the REQUEST region when no locale resolves, which
        -- the first branch already covers.
        AND (o."locale_region" = ${localeRegion} OR o."locale_region" = '*')
        AND o."effective_from" <= (now() AT TIME ZONE 'UTC')
        AND (o."effective_to" IS NULL OR (now() AT TIME ZONE 'UTC') < o."effective_to")
        AND (${Prisma.join(slotClauses, ' OR ')})
      ORDER BY (o."comfort_range" IS NULL) ASC,
               o."priority" DESC,
               o."id" ASC
      LIMIT 1
    `)

    return rows[0] ?? null
  }

  /**
   * The click endpoint's own offer lookup. It re-checks status and window
   * because the recommendation the CTA was rendered on may be minutes old and
   * served from a cache, so the offer that was live at render time may not be
   * live now.
   *
   * It deliberately does NOT re-derive the outfit or re-check the slot match:
   * the recommendation may have rotated behind the cache, and failing a click
   * for that would punish a user for a server-side rotation they cannot see.
   */
  async findActiveClickOffer(offerId: string): Promise<CommerceClickOffer | null> {
    const rows = await this.prisma.$queryRaw<CommerceClickOffer[]>(Prisma.sql`
      SELECT o."id"             AS offer_id,
             p."id"             AS partner_id,
             p."slug"           AS partner_slug,
             p."display_name"   AS partner_display_name,
             p."allowed_host"   AS allowed_host,
             o."deep_link_template" AS deep_link_template
      FROM "AffiliateOffer" o
      JOIN "CommercePartner" p ON p."id" = o."partner_id"
      WHERE o."id" = ${offerId}
        AND o."status" = 'active'::"AffiliateOfferStatus"
        -- Same rule as offer selection: a deactivated partner cannot be clicked
        -- through to, even via an offer id a client is still holding.
        AND p."status" = 'active'::"CommercePartnerStatus"
        AND o."effective_from" <= (now() AT TIME ZONE 'UTC')
        AND (o."effective_to" IS NULL OR (now() AT TIME ZONE 'UTC') < o."effective_to")
      LIMIT 1
    `)

    return rows[0] ?? null
  }

  // --- Clicks --------------------------------------------------------------

  /**
   * The 60-second product rule, evaluated on the database clock.
   *
   * `created_at > now() - interval '60 seconds'` is strictly greater, so a click
   * at exactly 60.000 seconds is a miss and mints a fresh row. That boundary is
   * asserted on both sides, which is why it is stated as an interval here rather
   * than as a JavaScript timestamp computed by the caller.
   */
  async findRecentClick(
    userId: string,
    offerId: string,
    recommendationId: string
  ): Promise<CommerceClickRow | null> {
    const rows = await this.prisma.$queryRaw<CommerceClickRow[]>(Prisma.sql`
      SELECT "id", "token", "offer_id"
      FROM "AffiliateClick"
      WHERE "user_id" = ${userId}
        AND "offer_id" = ${offerId}
        AND "recommendation_id" = ${recommendationId}
        AND "created_at" > (now() AT TIME ZONE 'UTC') - interval '60 seconds'
      ORDER BY "created_at" DESC
      LIMIT 1
    `)

    return rows[0] ?? null
  }

  /**
   * Re-read after an insert lost the race on `AffiliateClick_dedupe_minute_key`.
   *
   * This ignores the 60-second window and takes the newest row for the triple,
   * because the only way to reach it is a unique-index conflict, and the row
   * that caused the conflict is by definition in the same minute bucket and
   * therefore under a minute old.
   */
  async findLatestClick(
    userId: string,
    offerId: string,
    recommendationId: string
  ): Promise<CommerceClickRow | null> {
    const row = await this.prisma.affiliateClick.findFirst({
      where: {
        user_id: userId,
        offer_id: offerId,
        recommendation_id: recommendationId,
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, token: true, offer_id: true },
    })
    return row
  }

  /**
   * The id and its token are both supplied by the caller rather than defaulted
   * by the database, because the token is an HMAC over the id: computing it
   * requires knowing the id first, and a create-then-update would leave a
   * tokenless row visible to a concurrent reader.
   */
  async createClick(input: CreateAffiliateClickInput): Promise<CommerceClickRow> {
    const click = await this.prisma.affiliateClick.create({
      data: {
        id: input.id,
        token: input.token,
        user_id: input.userId,
        offer_id: input.offerId,
        partner_id: input.partnerId,
        recommendation_id: input.recommendationId,
        scenario: input.scenario,
        surface: input.surface,
        locale_region: input.localeRegion,
      },
      select: { id: true, token: true, offer_id: true },
    })
    return click
  }

  // --- Retention -----------------------------------------------------------

  async findExpiredConversionIds(
    cutoff: Date,
    limit: number
  ): Promise<readonly string[]> {
    const rows = await this.prisma.affiliateConversion.findMany({
      where: { received_at: { lt: cutoff } },
      select: { id: true },
      orderBy: { received_at: 'asc' },
      take: limit,
    })
    return rows.map((row) => row.id)
  }

  async deleteConversionsByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0
    }
    const result = await this.prisma.affiliateConversion.deleteMany({
      where: { id: { in: [...ids] } },
    })
    return result.count
  }

  async findExpiredClickIds(cutoff: Date, limit: number): Promise<readonly string[]> {
    const rows = await this.prisma.affiliateClick.findMany({
      where: { created_at: { lt: cutoff } },
      select: { id: true },
      orderBy: { created_at: 'asc' },
      take: limit,
    })
    return rows.map((row) => row.id)
  }

  async deleteClicksByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0
    }
    const result = await this.prisma.affiliateClick.deleteMany({
      where: { id: { in: [...ids] } },
    })
    return result.count
  }

  /**
   * Story 5.2: BillingEvent shares the 24-month commerce horizon (Open
   * question 4's sign-off). The append-only trigger blocks UPDATE, not DELETE
   * — deliberately, exactly so this pruner can run. Rows still owing a
   * forward (`forward_due` unmet) are never pruned regardless of age: an
   * unmet payment obligation must not age out of existence.
   */
  async findExpiredBillingEventIds(
    cutoff: Date,
    limit: number
  ): Promise<readonly string[]> {
    const rows = await this.prisma.billingEvent.findMany({
      where: {
        received_at: { lt: cutoff },
        NOT: { forward_due: true, forwarded_at: null },
      },
      select: { id: true },
      orderBy: { received_at: 'asc' },
      take: limit,
    })
    return rows.map((row) => row.id)
  }

  async deleteBillingEventsByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0
    }
    const result = await this.prisma.billingEvent.deleteMany({
      where: { id: { in: [...ids] } },
    })
    return result.count
  }
}
