import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import { CommunityModule } from '../community/community.module.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { ModerationController } from './moderation.controller'
import { ModerationService } from './moderation.service'
import { ModerationQueueCacheHeadersMiddleware } from './moderation-queue-cache-headers.middleware.js'
import { ModerationQueueController } from './moderation-queue.controller.js'
import { ModerationQueueRepository } from './moderation-queue.repository.js'
import {
  MODERATION_QUEUE_CLOCK,
  ModerationQueueService,
  systemModerationQueueClock,
} from './moderation-queue.service.js'

@Module({
  // CommunityModule supplies the storage adapter that signs case images. It does not
  // re-export FeatureFlagsModule, so the flag service is imported here directly.
  imports: [
    AnalyticsModule,
    AuthStateModule,
    PrismaModule,
    CommunityModule,
    FeatureFlagsModule,
  ],
  controllers: [ModerationController, ModerationQueueController],
  providers: [
    ModerationService,
    ModerationQueueRepository,
    ModerationQueueService,
    { provide: MODERATION_QUEUE_CLOCK, useValue: systemModerationQueueClock },
    RequestAuthGuard,
    RolesGuard,
  ],
})
export class ModerationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ModerationQueueCacheHeadersMiddleware)
      .forRoutes(ModerationQueueController)
  }
}
