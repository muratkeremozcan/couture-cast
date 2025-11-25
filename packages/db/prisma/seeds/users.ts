import { faker } from '@faker-js/faker'
import type { PrismaClient } from '@prisma/client'
import {
  ComfortRun,
  ConsentStatus,
  PrecipPreparedness,
  WindTolerance,
} from '@prisma/client'

export type SeededUsers = {
  guardians: { id: string; email: string }[]
  teens: { id: string; email: string }[]
}

const FEATURE_FLAGS = [
  { key: 'premium_themes', enabled: true },
  { key: 'weekly_planner', enabled: true },
  { key: 'lookbook_import', enabled: false },
  { key: 'guardian_audit', enabled: true },
  { key: 'widget_quick_swap', enabled: true },
  { key: 'ritual_share', enabled: false },
  { key: 'palette_analysis', enabled: true },
  { key: 'experiment_ab', enabled: false },
]

export async function seedUsers(prisma: PrismaClient): Promise<SeededUsers> {
  faker.seed(4242)

  const guardians = [
    { id: 'guardian-1', email: 'guardian1@example.com', displayName: 'Alex Rivera' },
    { id: 'guardian-2', email: 'guardian2@example.com', displayName: 'Jordan Casey' },
    { id: 'guardian-3', email: 'guardian3@example.com', displayName: 'Morgan Blake' },
  ]

  const teens = [
    { id: 'teen-1', email: 'teen1@example.com', displayName: 'Riley Chen', age: 13 },
    { id: 'teen-2', email: 'teen2@example.com', displayName: 'Samira Patel', age: 14 },
    { id: 'teen-3', email: 'teen3@example.com', displayName: 'Drew Kim', age: 15 },
    { id: 'teen-4', email: 'teen4@example.com', displayName: 'Taylor Brooks', age: 16 },
    { id: 'teen-5', email: 'teen5@example.com', displayName: 'Quinn Morales', age: 17 },
  ]

  const createdGuardians = [] as { id: string; email: string }[]
  for (const guardian of guardians) {
    const user = await prisma.user.upsert({
      where: { email: guardian.email },
      update: { email: guardian.email },
      create: {
        id: guardian.id,
        email: guardian.email,
      },
    })

    await prisma.userProfile.upsert({
      where: { user_id: user.id },
      update: {
        display_name: guardian.displayName,
        preferences: { feature_flags: FEATURE_FLAGS, role: 'guardian' },
      },
      create: {
        user_id: user.id,
        display_name: guardian.displayName,
        birthdate: faker.date.birthdate({ min: 35, max: 48, mode: 'age' }),
        preferences: { feature_flags: FEATURE_FLAGS, role: 'guardian' },
      },
    })

    await prisma.comfortPreferences.upsert({
      where: { user_id: user.id },
      update: {
        runs_cold_warm: ComfortRun.neutral,
        wind_tolerance: WindTolerance.medium,
        precip_preparedness: PrecipPreparedness.medium,
      },
      create: {
        user_id: user.id,
        runs_cold_warm: ComfortRun.neutral,
        wind_tolerance: WindTolerance.medium,
        precip_preparedness: PrecipPreparedness.medium,
      },
    })

    createdGuardians.push({ id: user.id, email: user.email })
  }

  const createdTeens = [] as { id: string; email: string }[]
  for (const teen of teens) {
    const user = await prisma.user.upsert({
      where: { email: teen.email },
      update: { email: teen.email },
      create: {
        id: teen.id,
        email: teen.email,
      },
    })

    await prisma.userProfile.upsert({
      where: { user_id: user.id },
      update: {
        display_name: teen.displayName,
        preferences: { feature_flags: FEATURE_FLAGS, role: 'teen' },
      },
      create: {
        user_id: user.id,
        display_name: teen.displayName,
        birthdate: faker.date.birthdate({ min: teen.age, max: teen.age, mode: 'age' }),
        preferences: { feature_flags: FEATURE_FLAGS, role: 'teen' },
      },
    })

    await prisma.comfortPreferences.upsert({
      where: { user_id: user.id },
      update: {
        runs_cold_warm: ComfortRun.warm,
        wind_tolerance: WindTolerance.medium,
        precip_preparedness: PrecipPreparedness.medium,
      },
      create: {
        user_id: user.id,
        runs_cold_warm: ComfortRun.warm,
        wind_tolerance: WindTolerance.medium,
        precip_preparedness: PrecipPreparedness.medium,
      },
    })

    createdTeens.push({ id: user.id, email: user.email })
  }

  const consentPairs = [
    { guardian_id: createdGuardians[0]?.id, teen_id: createdTeens[0]?.id },
    { guardian_id: createdGuardians[1]?.id, teen_id: createdTeens[1]?.id },
    { guardian_id: createdGuardians[1]?.id, teen_id: createdTeens[2]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[2]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[3]?.id },
    { guardian_id: createdGuardians[2]?.id, teen_id: createdTeens[4]?.id },
  ].filter((pair): pair is { guardian_id: string; teen_id: string } => Boolean(pair.guardian_id && pair.teen_id))

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
        consent_granted_at: new Date(),
      },
      create: {
        guardian_id: consent.guardian_id,
        teen_id: consent.teen_id,
        status: ConsentStatus.granted,
        ip_address: faker.internet.ipv4(),
      },
    })
  }

  return { guardians: createdGuardians, teens: createdTeens }
}
