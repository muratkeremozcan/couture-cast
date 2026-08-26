import { Inject, Injectable } from '@nestjs/common'
import {
  type AdvisorOfferClickedEvent,
  type AffiliateCtaClickedEvent,
} from '@couture/api-client'
import { createBaseLogger } from '../../logger/pino.config.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'

/**
 * Emits `affiliate_cta_clicked` after a click row has committed.
 *
 * WHY THIS CLASS STILL EXISTS AFTER TASK 5.
 *
 * It was originally a standalone emitter, because `captureEvent` is typed
 * `<T extends keyof TelemetryPropertiesMap>` and could not accept an event name
 * that Task 5 had not yet registered. Task 5 registered it, so the body is now
 * a single delegating call and the duplicate HMAC-and-persist implementation is
 * gone: story 5.1 decision 12 exists specifically to keep one pseudonymous
 * path, and shipping two would have been the thing it argues against.
 *
 * The class is kept rather than inlined so `AffiliateClickService` and its tests
 * are unchanged, and so the one caller keeps a name that says what it does.
 *
 * PRIVACY, now enforced centrally by `TelemetryService`: the subject is an HMAC
 * of the user id, never the raw id; the persisted row carries `user_id: null`
 * and the forwarded event carries `$ip: null`. The property allowlist in
 * `@couture/api-client` is `.strict()`, so no URL, product title, or garment id
 * can be attached here by accident.
 */
export type AffiliateCtaClickedInput = Omit<
  AffiliateCtaClickedEvent,
  'analyticsSubjectId'
> & {
  readonly userId: string
}

/** Story 5.4: the advisor branch's own input shape, same pattern as {@link AffiliateCtaClickedInput}. */
export type AdvisorOfferClickedInput = Omit<
  AdvisorOfferClickedEvent,
  'analyticsSubjectId'
> & {
  readonly userId: string
}

@Injectable()
export class AffiliateClickTelemetry {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-clicks' })

  constructor(
    @Inject(TelemetryService) private readonly telemetryService: TelemetryService
  ) {}

  /**
   * Fail-open and never rethrows. A degraded PostHog, or a telemetry table under
   * pressure, must never turn a committed commercial click into a failed
   * request: the row and the redirect are what the partner is owed, and the
   * event is a reporting convenience.
   *
   * `captureEvent` is already fail-open across both sinks. This catch covers the
   * one thing it is not: a property that fails its own `.strict()` allowlist
   * throws synchronously out of the validator, before either sink is touched.
   */
  async recordCtaClicked(input: AffiliateCtaClickedInput): Promise<void> {
    const { userId, ...properties } = input

    try {
      await this.telemetryService.captureEvent(
        userId,
        'affiliate_cta_clicked',
        properties
      )
    } catch (error) {
      this.logger.error({ error }, 'affiliate_cta_clicked_emit_failed')
    }
  }

  /**
   * Story 5.4 Decision 7: the advisor branch's own emission, parallel to
   * {@link recordCtaClicked}. An advisor click has no `ScenarioOutfit`, so it
   * carries no `scenario`/`localeRegion`/`recommendationId` properties --
   * `advisorSlot` and `platform` are what make it reportable instead.
   */
  async recordAdvisorOfferClicked(input: AdvisorOfferClickedInput): Promise<void> {
    const { userId, ...properties } = input

    try {
      await this.telemetryService.captureEvent(
        userId,
        'advisor_offer_clicked',
        properties
      )
    } catch (error) {
      this.logger.error({ error }, 'advisor_offer_clicked_emit_failed')
    }
  }
}
