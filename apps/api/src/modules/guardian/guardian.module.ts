import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { GuardianController } from './guardian.controller'
import { GuardianService } from './guardian.service'

@Module({
  imports: [AnalyticsModule, PrismaModule],
  controllers: [GuardianController],
  providers: [GuardianService],
})
export class GuardianModule {}
