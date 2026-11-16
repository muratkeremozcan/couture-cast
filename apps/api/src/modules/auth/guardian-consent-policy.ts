import { ConflictException, Injectable, type CanActivate } from '@nestjs/common'
import { GUARDIAN_CONSENT_POLICY, type GuardianConsentPolicy } from '@couture/utils'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

/**
 * Guardian consent for 13 to 15 year olds, read from `GUARDIAN_CONSENT_POLICY`:
 * unset means the shipped value in packages/utils/src/age.ts (`off`, owner ruling 2026-11-16).
 *
 * `required_13_15` runs only where test-only behaviour is allowed (`NODE_ENV=test` or
 * `TEST_ENV=local`), so the test lanes keep the guardian path proven. Everywhere else it fails
 * boot until the guardian endpoints check their caller: teen-path finding B-1 in
 * _bmad-output/test-artifacts/story-6-17/teen-path-findings.md. The PR that fixes B-1 removes
 * that refusal.
 */
export const GUARDIAN_CONSENT_POLICY_ENV = 'GUARDIAN_CONSENT_POLICY'

export const GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE =
  'GUARDIAN_CONSENT_POLICY=required_13_15 is refused outside test environments until the guardian endpoints check their caller (teen-path finding B-1).'

export function invalidGuardianConsentPolicyMessage(value: string) {
  return `GUARDIAN_CONSENT_POLICY must be off or required_13_15; got "${value}".`
}

export function resolveGuardianConsentPolicy(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): GuardianConsentPolicy {
  const value = env[GUARDIAN_CONSENT_POLICY_ENV]?.trim()
  if (!value) return GUARDIAN_CONSENT_POLICY
  if (value !== 'off' && value !== 'required_13_15')
    throw new Error(invalidGuardianConsentPolicyMessage(value))
  if (value === 'required_13_15' && !allowsTestOnlySecrets(env))
    throw new Error(GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE)
  return value
}

/** The AppModule provider that refuses boot on a policy this deployment may not run. */
export const guardianConsentPolicyBootCheck = {
  provide: GUARDIAN_CONSENT_POLICY_ENV,
  useFactory: () => resolveGuardianConsentPolicy(),
}

export const GUARDIAN_CONSENT_OFF_CODE = 'guardian_consent_off'
export const GUARDIAN_CONSENT_OFF_MESSAGE = 'Guardian consent is not used.'

/**
 * Refuses the guardian consent endpoints (invite, accept, grant, revoke) while the policy is
 * `off`, before authentication, so no invitation link can be minted or redeemed and no consent
 * row is written.
 */
@Injectable()
export class GuardianConsentPolicyGuard implements CanActivate {
  canActivate() {
    if (resolveGuardianConsentPolicy() === 'off')
      throw new ConflictException({
        statusCode: 409,
        code: GUARDIAN_CONSENT_OFF_CODE,
        message: GUARDIAN_CONSENT_OFF_MESSAGE,
      })
    return true
  }
}
