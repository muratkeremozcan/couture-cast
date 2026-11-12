import { Inject } from '@nestjs/common'
import type { FeatureFlagEvaluationSubject, FeatureFlagKey } from '@couture/config'

/**
 * PostHog answered successfully (HTTP 200, no evaluation error, no quota limit) and left the key
 * out of `flags`. That happens when the project does not define the flag, and also when the flag
 * is inactive or filtered from this runtime, so it proves nothing about the rollout. Only the
 * community signal path returns it, and it resolves to the declared default. It is not a value:
 * `coerceFeatureFlagValue` reads it as undefined, so a resolver that knows nothing about it keeps
 * its existing fallback order.
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
