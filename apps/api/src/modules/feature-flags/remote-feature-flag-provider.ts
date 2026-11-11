import { Inject } from '@nestjs/common'
import type { FeatureFlagEvaluationSubject, FeatureFlagKey } from '@couture/config'

/**
 * PostHog's definitive answer that the project defines no such flag: HTTP 200, no evaluation
 * error, no quota limit, and the key left out of `flags`. Only the community signal path returns
 * it. It is not a value: `coerceFeatureFlagValue` reads it as undefined, so a resolver that knows
 * nothing about it still falls back to the FeatureFlag row and the declared default.
 */
export const REMOTE_FLAG_ABSENT = Symbol('REMOTE_FLAG_ABSENT')

export interface RemoteFeatureFlagProvider {
  getFeatureFlagValue(
    flagKey: FeatureFlagKey,
    subjectId: FeatureFlagEvaluationSubject,
    options?: { signal: AbortSignal }
  ): Promise<unknown>
}

export const REMOTE_FEATURE_FLAG_PROVIDER = Symbol('REMOTE_FEATURE_FLAG_PROVIDER')

export function InjectRemoteFeatureFlagProvider() {
  return Inject(REMOTE_FEATURE_FLAG_PROVIDER)
}
