import { afterEach, beforeEach } from 'vitest'
import type { GuardianConsentPolicy } from '@couture/utils'

/**
 * Runs the enclosing describe under one GUARDIAN_CONSENT_POLICY and restores the previous value
 * after each test. It writes process.env directly instead of vi.stubEnv, so a spec's own
 * beforeAll stubs survive (vi.unstubAllEnvs would drop them).
 */
export function useGuardianConsentPolicy(policy: GuardianConsentPolicy) {
  let previous: string | undefined
  beforeEach(() => {
    previous = process.env.GUARDIAN_CONSENT_POLICY
    process.env.GUARDIAN_CONSENT_POLICY = policy
  })
  afterEach(() => {
    if (previous === undefined) delete process.env.GUARDIAN_CONSENT_POLICY
    else process.env.GUARDIAN_CONSENT_POLICY = previous
  })
}
