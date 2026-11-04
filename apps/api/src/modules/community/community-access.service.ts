import {
  CommunityAuthorizationBudget,
  type CommunityGrant,
  communityDependency,
} from './community-availability.js'
// Story 6.5 owner: fresh primary eligibility, including serialization-time flag expiry.
import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_BANNED_MESSAGE,
  type CommunityBannedError,
} from '@couture/api-client/contracts/http'
import { calculateAge } from '@couture/utils'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { assertWardrobeParticipationAllowed } from '../guardian/guardian-participation.js'
import { assertCommunitySubjectAvailable } from './community-privacy.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

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
    await (tx === this.prisma
      ? assertCommunitySubjectPresent(this.prisma, member, budget)
      : communityDependency(() =>
          budget.run(() => assertCommunitySubjectAvailable(tx, member))
        ))
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
          ? budget.connection(() =>
              interactiveTransaction(
                this.prisma,
                async (connection) => {
                  await connection.$executeRawUnsafe(
                    `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
                  )
                  await this.assertDatabase(member, connection)
                },
                () => ({ timeout: budget.remaining(), maxWait: budget.remaining() })
              )
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

/**
 * Erasure is a primary-backed terminal denial, established before any flag-cache read. The
 * cache only holds rows for an existing subject, so evaluating the flag first reports a
 * permanent erasure as a retryable outage. A real database failure still maps to unavailable.
 */
export async function assertCommunitySubjectPresent(
  prisma: PrismaClient,
  member: string,
  budget: CommunityAuthorizationBudget
): Promise<void> {
  await communityDependency(() =>
    budget.run(() =>
      budget.connection(() =>
        interactiveTransaction(
          prisma,
          async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
            )
            await assertCommunitySubjectAvailable(tx, member)
          },
          () => ({ timeout: budget.remaining(), maxWait: budget.remaining() })
        )
      )
    )
  )
}

/**
 * The member's active community ban, read from the primary with no cache.
 * `new Date()` is a bound parameter, so a temporary ban ends at `expires_at` with no worker and
 * no write. Active means not lifted and not past its expiry.
 */
export function findActiveCommunitySanction(
  tx: Pick<Prisma.TransactionClient, 'communitySanction'>,
  member: string,
  now: Date = new Date()
) {
  return tx.communitySanction.findFirst({
    where: {
      user_id: member,
      lifted_at: null,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  })
}

/**
 * Story 6.11 D9: the single refusal of a banned member. It names the kind, expiry and appeal
 * status and nothing about the reason, the moderator or the case.
 */
export async function assertCommunityMemberNotSanctioned(
  tx: Pick<Prisma.TransactionClient, 'communitySanction'>,
  member: string
): Promise<void> {
  const sanction = await findActiveCommunitySanction(tx, member)
  if (!sanction) return
  const body: CommunityBannedError = {
    statusCode: 403,
    code: 'community_banned',
    message: COMMUNITY_BANNED_MESSAGE,
    sanction: {
      kind: sanction.kind,
      expiresAt: sanction.expires_at?.toISOString() ?? null,
      appealStatus: sanction.appeal_status,
    },
  }
  throw new ForbiddenException(body)
}

export async function assertCommunityDatabaseReadAccess(
  tx: Prisma.TransactionClient,
  member: string,
  allowConsentPending = false
): Promise<void> {
  await assertCommunityMemberNotSanctioned(tx, member)
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
      budget.connection(() =>
        interactiveTransaction(
          prisma,
          async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL statement_timeout = '${Math.min(500, budget.remaining())}ms'`
            )
            await assertCommunityDatabaseReadAccess(tx, member, true)
          },
          () => ({ timeout: budget.remaining(), maxWait: budget.remaining() })
        )
      )
    )
  )
}
