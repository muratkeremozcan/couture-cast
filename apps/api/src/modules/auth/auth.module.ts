import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from './auth-state.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RequestAuthGuard, RolesGuard } from './security.guards'
import { TelemetryModule } from '../telemetry/telemetry.module'

@Module({
  imports: [AnalyticsModule, PrismaModule, AuthStateModule, TelemetryModule],
  controllers: [AuthController],
  providers: [AuthService, RequestAuthGuard, RolesGuard],
})
export class AuthModule {}
