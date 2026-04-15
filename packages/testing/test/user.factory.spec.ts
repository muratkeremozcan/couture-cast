import { ComfortRun, PrecipPreparedness, WindTolerance } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  buildUserCreateInput,
  createTeenUser,
  createUser,
} from '../src/factories/user.factory.js'

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
})
