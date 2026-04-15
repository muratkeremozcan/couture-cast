import { ConsentStatus, type Prisma, type PrismaClient } from '@prisma/client'
import * as userFactories from '../../../testing/src/factories/user.factory.ts'
import type { UserFixture } from '../../../testing/src/factories/user.factory.ts'

import { unwrapCjsNamespace } from './interop.js'
import { SEEDED_PROFILE_FEATURE_FLAGS } from './feature-flags.js'

const { createGuardianUser, createTeenUser } = unwrapCjsNamespace(userFactories)

export type SeededUsers = {
  guardians: { id: string; email: string }[]
  teens: { id: string; email: string }[]
}

const seededAt = new Date('2026-01-15T08:00:00.000Z')

const guardianFixtures = [
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

const teenFixtures = [
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

function createUserProfileInput(fixture: UserFixture) {
  return {
    display_name: fixture.displayName,
    birthdate: fixture.birthdate,
    preferences: fixture.profilePreferences as Prisma.InputJsonObject,
  }
}

function createComfortPreferencesInput(fixture: UserFixture) {
  return {
    runs_cold_warm: fixture.comfortPreferences.runsColdWarm,
    wind_tolerance: fixture.comfortPreferences.windTolerance,
    precip_preparedness: fixture.comfortPreferences.precipPreparedness,
  }
}

async function upsertUserSeed(
  prisma: PrismaClient,
  fixture: UserFixture
): Promise<{ id: string; email: string }> {
  const profileInput = createUserProfileInput(fixture)
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
  const createdGuardians = await Promise.all(
    guardianFixtures.map((guardian) => upsertUserSeed(prisma, guardian))
  )

  const createdTeens = await Promise.all(
    teenFixtures.map((teen) => upsertUserSeed(prisma, teen))
  )

  const consentPairs = [
    { guardian_id: createdGuardians[0]?.id, teen_id: createdTeens[0]?.id },
    { guardian_id: createdGuardians[1]?.id, teen_id: createdTeens[1]?.id },
    { guardian_id: createdGuardians[1]?.id, teen_id: createdTeens[2]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[2]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[3]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[4]?.id },
  ].filter((pair): pair is { guardian_id: string; teen_id: string } =>
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
        ip_address: `10.10.0.${consentPairs.indexOf(consent) + 10}`,
      },
    })
  }

  return { guardians: createdGuardians, teens: createdTeens }
}
