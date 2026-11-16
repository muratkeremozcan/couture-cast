import { ConflictException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import {
  GUARDIAN_CONSENT_OFF_CODE,
  GUARDIAN_CONSENT_OFF_MESSAGE,
  GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE,
  GuardianConsentPolicyGuard,
  guardianConsentPolicyBootCheck,
  invalidGuardianConsentPolicyMessage,
  resolveGuardianConsentPolicy,
} from './guardian-consent-policy'

// Owner ruling 2026-11-16: guardian consent is off; required_13_15 stays for the test lanes and
// is refused everywhere else until teen-path finding B-1 is fixed.
describe('A-POLICY-CONFIG: GUARDIAN_CONSENT_POLICY', () => {
  it.each([{}, { GUARDIAN_CONSENT_POLICY: '' }, { GUARDIAN_CONSENT_POLICY: '  ' }])(
    'unset or blank means off (%j)',
    (env) => {
      expect(resolveGuardianConsentPolicy(env)).toBe('off')
    }
  )

  it('off is off in any environment', () => {
    expect(
      resolveGuardianConsentPolicy({
        GUARDIAN_CONSENT_POLICY: 'off',
        NODE_ENV: 'production',
      })
    ).toBe('off')
  })

  it.each(['required', 'OFF', 'required_13_17', 'true'])(
    'an unknown value %s is refused with an exact message',
    (value) => {
      expect(() =>
        resolveGuardianConsentPolicy({ GUARDIAN_CONSENT_POLICY: value, NODE_ENV: 'test' })
      ).toThrow(invalidGuardianConsentPolicyMessage(value))
      expect(invalidGuardianConsentPolicyMessage(value)).toBe(
        `GUARDIAN_CONSENT_POLICY must be off or required_13_15; got "${value}".`
      )
    }
  )

  it.each([
    { NODE_ENV: 'test' },
    { NODE_ENV: 'production', TEST_ENV: 'local' },
    { NODE_ENV: 'development', TEST_ENV: 'LOCAL' },
  ])('required_13_15 runs in a test environment (%j)', (env) => {
    expect(
      resolveGuardianConsentPolicy({ ...env, GUARDIAN_CONSENT_POLICY: 'required_13_15' })
    ).toBe('required_13_15')
  })

  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', VERCEL_ENV: 'production' },
    { NODE_ENV: 'production', VERCEL_ENV: 'preview', TEST_ENV: 'preview' },
    { NODE_ENV: 'development' },
    {},
  ])('required_13_15 is refused outside a test environment (%j)', (env) => {
    expect(() =>
      resolveGuardianConsentPolicy({ ...env, GUARDIAN_CONSENT_POLICY: 'required_13_15' })
    ).toThrow(GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE)
    expect(GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE).toBe(
      'GUARDIAN_CONSENT_POLICY=required_13_15 is refused outside test environments until the guardian endpoints check their caller (teen-path finding B-1).'
    )
  })

  it('the AppModule boot check fails module compilation on a refused policy', async () => {
    const previous = { ...process.env }
    try {
      process.env.GUARDIAN_CONSENT_POLICY = 'required_13_15'
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV
      await expect(
        Test.createTestingModule({
          providers: [guardianConsentPolicyBootCheck],
        }).compile()
      ).rejects.toThrow(GUARDIAN_CONSENT_POLICY_REQUIRED_BLOCKED_MESSAGE)
    } finally {
      process.env = previous
    }
  })
})

describe('GuardianConsentPolicyGuard', () => {
  it('under off refuses with 409 guardian_consent_off and the exact body', () => {
    const previous = process.env.GUARDIAN_CONSENT_POLICY
    delete process.env.GUARDIAN_CONSENT_POLICY
    try {
      const guard = new GuardianConsentPolicyGuard()
      let thrown: unknown
      try {
        guard.canActivate()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ConflictException)
      expect((thrown as ConflictException).getStatus()).toBe(409)
      expect((thrown as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        code: GUARDIAN_CONSENT_OFF_CODE,
        message: GUARDIAN_CONSENT_OFF_MESSAGE,
      })
      expect(GUARDIAN_CONSENT_OFF_CODE).toBe('guardian_consent_off')
    } finally {
      if (previous !== undefined) process.env.GUARDIAN_CONSENT_POLICY = previous
    }
  })

  it('under required_13_15 lets the request through to its own guards', () => {
    const previous = process.env.GUARDIAN_CONSENT_POLICY
    process.env.GUARDIAN_CONSENT_POLICY = 'required_13_15'
    try {
      expect(new GuardianConsentPolicyGuard().canActivate()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.GUARDIAN_CONSENT_POLICY
      else process.env.GUARDIAN_CONSENT_POLICY = previous
    }
  })
})
