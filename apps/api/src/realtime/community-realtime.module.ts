import { Module } from '@nestjs/common'
import { AuthStateModule } from '../modules/auth/auth-state.module.js'
import { guardianConsentPolicyBootCheck } from '../modules/auth/guardian-consent-policy.js'
import { CommunityModule } from '../modules/community/community.module.js'

/**
 * The application context behind the `api/realtime.ts` function. Its context fails to start on a
 * guardian consent policy this deployment may not run, as AppModule does (TEA sign-off F-4).
 */
@Module({
  imports: [AuthStateModule, CommunityModule],
  providers: [guardianConsentPolicyBootCheck],
})
export class CommunityRealtimeModule {}
