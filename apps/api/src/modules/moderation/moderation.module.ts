import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import { CommunityModule } from '../community/community.module.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { ModerationController } from './moderation.controller'
import { ModerationService } from './moderation.service'
import {
  MODERATION_QUEUE_CLOCK,
  systemModerationQueueClock,
} from './moderation-decision-rules.js'
import { ModerationDecisionsController } from './moderation-decisions.controller.js'
import { ModerationDecisionsRepository } from './moderation-decisions.repository.js'
import { ModerationDecisionsService } from './moderation-decisions.service.js'
import { ModerationQueueCacheHeadersMiddleware } from './moderation-queue-cache-headers.middleware.js'
import { ModerationQueueController } from './moderation-queue.controller.js'
import { ModerationQueueRepository } from './moderation-queue.repository.js'
import { ModerationQueueService } from './moderation-queue.service.js'
import {
  ModerationAfterCommit,
  ModerationSanctionsService,
} from './moderation-sanctions.service.js'

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
  controllers: [
    ModerationController,
    ModerationQueueController,
    ModerationDecisionsController,
  ],
  providers: [
    ModerationService,
    ModerationQueueRepository,
    ModerationQueueService,
    ModerationDecisionsRepository,
    ModerationDecisionsService,
    ModerationSanctionsService,
    ModerationAfterCommit,
    { provide: MODERATION_QUEUE_CLOCK, useValue: systemModerationQueueClock },
    RequestAuthGuard,
    RolesGuard,
  ],
})
export class ModerationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ModerationQueueCacheHeadersMiddleware)
      .forRoutes(ModerationQueueController, ModerationDecisionsController)
  }
}
