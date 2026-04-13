import {
  ComfortRun,
  PrecipPreparedness,
  WindTolerance,
  type Prisma,
  type PrismaClient,
} from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export type UserFixtureRole = 'user' | 'teen' | 'guardian'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface UserComfortPreferences {
  runsColdWarm: ComfortRun
  windTolerance: WindTolerance
  precipPreparedness: PrecipPreparedness
}

export interface UserFixture {
  id: string
  email: string
  role: UserFixtureRole
  age: number
  displayName: string
  birthdate: Date
  profilePreferences: Record<string, JsonValue>
  comfortPreferences: UserComfortPreferences
  createdAt: Date
  updatedAt: Date
}

export type UserFactoryOverrides = Partial<
  Omit<UserFixture, 'profilePreferences' | 'comfortPreferences'>
> & {
  profilePreferences?: Record<string, JsonValue>
  comfortPreferences?: Partial<UserComfortPreferences>
}

export type UserVariantOverrides = Omit<UserFactoryOverrides, 'role'>

export interface CreatePersistedUserOptions {
  persist: true
  prisma: PrismaClient
}

const persistedUserInclude = {
  profile: true,
  comfort_profile: true,
} satisfies Prisma.UserInclude

export type PersistedUserFixture = Prisma.UserGetPayload<{
  include: typeof persistedUserInclude
}>

const mergeUserFixture = createFactory<UserFixture>(() => {
  const age = faker.number.int({ min: 18, max: 65 })

  return buildDefaultUserFixture('user', age)
})

function buildDefaultAge(role: UserFixtureRole): number {
  switch (role) {
    case 'teen':
      return 15
    case 'guardian':
      return 42
    default:
      return faker.number.int({ min: 18, max: 65 })
  }
}

function buildBirthdate(age: number): Date {
  return faker.date.birthdate({ min: age, max: age, mode: 'age' })
}

function buildComfortPreferences(role: UserFixtureRole): UserComfortPreferences {
  if (role === 'teen') {
    return {
      runsColdWarm: ComfortRun.warm,
      windTolerance: WindTolerance.medium,
      precipPreparedness: PrecipPreparedness.medium,
    }
  }

  return {
    runsColdWarm: ComfortRun.neutral,
    windTolerance: WindTolerance.medium,
    precipPreparedness: PrecipPreparedness.medium,
  }
}

function buildDefaultUserFixture(role: UserFixtureRole, age: number): UserFixture {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email().toLowerCase(),
    role,
    age,
    displayName: faker.person.fullName(),
    birthdate: buildBirthdate(age),
    profilePreferences: { role },
    comfortPreferences: buildComfortPreferences(role),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function composeUserFixture(overrides: UserFactoryOverrides = {}): UserFixture {
  const role = overrides.role ?? 'user'
  const age = overrides.age ?? buildDefaultAge(role)
  const defaults = buildDefaultUserFixture(role, age)

  return mergeUserFixture({
    ...defaults,
    ...overrides,
    role,
    age,
    birthdate: overrides.birthdate ?? defaults.birthdate,
    profilePreferences: {
      ...defaults.profilePreferences,
      ...(overrides.profilePreferences ?? {}),
      role,
    },
    comfortPreferences: {
      ...defaults.comfortPreferences,
      ...(overrides.comfortPreferences ?? {}),
    },
  })
}

export function buildUserCreateInput(fixture: UserFixture): Prisma.UserCreateInput {
  return {
    id: fixture.id,
    email: fixture.email,
    profile: {
      create: {
        display_name: fixture.displayName,
        birthdate: fixture.birthdate,
        preferences: fixture.profilePreferences as Prisma.InputJsonObject,
      },
    },
    comfort_profile: {
      create: {
        runs_cold_warm: fixture.comfortPreferences.runsColdWarm,
        wind_tolerance: fixture.comfortPreferences.windTolerance,
        precip_preparedness: fixture.comfortPreferences.precipPreparedness,
      },
    },
  }
}

export async function persistUser(
  prisma: PrismaClient,
  fixture: UserFixture
): Promise<PersistedUserFixture> {
  const user = await prisma.user.create({
    data: buildUserCreateInput(fixture),
    include: persistedUserInclude,
  })

  registerCreatedEntity('users', user.id)

  return user
}

function maybePersistUser(
  fixture: UserFixture,
  options?: CreatePersistedUserOptions
): UserFixture | Promise<PersistedUserFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistUser(options.prisma, fixture)
}

export function createUser(overrides?: UserFactoryOverrides): UserFixture
export function createUser(
  overrides: UserFactoryOverrides | undefined,
  options: CreatePersistedUserOptions
): Promise<PersistedUserFixture>
export function createUser(
  overrides: UserFactoryOverrides = {},
  options?: CreatePersistedUserOptions
): UserFixture | Promise<PersistedUserFixture> {
  return maybePersistUser(composeUserFixture(overrides), options)
}

export function createTeenUser(overrides?: UserVariantOverrides): UserFixture
export function createTeenUser(
  overrides: UserVariantOverrides | undefined,
  options: CreatePersistedUserOptions
): Promise<PersistedUserFixture>
export function createTeenUser(
  overrides: UserVariantOverrides = {},
  options?: CreatePersistedUserOptions
): UserFixture | Promise<PersistedUserFixture> {
  const userOverrides: UserFactoryOverrides = { ...overrides, role: 'teen' }

  if (options?.persist) {
    return createUser(userOverrides, options)
  }

  return createUser(userOverrides)
}

export function createGuardianUser(overrides?: UserVariantOverrides): UserFixture
export function createGuardianUser(
  overrides: UserVariantOverrides | undefined,
  options: CreatePersistedUserOptions
): Promise<PersistedUserFixture>
export function createGuardianUser(
  overrides: UserVariantOverrides = {},
  options?: CreatePersistedUserOptions
): UserFixture | Promise<PersistedUserFixture> {
  const userOverrides: UserFactoryOverrides = {
    ...overrides,
    role: 'guardian',
  }

  if (options?.persist) {
    return createUser(userOverrides, options)
  }

  return createUser(userOverrides)
}
