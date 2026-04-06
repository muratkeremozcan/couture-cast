import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { userProfileResponseSchema } from '../../contracts/http'
import type { RequestAuthContext } from '../auth/security.types'

// Story 0.9 Task 5 step 4 owner:
// keep the user REST adapter thin by shaping one authenticated profile payload from Prisma through
// the shared contract schema here.
//
// Why this step matters:
// the first `user` REST slice should prove that real DB-backed profile data can flow through the
// canonical contract layer without controller-local DTOs or decorator-authored docs.
@Injectable()
export class UserService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async getProfile(auth: RequestAuthContext) {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        profile: true,
        guardian_roles: true,
        teen_roles: true,
      },
    })

    if (!user) {
      throw new NotFoundException('Authenticated user profile not found')
    }

    return userProfileResponseSchema.parse({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile?.display_name ?? null,
        birthdate: user.profile?.birthdate?.toISOString() ?? null,
        role: auth.role,
      },
      linkedGuardians: user.teen_roles.map((consent) => ({
        guardianId: consent.guardian_id,
        status: consent.status,
        consentGrantedAt: consent.consent_granted_at?.toISOString() ?? null,
      })),
      linkedTeens: user.guardian_roles.map((consent) => ({
        teenId: consent.teen_id,
        status: consent.status,
        consentGrantedAt: consent.consent_granted_at?.toISOString() ?? null,
      })),
    })
  }
}
