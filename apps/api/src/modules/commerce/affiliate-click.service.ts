import { randomUUID } from 'node:crypto'
import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_INVALID_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  scenarioNameSchema,
  type AffiliateClickRequest,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  isAffiliateAudienceEligible,
  resolveLocaleRegion,
} from './affiliate-offer.service.js'
import { buildAffiliateRedirectUrl } from './affiliate-deep-link.js'
import { AffiliateClickTelemetry } from './affiliate-click.telemetry.js'
import { mintClickToken, requireClickTokenSecret } from './commerce-click-token.js'
import {
  CommerceRepository,
  type CommerceClickOffer,
  type CommerceClickRow,
} from './commerce.repository.js'

export type RecordAffiliateClickInput = AffiliateClickRequest & {
  readonly userId: string
  readonly acceptLanguage?: string | undefined
}

export type RecordAffiliateClickResult = {
  readonly redirectUrl: string
  /** True on a fresh mint (201), false on a deduped replay (200). */
  readonly created: boolean
}

/**
 * The scenario stored on a click whose recommendation could not be resolved.
 *
 * Decision 7 forbids failing a click because the recommendation rotated behind
 * the cache, and `AffiliateClick.scenario` is a non-null column, so the row
 * still has to say something. It says this, and the analytics event is skipped
 * for that click rather than being emitted with an invented scenario: the click
 * record is the commercial fact and must survive, while the event is a reporting
 * convenience whose `scenario` property is a closed enum.
 */
const UNRESOLVED_SCENARIO = 'unknown'

/**
 * Story 5.1 Task 4: the attributed click endpoint's rules.
 *
 * The evaluation order below is fixed by decision 9 and is the reason status
 * assertions in this feature are deterministic: 503 (feature disabled), then 403
 * (audience), then 403 (opted out), then 404 (unknown, inactive, or
 * out-of-window offer), then 500 (invalid resolved URL). The kill switch
 * outranks everything, because a disabled feature must report as disabled rather
 * than as a permission problem the user could try to fix.
 */
@Injectable()
export class AffiliateClickService {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-clicks' })
  private readonly clickTokenSecret: string

  constructor(
    @Inject(FeatureFlagsService)
    private readonly featureFlags: FeatureFlagsService,
    @Inject(CommerceRepository)
    private readonly repository: CommerceRepository,
    @Inject(AffiliateClickTelemetry)
    private readonly telemetry: AffiliateClickTelemetry
  ) {
    // Resolved once at construction, exactly as the upload-token path does, so a
    // missing production secret fails at boot rather than on the first click.
    this.clickTokenSecret = requireClickTokenSecret()
  }

  async recordClick(
    input: RecordAffiliateClickInput
  ): Promise<RecordAffiliateClickResult> {
    // A truthiness check rather than `!== true`: `FeatureFlagValue` resolves to
    // the literal type of the flag's `defaultValue`, so this key is statically
    // `false` even though it is `boolean` at runtime.
    const flagEnabled = await this.featureFlags.getFeatureFlag(
      'commerce_affiliate_enabled',
      input.userId
    )
    if (!flagEnabled) {
      throw new ServiceUnavailableException(COMMERCE_DISABLED_MESSAGE)
    }

    const [userContext, storedPreference] = await Promise.all([
      this.repository.findUserCommerceContext(input.userId),
      this.repository.findAffiliateCtasEnabled(input.userId),
    ])

    if (!isAffiliateAudienceEligible(userContext)) {
      throw new ForbiddenException(COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE)
    }

    if (storedPreference === false) {
      throw new ForbiddenException(COMMERCE_OPTED_OUT_MESSAGE)
    }

    /**
     * The offer is re-checked for status and window; the outfit is deliberately
     * NOT re-derived. The recommendation the CTA was rendered on may be minutes
     * old and served from a device cache, so re-running slot matching would
     * reject a genuine tap because the server rotated the outfit behind it.
     */
    const offer = await this.repository.findActiveClickOffer(input.offerId)
    if (!offer) {
      throw new NotFoundException(COMMERCE_OFFER_NOT_FOUND_MESSAGE)
    }

    const existing = await this.repository.findRecentClick(
      input.userId,
      input.offerId,
      input.recommendationId
    )
    if (existing) {
      // A deduped replay emits no second analytics event, by design: two taps
      // inside a minute are one intent, and double-counting them would inflate
      // the PRD's click-through metric.
      return {
        redirectUrl: this.resolveRedirectUrl(offer, existing.token),
        created: false,
      }
    }

    const localeRegion = resolveLocaleRegion({
      savedLocale: userContext.locale,
      acceptLanguage: input.acceptLanguage,
    })
    const scenario = await this.repository.findRecommendationScenario(
      input.userId,
      input.recommendationId
    )

    const clickId = randomUUID()
    const token = mintClickToken(clickId, this.clickTokenSecret)
    // Built and validated BEFORE the insert. An offer whose resolved URL fails
    // validation must create no click row at all, so the check cannot come after
    // the write.
    const redirectUrl = this.resolveRedirectUrl(offer, token)

    const click = await this.insertClick({
      id: clickId,
      token,
      userId: input.userId,
      offerId: offer.offer_id,
      partnerId: offer.partner_id,
      recommendationId: input.recommendationId,
      scenario: scenario ?? UNRESOLVED_SCENARIO,
      surface: input.surface,
      localeRegion,
    })

    if (click.id !== clickId) {
      // The unique dedupe index rejected this insert and the winner's row was
      // re-read. That is a deduped replay, not a fresh mint.
      return { redirectUrl: this.resolveRedirectUrl(offer, click.token), created: false }
    }

    // After the row commits, and fail-open: a degraded PostHog must never drop a
    // commercial click record. There is no telemetry-claim row here and no
    // rollback on telemetry failure.
    const analyticsScenario = scenarioNameSchema.safeParse(scenario)
    if (analyticsScenario.success) {
      await this.telemetry.recordCtaClicked({
        userId: input.userId,
        partnerId: offer.partner_slug,
        offerId: offer.offer_id,
        scenario: analyticsScenario.data,
        surface: input.surface,
        localeRegion,
        recommendationId: input.recommendationId,
      })
    } else {
      this.logger.warn(
        { recommendationId: input.recommendationId },
        'affiliate_cta_clicked_scenario_unresolved'
      )
    }

    return { redirectUrl, created: true }
  }

  /**
   * Bad catalog data is an operator error surfaced as a user-visible failure.
   * There is no partner feed and no validation job in this story, so a neutral
   * fallback card would be a fiction; the request fails with 500, the client
   * shows its localized generic error, and the reason is logged for whoever owns
   * the catalog row.
   */
  private resolveRedirectUrl(offer: CommerceClickOffer, token: string): string {
    const result = buildAffiliateRedirectUrl(
      offer.deep_link_template,
      offer.allowed_host,
      token
    )

    if (!result.ok) {
      // The rejection reason is logged; the template, the resolved URL, and the
      // token are not. A click token in a log line is a bearer credential for
      // conversion attribution.
      this.logger.error(
        {
          offerId: offer.offer_id,
          partnerId: offer.partner_slug,
          reason: result.reason,
        },
        'affiliate_offer_redirect_invalid'
      )
      throw new InternalServerErrorException(COMMERCE_OFFER_INVALID_MESSAGE)
    }

    return result.url
  }

  /**
   * Inserts the click, and on a lost race against
   * `AffiliateClick_dedupe_minute_key` re-reads the row that won.
   *
   * The index is a concurrency backstop rather than the product rule: it buckets
   * by minute, so 10:00:59 and 10:01:01 land in different buckets and both
   * insert, which is correct because the service's own 60-second check is what
   * decides the window. What the index guarantees is that two simultaneous taps
   * cannot both create a row.
   */
  private async insertClick(
    input: Parameters<CommerceRepository['createClick']>[0]
  ): Promise<CommerceClickRow> {
    try {
      return await this.repository.createClick(input)
    } catch (error: unknown) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error
      }

      const winner = await this.repository.findLatestClick(
        input.userId,
        input.offerId,
        input.recommendationId
      )
      if (!winner) {
        // The conflict was real but the winning row is gone. Rethrowing is the
        // honest outcome: inventing a second row would defeat the index.
        throw error
      }
      return winner
    }
  }
}
