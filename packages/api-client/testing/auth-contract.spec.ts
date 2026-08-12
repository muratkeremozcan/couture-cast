// Learning path Step 14: Author public REST contracts in shared Zod modules.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-14-author-public-rest-contracts-in-shared-zod-modules
import { describe, expect, it } from 'vitest'
import {
  guardianConsentInputSchema,
  signupInputSchema,
  signupResponseSchema,
} from '../src/contracts/http'

function signup(birthdate: string) {
  return signupInputSchema.safeParse({ email: 'teen@example.test', birthdate })
}

describe('signup birthdate contract', () => {
  it('accepts a real calendar date', () => {
    expect(signup('2009-03-04').success).toBe(true)
  })

  // The regex alone accepts any well-formed digits. These are the cases the
  // extra calendar refinement exists to catch, and the reason the contract
  // documents the invariant in its OpenAPI description.
  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-01-32', '2026-04-31'])(
    'rejects the well-formed but impossible date %s',
    (birthdate) => {
      expect(signup(birthdate).success).toBe(false)
    }
  )

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(signup('2024-02-29').success).toBe(true)
    expect(signup('2023-02-29').success).toBe(false)
  })

  // A UTC-noon anchor is used internally so that no timezone can roll the day
  // backwards; 1 January and 31 December must both survive the round trip.
  it('accepts both year boundaries without timezone drift', () => {
    expect(signup('2009-01-01').success).toBe(true)
    expect(signup('2009-12-31').success).toBe(true)
  })

  it.each(['2009-3-04', '20090304', '2009/03/04', '2009-03-04T00:00:00.000Z', ''])(
    'rejects the malformed birthdate %s before the calendar check runs',
    (birthdate) => {
      expect(signup(birthdate).success).toBe(false)
    }
  )

  it('rejects a signup without a valid email', () => {
    expect(
      signupInputSchema.safeParse({ email: 'not-an-email', birthdate: '2009-03-04' })
        .success
    ).toBe(false)
  })
})

describe('signup response discriminated union', () => {
  it('accepts an active account with consent not required', () => {
    expect(
      signupResponseSchema.parse({
        userId: 'user-1',
        age: 29,
        accountStatus: 'active',
        guardianConsentRequired: false,
      })
    ).toEqual({
      userId: 'user-1',
      age: 29,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
  })

  it('accepts a pending account with consent required', () => {
    expect(
      signupResponseSchema.parse({
        userId: 'teen-1',
        age: 15,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      }).guardianConsentRequired
    ).toBe(true)
  })

  // The union exists so the two fields cannot disagree. A response claiming an
  // active account that still needs consent would let a client skip the
  // consent gate, so it must be unrepresentable.
  it('rejects an active account that also claims consent is required', () => {
    expect(
      signupResponseSchema.safeParse({
        userId: 'user-1',
        age: 29,
        accountStatus: 'active',
        guardianConsentRequired: true,
      }).success
    ).toBe(false)
  })

  it('rejects a pending account that claims consent is not required', () => {
    expect(
      signupResponseSchema.safeParse({
        userId: 'teen-1',
        age: 15,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: false,
      }).success
    ).toBe(false)
  })

  it('rejects an unknown account status', () => {
    expect(
      signupResponseSchema.safeParse({
        userId: 'user-1',
        age: 29,
        accountStatus: 'blocked',
        guardianConsentRequired: false,
      }).success
    ).toBe(false)
  })

  // Under-13 signups are refused with a 403 rather than returned as a user, so
  // no successful response may carry an age below the minimum.
  it('rejects an age below the under-13 floor', () => {
    expect(
      signupResponseSchema.safeParse({
        userId: 'child-1',
        age: 12,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      }).success
    ).toBe(false)
  })

  it('rejects extra keys on either variant', () => {
    expect(
      signupResponseSchema.safeParse({
        userId: 'user-1',
        age: 29,
        accountStatus: 'active',
        guardianConsentRequired: false,
        accessToken: 'leaked-jwt',
      }).success
    ).toBe(false)
  })
})

describe('guardian consent input contract', () => {
  it('accepts a consent record with and without an explicit timestamp', () => {
    expect(
      guardianConsentInputSchema.parse({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
      }).timestamp
    ).toBeUndefined()

    expect(
      guardianConsentInputSchema.parse({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
        timestamp: '2026-08-09T12:00:00.000Z',
      }).timestamp
    ).toBe('2026-08-09T12:00:00.000Z')
  })

  it.each(['guardianId', 'teenId', 'consentLevel'])(
    'rejects an empty %s',
    (emptyField) => {
      expect(
        guardianConsentInputSchema.safeParse({
          guardianId: 'guardian-1',
          teenId: 'teen-1',
          consentLevel: 'full',
          [emptyField]: '',
        }).success
      ).toBe(false)
    }
  )

  it('rejects a non-ISO consent timestamp', () => {
    expect(
      guardianConsentInputSchema.safeParse({
        guardianId: 'guardian-1',
        teenId: 'teen-1',
        consentLevel: 'full',
        timestamp: '2026-08-09 12:00:00',
      }).success
    ).toBe(false)
  })
})
