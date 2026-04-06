import { NotFoundException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { UserService } from './user.service'

const createService = (findUnique = vi.fn()) => {
  const prisma = {
    user: { findUnique },
  } as unknown as PrismaClient

  return { service: new UserService(prisma), findUnique }
}

describe('UserService', () => {
  it('maps the authenticated user and guardian links through the shared response schema', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'teen-4',
      email: 'teen4@example.com',
      profile: {
        display_name: 'Taylor Brooks',
        birthdate: new Date('2009-03-04T00:00:00.000Z'),
      },
      teen_roles: [
        {
          guardian_id: 'guardian-2',
          status: 'granted',
          consent_granted_at: new Date('2026-03-04T10:00:00.000Z'),
        },
      ],
      guardian_roles: [],
    })
    const { service } = createService(findUnique)

    const result = await service.getProfile({
      token: 'teen-token',
      userId: 'teen-4',
      role: 'teen',
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'teen-4' },
      include: {
        profile: true,
        guardian_roles: true,
        teen_roles: true,
      },
    })
    expect(result).toEqual({
      user: {
        id: 'teen-4',
        email: 'teen4@example.com',
        displayName: 'Taylor Brooks',
        birthdate: '2009-03-04T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [
        {
          guardianId: 'guardian-2',
          status: 'granted',
          consentGrantedAt: '2026-03-04T10:00:00.000Z',
        },
      ],
      linkedTeens: [],
    })
  })

  it('throws when the authenticated user cannot be found', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(null))

    await expect(
      service.getProfile({
        token: 'missing-token',
        userId: 'missing-user',
        role: 'guardian',
      })
    ).rejects.toThrow(NotFoundException)
  })
})
