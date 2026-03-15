import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import { ModerationController } from './moderation.controller'
import { ModerationService } from './moderation.service'

@Module({
  imports: [AnalyticsModule],
  controllers: [ModerationController],
  providers: [ModerationService, RequestAuthGuard, RolesGuard],
})
export class ModerationModule {}
