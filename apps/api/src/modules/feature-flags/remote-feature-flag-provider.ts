import { Inject } from '@nestjs/common'
import type { FeatureFlagEvaluationSubject, FeatureFlagKey } from '@couture/config'

export interface RemoteFeatureFlagProvider {
  getFeatureFlagValue(
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject
  ): Promise<unknown>
}

export const REMOTE_FEATURE_FLAG_PROVIDER = Symbol('REMOTE_FEATURE_FLAG_PROVIDER')

export function InjectRemoteFeatureFlagProvider() {
  return Inject(REMOTE_FEATURE_FLAG_PROVIDER)
}
