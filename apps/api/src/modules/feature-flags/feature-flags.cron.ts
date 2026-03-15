import { Injectable, OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createBaseLogger } from '../../logger/pino.config'

import { FeatureFlagsService } from './feature-flags.service'

/** Story 0.7 Task 8 owner file: cache warming and refresh for the fallback store.
 * Why this file exists:
 * - Step 3 only helps if the database cache already has something useful in it.
 * - Startup warmup plus periodic refresh keeps that cache trustworthy.
 * Alternatives:
 * - Startup-only sync, which becomes stale.
 * - Cron-only sync, which leaves fresh environments wrong for the first few minutes.
 * Ownership anchor:
 * - Story 0.7 Task 8 step 4 owner: warm and refresh the fallback cache so step 3 usually returns a real last-known value.
 * Flow refs:
 * - S0.7/T8/3: requests fall back to the database cache when the remote provider has no answer.
 */
@Injectable()
export class FeatureFlagsCron implements OnModuleInit {
  private readonly logger = createBaseLogger().child({ feature: 'feature-flags' })

  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  async onModuleInit() {
    // Flow ref S0.7/T8/4: startup warmup closes the gap between "app booted"
    // and "first cron tick".
    await this.syncFeatureFlags()
  }

  @Cron('*/5 * * * *')
  async syncFeatureFlags() {
    try {
      // Flow ref S0.7/T8/4: periodic refresh keeps rollout changes flowing into
      // the fallback cache.
      const result = await this.featureFlagsService.syncFlags()
      // Flow ref S0.7/T8/4: log outcomes centrally so observability can tell us
      // whether cache warming is healthy.
      this.logger.info(result, 'feature_flags_sync_completed')
    } catch (error) {
      this.logger.error({ err: error }, 'feature_flags_sync_failed')
    }
  }
}
