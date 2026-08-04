import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common'
import { raw } from 'express'
import { RequestAuthGuard } from '../auth/security.guards'
import { AuthStateModule } from '../auth/auth-state.module'
import { GuardianModule } from '../guardian/guardian.module'
import { TelemetryModule } from '../telemetry/telemetry.module'
import { WardrobeController } from './wardrobe.controller'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { WardrobeService } from './wardrobe.service'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { WardrobeProcessingQueue } from './wardrobe-processing.queue'
import { WardrobeRetentionService } from './wardrobe-retention.service'
import { MAX_GARMENT_IMAGE_BYTES } from './wardrobe-image-validation'

@Module({
  imports: [AuthStateModule, GuardianModule, TelemetryModule],
  controllers: [WardrobeController],
  providers: [
    WardrobeService,
    RequestAuthGuard,
    WardrobeUploadGuard,
    SupabaseWardrobeStorageAdapter,
    WardrobeProcessingQueue,
    WardrobeRetentionService,
  ],
  exports: [WardrobeService],
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
  }
}
