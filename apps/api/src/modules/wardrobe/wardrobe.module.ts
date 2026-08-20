import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common'
import { raw } from 'express'
import { RequestAuthGuard } from '../auth/security.guards'
import { AuthStateModule } from '../auth/auth-state.module'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { GuardianModule } from '../guardian/guardian.module'
import { PersonalizationModule } from '../personalization/personalization.module'
import { TelemetryModule } from '../telemetry/telemetry.module'
import { WardrobeController } from './wardrobe.controller'
import { WardrobeCapsuleController } from './wardrobe-capsule.controller'
import { WardrobeOnboardingController } from './wardrobe-onboarding.controller'
import { WardrobeSilhouetteController } from './wardrobe-silhouette.controller'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'
import { WardrobeAccessService } from './wardrobe-access.service'
import { WardrobeCapsuleRepository } from './wardrobe-capsule.repository'
import { CapsuleTelemetryOutbox } from './wardrobe-capsule.outbox'
import { CapsuleCacheHeadersMiddleware } from './wardrobe-capsule.cache-headers.middleware'
import { WardrobeCapsuleService } from './wardrobe-capsule.service'
import { WardrobeOnboardingService } from './wardrobe-onboarding.service'
import { WardrobeSilhouetteService } from './wardrobe-silhouette.service'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { SilhouettePhotoProcessingQueue } from './silhouette-photo-processing.queue'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import { MAX_GARMENT_IMAGE_BYTES } from './wardrobe-image-validation'
import { MAX_SILHOUETTE_PHOTO_BYTES } from './wardrobe-silhouette-image-validation'

@Module({
  imports: [
    AuthStateModule,
    AnalyticsModule,
    GuardianModule,
    PersonalizationModule,
    TelemetryModule,
  ],
  controllers: [
    WardrobeController,
    WardrobeCapsuleController,
    WardrobeOnboardingController,
    WardrobeSilhouetteController,
  ],
  providers: [
    WardrobeService,
    WardrobeAccessService,
    WardrobeCapsuleRepository,
    WardrobeCapsuleService,
    WardrobeOnboardingService,
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
    WardrobeService,
    WardrobeCapsuleService,
    WardrobeOnboardingService,
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
    consumer
      .apply(
        raw({
          inflate: false,
          limit: MAX_GARMENT_IMAGE_BYTES,
          type: ['image/jpeg', 'image/png', 'image/webp'],
        })
      )
      .forRoutes({
        path: '/api/v1/wardrobe/uploads/:uploadSessionId',
        method: RequestMethod.PUT,
      })

    consumer
      .apply(
        raw({
          inflate: false,
          limit: MAX_SILHOUETTE_PHOTO_BYTES,
          type: ['image/jpeg', 'image/png', 'image/webp'],
        })
      )
      .forRoutes({
        path: '/api/v1/wardrobe/silhouette/my-form/uploads/:uploadSessionId',
        method: RequestMethod.PUT,
      })

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
      }
    )
  }
}
