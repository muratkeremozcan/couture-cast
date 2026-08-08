import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import type { RequestAuthContext } from '../auth/security.types.js'
import { GuardianService } from '../guardian/guardian.service.js'

export type ResolvedActorAccess = {
  actorRole: 'owner' | 'guardian' | 'admin'
}

@Injectable()
export class WardrobeAccessService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(GuardianService) private readonly guardianService: GuardianService
  ) {}

  async assertReadAccess(
    actor: RequestAuthContext,
    ownerUserId: string
  ): Promise<ResolvedActorAccess> {
    const ownerUser = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
    })

    if (!ownerUser) {
      throw new NotFoundException('NOT_FOUND')
    }

    if (actor.userId === ownerUserId) {
      if (actor.role === 'teen') {
        await this.guardianService.assertWardrobeUploadAllowed(actor.userId, actor.role)
      }
      return { actorRole: 'owner' }
    }

    if (actor.role === 'admin') {
      return { actorRole: 'admin' }
    }

    if (actor.role === 'guardian') {
      const consent = await this.prisma.guardianConsent.findFirst({
        where: {
          guardian_id: actor.userId,
          teen_id: ownerUserId,
          status: 'granted',
          revoked_at: null,
        },
      })

      if (!consent) {
        throw new NotFoundException('NOT_FOUND')
      }

      return { actorRole: 'guardian' }
    }

    throw new NotFoundException('NOT_FOUND')
  }

  async assertWriteAccess(
    actor: RequestAuthContext,
    ownerUserId: string
  ): Promise<ResolvedActorAccess> {
    const ownerUser = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
    })

    if (!ownerUser) {
      throw new NotFoundException('NOT_FOUND')
    }

    if (actor.userId === ownerUserId) {
      if (actor.role === 'teen') {
        await this.guardianService.assertWardrobeUploadAllowed(actor.userId, actor.role)
      }
      return { actorRole: 'owner' }
    }

    if (actor.role === 'admin') {
      return { actorRole: 'admin' }
    }

    if (actor.role === 'guardian') {
      const consent = await this.prisma.guardianConsent.findFirst({
        where: {
          guardian_id: actor.userId,
          teen_id: ownerUserId,
          status: 'granted',
          revoked_at: null,
        },
      })

      if (!consent) {
        throw new NotFoundException('NOT_FOUND')
      }

      if (consent.consent_level === 'read_only') {
        throw new ForbiddenException('GUARDIAN_READ_ONLY')
      }

      return { actorRole: 'guardian' }
    }

    throw new NotFoundException('NOT_FOUND')
  }
}
