import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { TelemetryModule } from '../telemetry/telemetry.module.js'
import { AffiliateOfferService } from './affiliate-offer.service.js'
import { AffiliateWebhookController } from './affiliate-webhook.controller.js'
import { AffiliateWebhookService } from './affiliate-webhook.service.js'

/**
 * Story 5.1: affiliate commerce.
 *
 * DEPENDENCY DIRECTION IS ONE-WAY. `PersonalizationModule` imports this module
 * so `RitualController` can assemble the `shopThisLook` block. This module must
 * never import `PersonalizationModule` back; a cycle there would be resolvable
 * only with forwardRef, and the ritual path is the hot path in this app.
 *
 * `PersonalizationModule` currently imports none of `FeatureFlagsModule`,
 * `TelemetryModule`, or `AuthStateModule`, which is why they are imported here
 * rather than reached through it.
 *
 * NOTE ON MIDDLEWARE. `CommerceCacheHeadersMiddleware` is applied in
 * `configure(...)` over `/api/v1/commerce{/*path}` rather than as per-handler
 * `@Header` decorators. A header set after the service call is never applied
 * when the service throws, and this feature's whole point includes 403, 404,
 * 500, and 503 paths.
 */
@Module({
  imports: [PrismaModule, AuthStateModule, FeatureFlagsModule, TelemetryModule],
  // Story 5.1 Task 3 adds CommercePreferencesController here.
  // Story 5.1 Task 4 adds AffiliateClickController here.
  // Story 5.1 Task 5 adds AffiliateWebhookController here.
  controllers: [AffiliateWebhookController],
  providers: [
    AffiliateOfferService,
    // Story 5.1 Task 3 adds CommercePreferencesService, CommerceRepository,
    // and CommerceRetentionService here.
    // Story 5.1 Task 4 adds AffiliateClickService here.
    // Story 5.1 Task 5 adds AffiliateWebhookService here.
    AffiliateWebhookService,
  ],
  exports: [AffiliateOfferService],
})
export class CommerceModule {}
