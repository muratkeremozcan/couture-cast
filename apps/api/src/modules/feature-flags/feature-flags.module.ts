import { CommunityFlagEvaluationService } from './community-flag-evaluation.service.js'
import { ComplimentaryAccessService } from './complimentary-access.service.js'
import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../../analytics/analytics.module'
import { PrismaModule } from '../../prisma/prisma.module'

import { FeatureFlagsRepository } from './feature-flags.repository'
import { FeatureFlagsWarmup } from './feature-flags.warmup'
import { FeatureFlagsService } from './feature-flags.service'

@Module({
  imports: [PrismaModule, AnalyticsModule],
  providers: [
    FeatureFlagsRepository,
    FeatureFlagsService,
    FeatureFlagsWarmup,
    CommunityFlagEvaluationService,
    ComplimentaryAccessService,
  ],
  exports: [
    FeatureFlagsService,
    CommunityFlagEvaluationService,
    ComplimentaryAccessService,
  ],
})
export class FeatureFlagsModule {}
