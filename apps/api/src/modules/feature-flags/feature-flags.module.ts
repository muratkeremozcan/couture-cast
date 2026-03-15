import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module'

import { FeatureFlagsCron } from './feature-flags.cron'
import { FeatureFlagsRepository } from './feature-flags.repository'
import { FeatureFlagsService } from './feature-flags.service'

@Module({
  imports: [PrismaModule, AnalyticsModule],
  providers: [FeatureFlagsRepository, FeatureFlagsService, FeatureFlagsCron],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
