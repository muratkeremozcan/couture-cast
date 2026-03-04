import { Module } from '@nestjs/common'
import { PostHogService } from '../../posthog/posthog.service'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import { ModerationController } from './moderation.controller'
import { ModerationService } from './moderation.service'

@Module({
  controllers: [ModerationController],
  providers: [ModerationService, RequestAuthGuard, RolesGuard, PostHogService],
})
export class ModerationModule {}
