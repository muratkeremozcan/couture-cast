import { NotFoundException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONSENT_GRANTED_AT,
  buildLinkedGuardianResponse,
  buildLinkedGuardianRole,
  buildPrismaUserProfileFixture,
  buildUserProfileResponse,
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import { UserService } from './user.service'

const createService = (findUnique = vi.fn()) => {
  const prisma = {
    user: { findUnique },
  } as unknown as PrismaClient

  return { service: new UserService(prisma), findUnique }
}

describe('UserService', () => {
  afterEach(() => {
    resetCleanupRegistry()
  })

  it('maps the authenticated user and guardian links through the shared response schema', async () => {
    const teen = createTeenProfileFixture()
    const guardian = createGuardianProfileFixture({
      id: 'guardian-2',
      email: 'guardian2@example.com',
      displayName: 'Jordan Casey',
    })
    const linkedGuardianRole = buildLinkedGuardianRole(
      guardian,
      DEFAULT_CONSENT_GRANTED_AT
    )
    const findUnique = vi
      .fn()
      .mockResolvedValue(buildPrismaUserProfileFixture(teen, [linkedGuardianRole], []))
    const { service } = createService(findUnique)

    const result = await service.getProfile({
      token: 'teen-token',
      userId: teen.id,
      role: 'teen',
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: teen.id },
      include: {
        profile: true,
        guardian_roles: true,
        teen_roles: true,
      },
    })
    expect(result).toEqual(
      buildUserProfileResponse(
        teen,
        [buildLinkedGuardianResponse(guardian, DEFAULT_CONSENT_GRANTED_AT)],
        []
      )
    )
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
