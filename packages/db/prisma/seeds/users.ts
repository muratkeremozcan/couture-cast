import { ConsentStatus, type Prisma, type PrismaClient } from '@prisma/client'
import * as userFactories from '../../../testing/src/factories/user.factory.ts'
import type { UserFixture } from '../../../testing/src/factories/user.factory.ts'
import * as ageUtils from '../../../utils/src/age.ts'

import { unwrapCjsNamespace } from './interop.js'
import { SEEDED_PROFILE_FEATURE_FLAGS } from './feature-flags.js'

const { createGuardianUser, createTeenUser } = unwrapCjsNamespace(userFactories)
// Same interop wrapper the factories need: under `tsx`, which is how
// `prisma db seed` runs this graph, a named import from a workspace `.ts`
// module resolves to a CJS namespace and the named export is not statically
// visible. `5.4-DB-040` catches exactly that and caught it here.
const { evaluateAgeGate } = unwrapCjsNamespace(ageUtils)

export type SeededUsers = {
  guardians: { id: string; email: string }[]
  teens: { id: string; email: string }[]
}

const seededAt = new Date('2026-01-15T08:00:00.000Z')

export function getGuardianFixtures(): UserFixture[] {
  return [
    createGuardianUser({
      id: 'guardian-1',
      email: 'guardian1@example.com',
      displayName: 'Alex Rivera',
      age: 39,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'guardian',
        style_persona: 'planner',
      },
    }),
    createGuardianUser({
      id: 'guardian-2',
      email: 'guardian2@example.com',
      displayName: 'Jordan Casey',
      age: 43,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'guardian',
        style_persona: 'commuter',
      },
    }),
    createGuardianUser({
      id: 'guardian-3',
      email: 'guardian3@example.com',
      displayName: 'Morgan Blake',
      age: 47,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'guardian',
        style_persona: 'outdoor',
      },
    }),
  ]
}

export function getTeenFixtures(): UserFixture[] {
  return [
    createTeenUser({
      id: 'teen-1',
      email: 'teen1@example.com',
      displayName: 'Riley Chen',
      age: 13,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'teen',
        style_persona: 'school',
      },
    }),
    createTeenUser({
      id: 'teen-2',
      email: 'teen2@example.com',
      displayName: 'Samira Patel',
      age: 14,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'teen',
        style_persona: 'creative',
      },
    }),
    createTeenUser({
      id: 'teen-3',
      email: 'teen3@example.com',
      displayName: 'Drew Kim',
      age: 15,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'teen',
        style_persona: 'sporty',
      },
    }),
    createTeenUser({
      id: 'teen-4',
      email: 'teen4@example.com',
      displayName: 'Taylor Brooks',
      age: 16,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'teen',
        style_persona: 'minimal',
      },
    }),
    createTeenUser({
      id: 'teen-5',
      email: 'teen5@example.com',
      displayName: 'Quinn Morales',
      age: 17,
      createdAt: seededAt,
      updatedAt: seededAt,
      profilePreferences: {
        feature_flags: SEEDED_PROFILE_FEATURE_FLAGS,
        role: 'teen',
        style_persona: 'layered',
      },
    }),
  ]
}

/**
 * The `preferences.compliance` block a real signup writes, reproduced here.
 *
 * WITHOUT THIS THE SEED PRODUCES A SHAPE SIGNUP CANNOT. `AuthService.signup`
 * always writes `{ compliance: { accountStatus, guardianConsentRequired } }`
 * from `evaluateAgeGate`, and guardian acceptance and revocation rewrite
 * `accountStatus` afterwards. Every seeded account was missing the block
 * entirely, so `extractComplianceState` returned `{}` for all eight of them.
 *
 * That is not cosmetic drift. `GuardianService`'s media age gate reads
 * `compliance.accountStatus !== 'active'` and fails closed, so a seeded
 * 13-to-15-year-old holding a granted, unrevoked consent row was refused their
 * own wardrobe: `GET /api/v1/wardrobe/garments` as `teen-1` answered 403 and
 * crossed the k6 smoke `http_req_failed` threshold, with no check asserting on
 * it. The gate is right to fail closed — a missing block means "no evidence
 * this account is cleared" — so the seed is what was wrong.
 *
 * DERIVED, NEVER HAND-WRITTEN PER ACCOUNT. `guardianConsentRequired` comes from
 * the same `evaluateAgeGate` production calls, off the same birthdate, so the
 * seed cannot drift from the 13/16 thresholds. `accountStatus` is the consent
 * STATE rather than an age fact, so it follows the seeded consent graph: an
 * under-16 with a granted guardian is `active` exactly as acceptance would have
 * left them, and one without stays `pending_guardian_consent`. Adding a teen
 * fixture with no consent pair therefore seeds a pending account rather than a
 * silently over-privileged one.
 */
function buildComplianceBlock(fixture: UserFixture, hasGrantedGuardian: boolean) {
  const gate = evaluateAgeGate(fixture.birthdate)

  return {
    accountStatus:
      gate.requiresGuardian && !hasGrantedGuardian ? gate.accountStatus : 'active',
    guardianConsentRequired: gate.requiresGuardian,
  }
}

export function createUserProfileInput(
  fixture: UserFixture,
  hasGrantedGuardian: boolean
) {
  return {
    display_name: fixture.displayName,
    birthdate: fixture.birthdate,
    preferences: {
      ...fixture.profilePreferences,
      compliance: buildComplianceBlock(fixture, hasGrantedGuardian),
    } as Prisma.InputJsonObject,
  }
}

function createComfortPreferencesInput(fixture: UserFixture) {
  return {
    runs_cold_warm: fixture.comfortPreferences.runsColdWarm,
    wind_tolerance: fixture.comfortPreferences.windTolerance,
    precip_preparedness: fixture.comfortPreferences.precipPreparedness,
  }
}

/**
 * Which guardian fixture consents to which teen fixture, by index into
 * `getGuardianFixtures()` and `getTeenFixtures()`.
 *
 * Hoisted out of `seedUsers` because the compliance block written with each
 * PROFILE has to know whether that teen ends up with a granted guardian, and
 * profiles are upserted before consent rows exist. One list feeds both, so the
 * two can never disagree about who is consented.
 */
export const CONSENT_PAIRS: readonly { guardianIndex: number; teenIndex: number }[] = [
  { guardianIndex: 0, teenIndex: 0 },
  { guardianIndex: 1, teenIndex: 1 },
  { guardianIndex: 1, teenIndex: 2 },
  { guardianIndex: 2, teenIndex: 2 },
  { guardianIndex: 2, teenIndex: 3 },
  { guardianIndex: 2, teenIndex: 4 },
]

async function upsertUserSeed(
  prisma: PrismaClient,
  fixture: UserFixture,
  hasGrantedGuardian = false
): Promise<{ id: string; email: string }> {
  const profileInput = createUserProfileInput(fixture, hasGrantedGuardian)
  const comfortInput = createComfortPreferencesInput(fixture)

  await prisma.user.upsert({
    where: { id: fixture.id },
    update: {
      email: fixture.email,
    },
    create: {
      id: fixture.id,
      email: fixture.email,
    },
  })

  await Promise.all([
    prisma.userProfile.upsert({
      where: { user_id: fixture.id },
      update: {
        display_name: profileInput.display_name,
        birthdate: profileInput.birthdate,
        preferences: profileInput.preferences,
      },
      create: {
        user_id: fixture.id,
        display_name: profileInput.display_name,
        birthdate: profileInput.birthdate,
        preferences: profileInput.preferences,
      },
    }),
    prisma.comfortPreferences.upsert({
      where: { user_id: fixture.id },
      update: {
        runs_cold_warm: comfortInput.runs_cold_warm,
        wind_tolerance: comfortInput.wind_tolerance,
        precip_preparedness: comfortInput.precip_preparedness,
      },
      create: {
        user_id: fixture.id,
        runs_cold_warm: comfortInput.runs_cold_warm,
        wind_tolerance: comfortInput.wind_tolerance,
        precip_preparedness: comfortInput.precip_preparedness,
      },
    }),
  ])

  return { id: fixture.id, email: fixture.email }
}

export async function seedUsers(prisma: PrismaClient): Promise<SeededUsers> {
  const guardianFixtures = getGuardianFixtures()
  const teenFixtures = getTeenFixtures()

  const createdGuardians = await Promise.all(
    guardianFixtures.map((guardian) => upsertUserSeed(prisma, guardian))
  )

  const consentedTeenIndexes = new Set(CONSENT_PAIRS.map((pair) => pair.teenIndex))

  const createdTeens = await Promise.all(
    teenFixtures.map((teen, index) =>
      upsertUserSeed(prisma, teen, consentedTeenIndexes.has(index))
    )
  )

  const consentPairs = CONSENT_PAIRS.map((pair) => ({
    guardian_id: createdGuardians[pair.guardianIndex]?.id,
    teen_id: createdTeens[pair.teenIndex]?.id,
  })).filter((pair): pair is { guardian_id: string; teen_id: string } =>
    Boolean(pair.guardian_id && pair.teen_id)
  )

  for (const consent of consentPairs) {
    await prisma.guardianConsent.upsert({
      where: {
        guardian_id_teen_id: {
          guardian_id: consent.guardian_id,
          teen_id: consent.teen_id,
        },
      },
      update: {
        status: ConsentStatus.granted,
        consent_granted_at: seededAt,
      },
      create: {
        guardian_id: consent.guardian_id,
        teen_id: consent.teen_id,
        status: ConsentStatus.granted,
        consent_granted_at: seededAt,
        ip_address: `10.10.0.${consentPairs.indexOf(consent) + 10}`,
      },
    })
  }

  return { guardians: createdGuardians, teens: createdTeens }
}
