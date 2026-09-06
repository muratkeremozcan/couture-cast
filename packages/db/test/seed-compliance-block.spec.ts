// Story 6.1: the seed must produce account shapes signup can produce.
//
// WHY THIS EXISTS. `AuthService.signup` always writes
// `preferences.compliance = { accountStatus, guardianConsentRequired }` from
// `evaluateAgeGate`, and guardian acceptance and revocation rewrite
// `accountStatus` afterwards. The user seed wrote no compliance block at all,
// for any of its eight accounts, so `extractComplianceState` returned `{}` for
// every one of them.
//
// `GuardianService`'s media age gate reads `compliance.accountStatus !== 'active'`
// and fails closed, which is correct: a missing block means "no evidence this
// account is cleared". The consequence was that `teen-1` — thirteen, with a
// granted and unrevoked guardian consent row — was refused their own wardrobe.
// `GET /api/v1/wardrobe/garments` answered 403 and crossed the k6 smoke
// `http_req_failed` threshold on `934ab95a`.
//
// It surfaced only because 403 fell outside that scenario's tolerated statuses.
// No check asserted on the response, no unit test covered the seed's output
// shape, and nothing else in the repository compared what the seed writes
// against what signup writes. This file is that comparison, so the next removal
// fails here rather than as a threshold in a load test.
//
// PURE, AND DELIBERATELY SO. It reads the fixtures and the profile builder the
// seed itself calls, with no database, so it cannot pass vacuously against an
// unseeded machine and cannot be silently skipped by a schema probe.
import { describe, expect, it } from 'vitest'

import { evaluateAgeGate } from '../../utils/src/age.ts'
import {
  CONSENT_PAIRS,
  createUserProfileInput,
  getGuardianFixtures,
  getTeenFixtures,
} from '../prisma/seeds/users.ts'

type Compliance = {
  accountStatus?: unknown
  guardianConsentRequired?: unknown
}

function complianceOf(
  fixture: ReturnType<typeof getTeenFixtures>[number],
  hasGrantedGuardian: boolean
): Compliance {
  const preferences = createUserProfileInput(fixture, hasGrantedGuardian)
    .preferences as Record<string, unknown>
  return (preferences.compliance ?? {}) as Compliance
}

describe('seeded account compliance block', () => {
  const guardians = getGuardianFixtures()
  const teens = getTeenFixtures()
  const consentedTeenIndexes = new Set(CONSENT_PAIRS.map((pair) => pair.teenIndex))

  it('6.1-DB-040 counts the accounts it is about, so it cannot pass over nothing', () => {
    // The anchor. Everything below is a loop over two fixture lists, and an
    // empty list would satisfy every assertion in the file.
    expect(guardians.length).toBeGreaterThan(0)
    expect(teens.length).toBeGreaterThan(0)
    expect(CONSENT_PAIRS.length).toBeGreaterThan(0)
  })

  it('6.1-DB-041 gives every seeded account the compliance block signup writes', () => {
    for (const [index, fixture] of [...guardians, ...teens].entries()) {
      const isTeen = index >= guardians.length
      const teenIndex = index - guardians.length
      const compliance = complianceOf(
        fixture,
        isTeen && consentedTeenIndexes.has(teenIndex)
      )

      expect(Object.keys(compliance).sort(), `${fixture.id} compliance keys`).toEqual([
        'accountStatus',
        'guardianConsentRequired',
      ])
    }
  })

  it('6.1-DB-042 derives guardianConsentRequired from the same age gate production uses', () => {
    // Not a hand-written expectation per account: read from `evaluateAgeGate`
    // off the fixture's own birthdate, so moving the 13 or 16 threshold moves
    // the seed and this assertion together instead of leaving them to disagree.
    for (const [index, fixture] of [...guardians, ...teens].entries()) {
      const isTeen = index >= guardians.length
      const teenIndex = index - guardians.length
      const hasGrantedGuardian = isTeen && consentedTeenIndexes.has(teenIndex)
      const gate = evaluateAgeGate(fixture.birthdate)

      expect(
        complianceOf(fixture, hasGrantedGuardian).guardianConsentRequired,
        `${fixture.id} (age ${gate.age}) guardianConsentRequired`
      ).toBe(gate.requiresGuardian)
    }
  })

  it('6.1-DB-043 marks a consented minor active and an unconsented one pending', () => {
    // The half that is consent STATE rather than an age fact. A 13-to-15-year-old
    // whose guardian has accepted is `active`, exactly as acceptance would have
    // left them; one with no consent pair stays `pending_guardian_consent`
    // rather than being silently over-privileged.
    const minor = teens.find((fixture) => evaluateAgeGate(fixture.birthdate).age < 16)
    expect(minor, 'the seed must keep at least one under-16 fixture').toBeDefined()

    expect(complianceOf(minor!, true).accountStatus).toBe('active')
    expect(complianceOf(minor!, false).accountStatus).toBe('pending_guardian_consent')
  })

  it('6.1-DB-044 keeps the existing preference keys alongside the new block', () => {
    // The block is added, never substituted. `role`, `style_persona` and
    // `feature_flags` are what the rest of the seeded surface reads, and an
    // overwrite here would break far more than the age gate.
    const teen = teens[0]!
    const preferences = createUserProfileInput(teen, true).preferences as Record<
      string,
      unknown
    >

    expect(Object.keys(preferences).sort()).toEqual([
      'compliance',
      'feature_flags',
      'role',
      'style_persona',
    ])
  })
})
