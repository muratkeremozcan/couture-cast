import { Module } from '@nestjs/common'
import { PostHogService } from '../../posthog/posthog.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RequestAuthGuard, RolesGuard } from './security.guards'

@Module({
  controllers: [AuthController],
  providers: [AuthService, RequestAuthGuard, RolesGuard, PostHogService],
})
export class AuthModule {}
