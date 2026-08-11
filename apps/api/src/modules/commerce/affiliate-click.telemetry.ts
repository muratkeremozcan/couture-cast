import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  trackAffiliateCtaClicked,
  type AffiliateCtaClickedEvent,
} from '@couture/api-client'
import {
  InjectAnalyticsClient,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  buildAnalyticsSubjectId,
  requireAnalyticsIdSecret,
} from '../telemetry/telemetry.service.js'

/**
 * Emits `affiliate_cta_clicked` after a click row has committed.
 *
 * WHY THIS IS ITS OWN CLASS RATHER THAN A `TelemetryService.captureEvent` CALL.
 *
 * `captureEvent` is typed `<T extends keyof TelemetryPropertiesMap>` and its
 * validator table is exhaustive over that map, so an event name can only be
 * emitted through it once the name is registered there. Registering the two
 * server-side commerce events, and generalizing the hard-coded pseudonymous
 * branch that decides `user_id: null` and `$ip: null`, is Story 5.1 Task 5's
 * work on `telemetry.service.ts`. This class implements exactly that contract in
 * the meantime, using the same subject-id derivation so an impression, a click,
 * and a conversion all resolve to the same pseudonymous subject.
 *
 * Once Task 5 has landed, the body of {@link recordCtaClicked} collapses to a
 * single `captureEvent(userId, 'affiliate_cta_clicked', ...)`. The click service
 * and its tests do not change, which is the reason this seam exists at all.
 *
 * PRIVACY. The subject is an HMAC of the user id, never the raw id. The
 * persisted row carries `user_id: null` and the forwarded event carries
 * `$ip: null`, so neither sink can re-identify the shopper. The property
 * allowlist in `@couture/api-client` is `.strict()`, so no URL, product title,
 * or garment id can be added here by accident.
 */
export type AffiliateCtaClickedInput = Omit<
  AffiliateCtaClickedEvent,
  'analyticsSubjectId'
> & {
  readonly userId: string
}

@Injectable()
export class AffiliateClickTelemetry {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-clicks' })
  private readonly analyticsIdSecret: string

  constructor(
    @InjectAnalyticsClient() private readonly analyticsClient: AnalyticsClient,
    @Inject(PrismaClient) private readonly prisma: PrismaClient
  ) {
    this.analyticsIdSecret = requireAnalyticsIdSecret()
  }

  /**
   * Fail-open in both sinks and never rethrows. A degraded PostHog, or a
   * telemetry table under pressure, must never turn a committed commercial click
   * into a failed request: the row and the redirect are what the partner is owed,
   * and the event is a reporting convenience.
   */
  async recordCtaClicked(input: AffiliateCtaClickedInput): Promise<void> {
    try {
      const payload = trackAffiliateCtaClicked({
        analyticsSubjectId: buildAnalyticsSubjectId(input.userId, this.analyticsIdSecret),
        partnerId: input.partnerId,
        offerId: input.offerId,
        scenario: input.scenario,
        surface: input.surface,
        localeRegion: input.localeRegion,
        recommendationId: input.recommendationId,
      })

      await this.prisma.telemetryEvent
        .create({
          data: {
            user_id: null,
            event_type: payload.event,
            properties: payload.properties as Prisma.InputJsonValue,
          },
        })
        .catch((dbError: unknown) => {
          this.logger.error({ dbError }, 'affiliate_cta_clicked_persist_failed')
        })

      this.analyticsClient.capture({
        distinctId: payload.distinctId,
        event: payload.event,
        properties: { ...payload.properties, $ip: null },
      })
    } catch (error) {
      this.logger.error({ error }, 'affiliate_cta_clicked_emit_failed')
    }
  }
}
