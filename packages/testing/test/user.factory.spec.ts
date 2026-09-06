import { ComfortRun, PrecipPreparedness, WindTolerance } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildUserCreateInput,
  createGuardianUser,
  createTeenUser,
  createUser,
  persistUser,
} from '../src/factories/user.factory.js'
import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'

type UserCreateArgs = {
  data: Record<string, unknown>
  include: Record<string, unknown>
}

// The persistence path only reaches `user.create`, so the stub models that one
// delegate.
function createPrismaStub(row: { id: string }) {
  const create = vi.fn<(args: UserCreateArgs) => Promise<{ id: string }>>()
  create.mockResolvedValue(row)

  return {
    prisma: { user: { create } } as unknown as PrismaClient,
    create,
  }
}

describe('user factory', () => {
  it('creates a schema-valid user fixture and nested Prisma input', () => {
    const user = createUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Casey Lane',
      age: 29,
      birthdate: new Date('1997-01-15T00:00:00.000Z'),
      profilePreferences: {
        preferred_palette: 'monochrome',
      },
      comfortPreferences: {
        runsColdWarm: ComfortRun.cold,
      },
    })

    const input = buildUserCreateInput(user)

    expect(user.role).toBe('user')
    expect(user.profilePreferences).toMatchObject({
      role: 'user',
      preferred_palette: 'monochrome',
    })
    expect(input).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      profile: {
        create: {
          display_name: 'Casey Lane',
          birthdate: new Date('1997-01-15T00:00:00.000Z'),
          preferences: {
            role: 'user',
            preferred_palette: 'monochrome',
          },
        },
      },
      comfort_profile: {
        create: {
          runs_cold_warm: ComfortRun.cold,
          wind_tolerance: WindTolerance.medium,
          precip_preparedness: PrecipPreparedness.medium,
        },
      },
    })
  })

  it('keeps the teen variant in the expected age range', () => {
    const teen = createTeenUser()

    expect(teen.role).toBe('teen')
    expect(teen.age).toBeGreaterThanOrEqual(13)
    expect(teen.age).toBeLessThanOrEqual(17)
  })

  it('merges nested override data without losing teen defaults', () => {
    const teen = createTeenUser({
      profilePreferences: {
        onboarding_state: 'returning',
      },
      comfortPreferences: {
        windTolerance: WindTolerance.high,
      },
    })

    expect(teen.profilePreferences).toMatchObject({
      role: 'teen',
      onboarding_state: 'returning',
    })
    expect(teen.comfortPreferences).toEqual({
      runsColdWarm: ComfortRun.warm,
      windTolerance: WindTolerance.high,
      precipPreparedness: PrecipPreparedness.medium,
    })
  })

  it('gives the guardian variant an adult default age and neutral comfort', () => {
    // Guardian fixtures back the consent flows, so the default must land well
    // clear of the 16-year age gate without the test having to say so.
    const guardian = createGuardianUser()

    expect(guardian.role).toBe('guardian')
    expect(guardian.age).toBe(42)
    expect(guardian.profilePreferences).toMatchObject({ role: 'guardian' })
    expect(guardian.comfortPreferences.runsColdWarm).toBe(ComfortRun.neutral)
  })

  it('keeps the unqualified user variant in the adult age range', () => {
    const user = createUser()

    expect(user.role).toBe('user')
    expect(user.age).toBeGreaterThanOrEqual(18)
    expect(user.age).toBeLessThanOrEqual(65)
    expect(user.birthdate).toBeInstanceOf(Date)
  })
})

describe('user factory persistence', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  it('writes the nested create input and registers the row for cleanup', async () => {
    // A persisted fixture that never reaches the cleanup registry survives the
    // suite and breaks the next run on a unique email.
    const row = { id: 'user-persisted' }
    const { prisma, create } = createPrismaStub(row)

    const persisted = await createUser(
      { id: 'user-persisted', email: 'persisted@example.com' },
      { persist: true, prisma }
    )

    expect(persisted).toBe(row)
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { id: 'user-persisted', email: 'persisted@example.com' },
      include: { profile: true, comfort_profile: true },
    })
    expect(getTrackedEntityIds('users')).toEqual(['user-persisted'])
  })

  it('registers the id Prisma returned rather than the requested one', async () => {
    // Database defaults can rewrite the id; cleanup has to chase the real row.
    const { prisma } = createPrismaStub({ id: 'user-from-database' })

    await persistUser(prisma, createUser({ id: 'user-requested' }))

    expect(getTrackedEntityIds('users')).toEqual(['user-from-database'])
  })

  it('persists the teen and guardian variants through the same path', async () => {
    const teenStub = createPrismaStub({ id: 'teen-persisted' })
    const guardianStub = createPrismaStub({ id: 'guardian-persisted' })

    await createTeenUser(
      { id: 'teen-persisted' },
      { persist: true, prisma: teenStub.prisma }
    )
    await createGuardianUser(
      { id: 'guardian-persisted' },
      { persist: true, prisma: guardianStub.prisma }
    )

    expect(teenStub.create).toHaveBeenCalledTimes(1)
    expect(guardianStub.create).toHaveBeenCalledTimes(1)
    expect(getTrackedEntityIds('users')).toEqual(['teen-persisted', 'guardian-persisted'])
  })
})
