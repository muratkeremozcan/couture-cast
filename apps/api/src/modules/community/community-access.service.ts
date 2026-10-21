import {
  CommunityAuthorizationBudget,
  type CommunityGrant,
  communityDependency,
} from './community-availability.js'
// Story 6.5 owner: fresh primary eligibility, including serialization-time flag expiry.
import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { PrismaClient, type Prisma } from '@prisma/client'
import { COMMUNITY_AGE_GATE_DENIED_MESSAGE } from '@couture/api-client/contracts/http'
import { calculateAge } from '@couture/utils'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { assertWardrobeParticipationAllowed } from '../guardian/guardian-participation.js'

@Injectable()
export class CommunityAccessService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}

  async assert(
    member: string,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    await this.authorize(member, new CommunityAuthorizationBudget(), tx)
  }
  async authorize(
    member: string,
    budget = new CommunityAuthorizationBudget(),
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<CommunityGrant> {
    const grant = await this.flags.communityReadEvaluation(member, budget)
    if (!grant.value)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'denied',
        message: 'Community access is disabled.',
      })
    await communityDependency(() =>
      budget.run(() =>
        tx === this.prisma
          ? this.prisma.$transaction(
              async (connection) => {
                await connection.$executeRawUnsafe(
                  `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
                )
                await this.assertDatabase(member, connection)
              },
              { timeout: budget.remaining(), maxWait: Math.min(100, budget.remaining()) }
            )
          : this.assertDatabase(member, tx)
      )
    )
    budget.check(grant)
    return grant
  }

  async assertDatabase(
    member: string,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    await assertCommunityDatabaseAccess(tx, member)
  }
}

export async function assertCommunityDatabaseReadAccess(
  tx: Prisma.TransactionClient,
  member: string,
  allowConsentPending = false
): Promise<void> {
  const profile = await tx.userProfile.findUnique({ where: { user_id: member } })
  if (!profile?.birthdate || calculateAge(profile.birthdate) < 13)
    throw new ForbiddenException(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
  const preferences = profile.preferences
  if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
    const compliance = preferences.compliance
    if (
      compliance &&
      typeof compliance === 'object' &&
      !Array.isArray(compliance) &&
      typeof compliance.accountStatus === 'string' &&
      compliance.accountStatus !== 'active' &&
      !(allowConsentPending && compliance.accountStatus === 'pending_guardian_consent')
    )
      throw new ForbiddenException('Community account unavailable')
  }
}
export async function assertCommunityDatabaseAccess(
  tx: Prisma.TransactionClient,
  member: string
): Promise<void> {
  await assertCommunityDatabaseReadAccess(tx, member)
  await assertWardrobeParticipationAllowed(tx, member)
}

export async function assertCommunityReadEligibility(
  prisma: PrismaClient,
  member: string,
  budget: CommunityAuthorizationBudget
) {
  await communityDependency(() =>
    budget.run(() =>
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
          )
          await assertCommunityDatabaseReadAccess(tx, member, true)
        },
        { timeout: budget.remaining(), maxWait: Math.min(100, budget.remaining()) }
      )
    )
  )
}
