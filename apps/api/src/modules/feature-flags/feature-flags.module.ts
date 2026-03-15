import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { PostHogService } from '../../posthog/posthog.service'

import { FeatureFlagsCron } from './feature-flags.cron'
import { FeatureFlagsRepository } from './feature-flags.repository'
import { FeatureFlagsService } from './feature-flags.service'

@Module({
  imports: [PrismaModule],
  providers: [
    FeatureFlagsRepository,
    FeatureFlagsService,
    FeatureFlagsCron,
    PostHogService,
  ],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
