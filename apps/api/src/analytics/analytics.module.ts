import { Module } from '@nestjs/common'
import { REMOTE_FEATURE_FLAG_PROVIDER } from '../modules/feature-flags/remote-feature-flag-provider'
import { PostHogService } from '../posthog/posthog.service'
import { ANALYTICS_CLIENT } from './analytics.service'

@Module({
  providers: [
    PostHogService,
    {
      provide: ANALYTICS_CLIENT,
      useExisting: PostHogService,
    },
    {
      provide: REMOTE_FEATURE_FLAG_PROVIDER,
      useExisting: PostHogService,
    },
  ],
  exports: [PostHogService, ANALYTICS_CLIENT, REMOTE_FEATURE_FLAG_PROVIDER],
})
export class AnalyticsModule {}
