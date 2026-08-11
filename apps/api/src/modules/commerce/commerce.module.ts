import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { TelemetryModule } from '../telemetry/telemetry.module.js'
import { AffiliateClickController } from './affiliate-click.controller.js'
import { AffiliateClickService } from './affiliate-click.service.js'
import { AffiliateClickTelemetry } from './affiliate-click.telemetry.js'
import { AffiliateOfferService } from './affiliate-offer.service.js'
import { AffiliateWebhookController } from './affiliate-webhook.controller.js'
import { AffiliateWebhookService } from './affiliate-webhook.service.js'
import { CommerceCacheHeadersMiddleware } from './commerce-cache-headers.middleware.js'
import { CommercePreferencesController } from './commerce-preferences.controller.js'
import { CommercePreferencesService } from './commerce-preferences.service.js'
import { CommerceRepository } from './commerce.repository.js'
import { CommerceRetentionService } from './commerce-retention.service.js'

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
  imports: [
    PrismaModule,
    AuthStateModule,
    FeatureFlagsModule,
    // TelemetryModule is what supplies TelemetryService, which owns the single
    // pseudonymous emit path for both server-side commerce events. Nothing here
    // reaches ANALYTICS_CLIENT directly any more.
    TelemetryModule,
  ],
  controllers: [
    CommercePreferencesController,
    AffiliateClickController,
    // No @UseGuards on this one. It is machine-to-machine and authenticated by
    // HMAC signature over the raw request body.
    AffiliateWebhookController,
  ],
  providers: [
    AffiliateOfferService,
    // Story 5.1 Task 3 adds CommercePreferencesService, CommerceRepository,
    // and CommerceRetentionService here.
    CommercePreferencesService,
    CommerceRepository,
    CommerceRetentionService,
    RequestAuthGuard,
    // Story 5.1 Task 4 adds AffiliateClickService here.
    AffiliateClickService,
    AffiliateClickTelemetry,
    // Story 5.1 Task 5 adds AffiliateWebhookService here.
    AffiliateWebhookService,
  ],
  exports: [AffiliateOfferService],
})
export class CommerceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CommerceCacheHeadersMiddleware).forRoutes({
      path: '/api/v1/commerce{/*path}',
      method: RequestMethod.ALL,
    })
  }
}
