import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common'
import { RequestAuthGuard } from '../auth/security.guards'
import { AuthStateModule } from '../auth/auth-state.module'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { GuardianModule } from '../guardian/guardian.module'
import { PersonalizationModule } from '../personalization/personalization.module'
import { TelemetryModule } from '../telemetry/telemetry.module'
import { WardrobeController } from './wardrobe.controller'
import { WardrobeCapsuleController } from './wardrobe-capsule.controller'
import { WardrobeGarmentRemovalController } from './wardrobe-garment-removal.controller'
import { WardrobeOnboardingController } from './wardrobe-onboarding.controller'
import { WardrobeSavedLookController } from './wardrobe-saved-look.controller'
import { WardrobeSilhouetteController } from './wardrobe-silhouette.controller'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'
import { WardrobeAccessService } from './wardrobe-access.service'
import { WardrobeCapsuleRepository } from './wardrobe-capsule.repository'
import { CapsuleTelemetryOutbox } from './wardrobe-capsule.outbox'
import { CapsuleCacheHeadersMiddleware } from './wardrobe-capsule.cache-headers.middleware'
import { WardrobeCapsuleService } from './wardrobe-capsule.service'
import { WardrobeOnboardingService } from './wardrobe-onboarding.service'
import { WardrobeSavedLookService } from './wardrobe-saved-look.service'
import { WardrobeSilhouetteService } from './wardrobe-silhouette.service'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { SilhouettePhotoProcessingQueue } from './silhouette-photo-processing.queue'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import { FlatLayController } from './flat-lay.controller'
import { FlatLayDetector } from './flat-lay-detector'
import { FlatLayService } from './flat-lay.service'

@Module({
  imports: [
    AuthStateModule,
    AnalyticsModule,
    GuardianModule,
    PersonalizationModule,
    TelemetryModule,
  ],
  controllers: [
    FlatLayController,
    WardrobeController,
    WardrobeGarmentRemovalController,
    WardrobeCapsuleController,
    WardrobeOnboardingController,
    WardrobeSavedLookController,
    WardrobeSilhouetteController,
  ],
  providers: [
    FlatLayDetector,
    FlatLayService,
    WardrobeService,
    WardrobeAccessService,
    WardrobeCapsuleRepository,
    WardrobeCapsuleService,
    WardrobeOnboardingService,
    WardrobeSavedLookService,
    WardrobeSilhouetteService,
    CapsuleTelemetryOutbox,
    RequestAuthGuard,
    WardrobeUploadGuard,
    SupabaseWardrobeStorageAdapter,
    WardrobeProcessingQueue,
    SilhouettePhotoProcessingQueue,
    WardrobeRetentionService,
  ],
  exports: [
    SupabaseWardrobeStorageAdapter,
    WardrobeService,
    WardrobeCapsuleService,
    WardrobeOnboardingService,
    WardrobeSavedLookService,
    WardrobeSilhouetteService,
    WardrobeAccessService,
    CapsuleTelemetryOutbox,
    // Exported for the worker runtime's maintenance context, which owns the
    // hourly purge sweep now that it is a BullMQ Job Scheduler rather than a
    // `@Cron` that never fired in a serverless deployment.
    WardrobeRetentionService,
  ],
})
export class WardrobeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    /**
     * Applied as middleware rather than per handler so that `Cache-Control`
     * reaches error responses too, including those raised by guards and by
     * request validation before the handler runs. Reused as-is (not
     * reimplemented) for the Story 4.4 onboarding and silhouette routes,
     * which carry the same private-wardrobe-data requirement.
     */
    consumer.apply(CapsuleCacheHeadersMiddleware).forRoutes(
      {
        path: '/api/v1/wardrobe/:ownerUserId/capsules{/*path}',
        method: RequestMethod.ALL,
      },
      {
        path: '/api/v1/wardrobe/onboarding{/*path}',
        method: RequestMethod.ALL,
      },
      {
        path: '/api/v1/wardrobe/silhouette{/*path}',
        method: RequestMethod.ALL,
      },
      {
        path: '/api/v1/wardrobe/saved-looks{/*path}',
        method: RequestMethod.ALL,
      }
    )
  }
}
