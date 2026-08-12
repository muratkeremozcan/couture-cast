// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import type { RequestAuthContext } from '../auth/security.types.js'
import type { GuardianService } from '../guardian/guardian.service.js'
import { WardrobeAccessService } from './wardrobe-access.service.js'

/** The subset of `GuardianConsent` the access service reads. */
type GuardianConsentRow = {
  guardian_id: string
  teen_id: string
  status: string
  consent_level: string
  revoked_at?: Date | null
}

describe('WardrobeAccessService', () => {
  const createMockPrisma = (
    ownerExists = true,
    guardianConsent: GuardianConsentRow | null = null
  ) =>
    ({
      user: {
        findUnique: vi.fn().mockResolvedValue(ownerExists ? { id: 'owner-1' } : null),
      },
      guardianConsent: {
        findFirst: vi.fn().mockResolvedValue(guardianConsent),
      },
    }) as unknown as PrismaClient

  const createMockGuardianService = (allowUpload = true) =>
    ({
      assertWardrobeUploadAllowed: allowUpload
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')),
    }) as unknown as GuardianService

  describe('assertReadAccess', () => {
    it('4.3-UNIT-AUTHZ-01 allows owner access', async () => {
      const prisma = createMockPrisma(true)
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'owner-1', role: 'teen' }

      const result = await service.assertReadAccess(actor, 'owner-1')
      expect(result).toEqual({ actorRole: 'owner' })
    })

    it('4.3-UNIT-AUTHZ-02 throws masked 404 if owner user does not exist', async () => {
      const prisma = createMockPrisma(false)
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'owner-1', role: 'teen' }

      await expect(service.assertReadAccess(actor, 'owner-1')).rejects.toThrow(
        NotFoundException
      )
    })

    it('4.3-UNIT-AUTHZ-03 allows admin access', async () => {
      const prisma = createMockPrisma(true)
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'admin-1', role: 'admin' }

      const result = await service.assertReadAccess(actor, 'owner-1')
      expect(result).toEqual({ actorRole: 'admin' })
    })

    it('4.3-UNIT-AUTHZ-04 allows guardian read access with valid consent', async () => {
      const prisma = createMockPrisma(true, {
        guardian_id: 'g-1',
        teen_id: 'owner-1',
        consent_level: 'read_only',
        status: 'granted',
      })
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'g-1', role: 'guardian' }

      const result = await service.assertReadAccess(actor, 'owner-1')
      expect(result).toEqual({ actorRole: 'guardian' })
    })

    it('4.3-UNIT-AUTHZ-05 throws masked 404 for unauthorized stranger', async () => {
      const prisma = createMockPrisma(true, null)
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'stranger-1', role: 'teen' }

      await expect(service.assertReadAccess(actor, 'owner-1')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('assertWriteAccess', () => {
    it('4.3-UNIT-AUTHZ-06 allows owner write access', async () => {
      const prisma = createMockPrisma(true)
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'owner-1', role: 'teen' }

      const result = await service.assertWriteAccess(actor, 'owner-1')
      expect(result).toEqual({ actorRole: 'owner' })
    })

    it('4.3-UNIT-AUTHZ-07 rejects read-only guardian write access with GUARDIAN_READ_ONLY', async () => {
      const prisma = createMockPrisma(true, {
        guardian_id: 'g-1',
        teen_id: 'owner-1',
        consent_level: 'read_only',
        status: 'granted',
      })
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'g-1', role: 'guardian' }

      await expect(service.assertWriteAccess(actor, 'owner-1')).rejects.toThrow(
        ForbiddenException
      )
    })

    it('4.3-UNIT-AUTHZ-08 allows full consent guardian write access', async () => {
      const prisma = createMockPrisma(true, {
        guardian_id: 'g-1',
        teen_id: 'owner-1',
        consent_level: 'full',
        status: 'granted',
      })
      const guardianService = createMockGuardianService(true)
      const service = new WardrobeAccessService(prisma, guardianService)
      const actor: RequestAuthContext = { token: 't', userId: 'g-1', role: 'guardian' }

      const result = await service.assertWriteAccess(actor, 'owner-1')
      expect(result).toEqual({ actorRole: 'guardian' })
    })
  })
})
