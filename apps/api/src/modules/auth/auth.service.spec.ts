import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import { AuthService } from './auth.service'

const FIXED_TODAY = new Date('2026-04-16T12:00:00.000Z')

const createService = (findUnique = vi.fn(), create = vi.fn()) => {
  const capture = vi.fn()
  const analyticsClient = {
    capture,
  } as unknown as AnalyticsClient

  const prisma = {
    user: {
      findUnique,
      create,
    },
  } as unknown as PrismaClient

  return {
    service: new AuthService(analyticsClient, prisma),
    capture,
    findUnique,
    create,
  }
}

describe('AuthService', () => {
  afterEach(() => {
    resetCleanupRegistry()
  })

  it('blocks signup when the birthdate is younger than thirteen', async () => {
    const { service, findUnique, create } = createService()

    await expect(
      service.signUp(
        {
          email: 'kid@example.com',
          birthdate: '2016-04-16',
        },
        { today: FIXED_TODAY }
      )
    ).rejects.toThrow(ForbiddenException)

    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('creates active accounts for users aged sixteen and older', async () => {
    const { service, findUnique, create } = createService(
      vi.fn().mockResolvedValue(null),
      vi.fn().mockResolvedValue({ id: 'user-16' })
    )

    await expect(
      service.signUp(
        {
          email: 'adult-teen@example.com',
          birthdate: '2010-04-15',
        },
        { today: FIXED_TODAY }
      )
    ).resolves.toEqual({
      userId: 'user-16',
      age: 16,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'adult-teen@example.com' },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'adult-teen@example.com',
        profile: {
          create: {
            birthdate: new Date('2010-04-15T12:00:00.000Z'),
            preferences: {
              compliance: {
                accountStatus: 'active',
                guardianConsentRequired: false,
              },
            },
          },
        },
        comfort_profile: {
          create: {},
        },
      },
      select: { id: true },
    })
  })

  it('creates pending consent accounts for users aged thirteen through fifteen', async () => {
    const { service, create } = createService(
      vi.fn().mockResolvedValue(null),
      vi.fn().mockResolvedValue({ id: 'user-guardian' })
    )

    await expect(
      service.signUp(
        {
          email: 'teen@example.com',
          birthdate: '2011-04-15',
        },
        { today: FIXED_TODAY }
      )
    ).resolves.toEqual({
      userId: 'user-guardian',
      age: 15,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'teen@example.com',
        profile: {
          create: {
            birthdate: new Date('2011-04-15T12:00:00.000Z'),
            preferences: {
              compliance: {
                accountStatus: 'pending_guardian_consent',
                guardianConsentRequired: true,
              },
            },
          },
        },
        comfort_profile: {
          create: {},
        },
      },
      select: { id: true },
    })
  })

  it('rejects duplicate emails before creating a new account', async () => {
    const { service, create } = createService(
      vi.fn().mockResolvedValue({ id: 'existing-user' }),
      vi.fn()
    )

    await expect(
      service.signUp(
        {
          email: 'guardian@example.com',
          birthdate: '2009-04-15',
        },
        { today: FIXED_TODAY }
      )
    ).rejects.toThrow(BadRequestException)

    expect(create).not.toHaveBeenCalled()
  })

  it('rejects impossible birthdates with a bad request error', async () => {
    const { service, findUnique, create } = createService()

    await expect(
      service.signUp(
        {
          email: 'invalid-date@example.com',
          birthdate: '2026-02-31',
        },
        { today: FIXED_TODAY }
      )
    ).rejects.toThrow(BadRequestException)

    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('maps unique constraint races during create to duplicate email errors', async () => {
    const { service, create } = createService(
      vi.fn().mockResolvedValue(null),
      vi.fn().mockRejectedValue({ code: 'P2002' })
    )

    await expect(
      service.signUp(
        {
          email: 'race@example.com',
          birthdate: '2009-04-15',
        },
        { today: FIXED_TODAY }
      )
    ).rejects.toThrow(BadRequestException)

    expect(create).toHaveBeenCalledOnce()
  })

  it('tracks guardian_consent_granted with normalized properties', () => {
    const guardian = createGuardianProfileFixture()
    const teen = createTeenProfileFixture()
    const { service, capture } = createService()

    const result = service.grantGuardianConsent({
      guardianId: guardian.id,
      teenId: teen.id,
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    })

    expect(capture).toHaveBeenCalledWith({
      distinctId: guardian.id,
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: guardian.id,
        teen_id: teen.id,
        consent_level: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
        consent_timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
    expect(result).toEqual({ tracked: true })
  })
})
