import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module.js'
import { TelemetryModule } from '../telemetry/telemetry.module.js'
import { GuardianModule } from '../guardian/guardian.module.js'
import { WeatherModule } from '../weather/weather.module.js'
import { CommunityController } from './community.controller.js'
import { CommunityRepository } from './community.repository.js'
import { CommunityService } from './community.service.js'
import { CommunityMaintenanceService } from './community-maintenance.service.js'
import { SupabaseCommunityStorageAdapter } from './community-storage.adapter.js'
import { CommunityModerationQueue } from './community-moderation.queue.js'
import { CommunityModerationOutboxDispatcher } from './community-moderation.outbox.js'
import { CommunityModerationProcessor } from './community-moderation.processor.js'
import { CommunityModerationActionsService } from './community-moderation.actions.js'

@Module({
  imports: [
    PrismaModule,
    AuthStateModule,
    FeatureFlagsModule,
    WeatherModule,
    TelemetryModule,
    GuardianModule,
  ],
  controllers: [CommunityController],
  providers: [
    CommunityRepository,
    CommunityService,
    CommunityMaintenanceService,
    SupabaseCommunityStorageAdapter,
    CommunityModerationQueue,
    CommunityModerationOutboxDispatcher,
    CommunityModerationProcessor,
    CommunityModerationActionsService,
    RequestAuthGuard,
    RolesGuard,
  ],
  exports: [
    CommunityService,
    CommunityRepository,
    CommunityMaintenanceService,
    SupabaseCommunityStorageAdapter,
    CommunityModerationQueue,
    CommunityModerationOutboxDispatcher,
    CommunityModerationProcessor,
    CommunityModerationActionsService,
  ],
})
export class CommunityModule {}
