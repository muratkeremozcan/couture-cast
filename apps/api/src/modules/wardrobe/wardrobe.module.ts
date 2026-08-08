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
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'
import { WardrobeAccessService } from './wardrobe-access.service'
import { WardrobeCapsuleRepository } from './wardrobe-capsule.repository'
import { CapsuleTelemetryOutbox } from './wardrobe-capsule.outbox'
import { CapsuleCacheHeadersMiddleware } from './wardrobe-capsule.cache-headers.middleware'
import { WardrobeCapsuleService } from './wardrobe-capsule.service'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import { MAX_GARMENT_IMAGE_BYTES } from './wardrobe-image-validation'

@Module({
  imports: [
    AuthStateModule,
    AnalyticsModule,
    GuardianModule,
    PersonalizationModule,
    TelemetryModule,
  ],
  controllers: [WardrobeController, WardrobeCapsuleController],
  providers: [
    WardrobeService,
    WardrobeAccessService,
    WardrobeCapsuleRepository,
    WardrobeCapsuleService,
    CapsuleTelemetryOutbox,
    RequestAuthGuard,
    WardrobeUploadGuard,
    SupabaseWardrobeStorageAdapter,
    WardrobeProcessingQueue,
    WardrobeRetentionService,
  ],
  exports: [
    WardrobeService,
    WardrobeCapsuleService,
    WardrobeAccessService,
    CapsuleTelemetryOutbox,
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

    /**
     * Applied as middleware rather than per handler so that `Cache-Control`
     * reaches error responses too, including those raised by guards and by
     * request validation before the handler runs.
     */
    consumer.apply(CapsuleCacheHeadersMiddleware).forRoutes({
      path: '/api/v1/wardrobe/:ownerUserId/capsules{/*path}',
      method: RequestMethod.ALL,
    })
  }
}
