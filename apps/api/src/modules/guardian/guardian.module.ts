import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import { GuardianController } from './guardian.controller'
import { GuardianCron } from './guardian.cron'
import { GuardianService } from './guardian.service'

@Module({
  imports: [AnalyticsModule, PrismaModule, AuthStateModule],
  controllers: [GuardianController],
  providers: [GuardianService, GuardianCron, RequestAuthGuard, RolesGuard],
})
export class GuardianModule {}
