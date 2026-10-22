import {
  CommunityAuthorizationBudget,
  communityDependency,
} from './community-availability.js'
// Story 6.4 owner: rollout and transactional eligibility for comment operations.
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  type CommunityPlatform,
  type CommunityReportReason,
  type CreateCommunityCommentInput,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { GuardianService } from '../guardian/guardian.service.js'
import { CommunityCommentsRepository } from './community-comments.repository.js'

@Injectable()
export class CommunityCommentsService {
  constructor(
    @Inject(CommunityCommentsRepository)
    private readonly repository: CommunityCommentsRepository,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(GuardianService) private readonly guardian: GuardianService
  ) {}

  private async readAuthorized<T>(member: string, work: () => Promise<T>): Promise<T> {
    const budget = new CommunityAuthorizationBudget()
    return communityDependency(() =>
      budget.run(async () => {
        // An erased subject is a terminal denial before any flag-cache read (D3).
        await this.repository.assertSubjectAvailable(member, budget)
        let grant = await this.flags.communityReadEvaluation(member, budget)
        if (!grant.value)
          throw new ForbiddenException({
            statusCode: 403,
            code: 'denied',
            message: COMMUNITY_FEED_DISABLED_MESSAGE,
          })
        await this.repository.assertReadEligibility(member, budget)
        const result = await work()
        await this.repository.assertReadEligibility(member, budget)
        if (performance.now() >= grant.validUntil)
          grant = await this.flags.communityReadEvaluation(member, budget)
        budget.check(grant)
        if (!grant.value)
          throw new ForbiddenException({
            statusCode: 403,
            code: 'denied',
            message: COMMUNITY_FEED_DISABLED_MESSAGE,
          })
        return result
      })
    )
  }
  private async eligibility(userId: string, create = false) {
    const read = await this.flags.getFeatureFlag('community_read_enabled', userId)
    if (!read) throw new ServiceUnavailableException(COMMUNITY_FEED_DISABLED_MESSAGE)
    const write = create
      ? await this.flags.getFeatureFlag('community_write_enabled', userId)
      : false
    return async (tx: Prisma.TransactionClient, participation: boolean) => {
      const profile = await tx.userProfile.findUnique({ where: { user_id: userId } })
      const born = profile?.birthdate
      const now = new Date()
      const cutoff = new Date(
        Date.UTC(now.getUTCFullYear() - 13, now.getUTCMonth(), now.getUTCDate())
      )
      if (!born || born > cutoff)
        throw new ForbiddenException(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
      if (participation) {
        if (!write) throw new ServiceUnavailableException(COMMUNITY_FEED_DISABLED_MESSAGE)
        try {
          await this.guardian.assertWardrobeUploadAllowed(userId, undefined, tx)
        } catch (error) {
          if (error instanceof ForbiddenException)
            throw new ForbiddenException(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
          throw error
        }
      }
    }
  }

  async list(params: {
    userId: string
    postId: string
    parentId: string | null
    cursor?: string
    limit: number
  }) {
    return this.readAuthorized(params.userId, () => this.listSnapshot(params))
  }
  private async listSnapshot(params: {
    userId: string
    postId: string
    parentId: string | null
    cursor?: string
    limit: number
  }) {
    return this.repository.list({
      ...params,
      eligible: await this.eligibility(params.userId),
    })
  }

  async submissions(params: {
    userId: string
    postId: string
    cursor?: string
    limit: number
  }) {
    return this.readAuthorized(params.userId, () => this.submissionsSnapshot(params))
  }
  private async submissionsSnapshot(params: {
    userId: string
    postId: string
    cursor?: string
    limit: number
  }) {
    return this.repository.submissions({
      ...params,
      eligible: await this.eligibility(params.userId),
    })
  }

  async create(params: {
    userId: string
    postId: string
    input: CreateCommunityCommentInput
    platform: CommunityPlatform
  }) {
    return this.repository.create({
      ...params,
      eligible: await this.eligibility(params.userId, true),
    })
  }

  async delete(params: {
    userId: string
    postId: string
    commentId: string
    platform: CommunityPlatform
  }) {
    return this.repository.delete({
      ...params,
      eligible: await this.eligibility(params.userId),
    })
  }

  async report(params: {
    userId: string
    postId: string
    commentId: string
    reason: CommunityReportReason
    platform: CommunityPlatform
  }) {
    return this.repository.report({
      ...params,
      eligible: await this.eligibility(params.userId),
    })
  }
}
