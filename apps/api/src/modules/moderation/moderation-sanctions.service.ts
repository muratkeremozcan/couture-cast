// Story 6.11 owner: community bans and appeal steps in `apps/api/src/modules/moderation/moderation-sanctions.service.ts`.
// Enforcement is `assertCommunityMemberNotSanctioned`. This file writes the sanction, moves content and runs the after-commit steps.
import { randomUUID } from 'node:crypto'
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma, PrismaClient, type CommunitySanction } from '@prisma/client'
import {
  moderationAppealResponseSchema,
  moderationStoredAppealResultSchema,
  type ModerationAppealInput,
  type ModerationBanTerms,
  type ModerationCacheInvalidation,
  type ModerationSanction,
  type ModerationStoredAppealResult,
} from '@couture/api-client/contracts/http'
import { UserSessionService } from '../auth/user-session.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import {
  assertCommunityDatabaseAccess,
  findActiveCommunitySanction,
} from '../community/community-access.service.js'
import { returnBanHoldsToScreening } from '../community/community-ban-holds.js'
import {
  ModerationRecordWriteError,
  writeModerationRecord,
} from '../community/community-moderation.actions.js'
import {
  communityPrivacyTransaction,
  guardCommunitySubject,
} from '../community/community-privacy.js'
import { CommunitySpotlightService } from '../community/community-spotlight.service.js'
import { storedAreaComponents } from '../community/community-spotlight-area.js'
import { CommunityStreamRepository } from '../community/community-stream.repository.js'
import {
  buildDecisionAuditData,
  communityBanMarker,
  computeDecisionPayloadHash,
  computeViewerConflict,
  isUniqueViolation,
  MODERATION_QUEUE_CLOCK,
  moderationDecisionError,
  moderatorLogRef,
  type ModerationQueueClock,
} from './moderation-decision-rules.js'
import { ModerationDecisionsRepository } from './moderation-decisions.repository.js'
import { parseModerationCaseId } from './moderation-queue.repository.js'

type Tx = Prisma.TransactionClient

/** The longest one after-commit step may hold the response. */
export const MODERATION_AFTER_COMMIT_BOUND_MS = 1000
const DAY_MS = 86_400_000

/** The row's own CHECK ties a temporary ban to an expiry, and the contract says the same. */
export const toModerationSanction = (row: CommunitySanction): ModerationSanction =>
  row.kind === 'temporary'
    ? {
        sanctionId: row.id,
        kind: 'temporary',
        expiresAt: (row.expires_at as Date).toISOString(),
        appealStatus: row.appeal_status,
      }
    : {
        sanctionId: row.id,
        kind: 'permanent',
        expiresAt: null,
        appealStatus: row.appeal_status,
      }

/** When a ban ends. A permanent ban has no expiry. */
export const moderationSanctionExpiry = (
  terms: ModerationBanTerms,
  at: Date
): Date | null =>
  terms.kind === 'temporary' ? new Date(at.getTime() + terms.durationDays * DAY_MS) : null

export interface AfterCommitPlan {
  /** Which spotlight read models to bump. */
  spotlight:
    | { scope: 'none' }
    | { scope: 'all' }
    | { scope: 'post'; postId: string | null }
  /** The decision changed public visibility, so connected clients should hear now. */
  assist: boolean
  /** The member whose sessions the ban ends, when a session store exists. */
  sessionsOf: string | null
}

/**
 * The work after commit. Every step is bounded and none throws, because the decision already stands
 * and the durable stream replays anything missed. A replay runs it again, which repairs a crash
 * between commit and these steps.
 */
@Injectable()
export class ModerationAfterCommit {
  private readonly logger = new Logger(ModerationAfterCommit.name)

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunitySpotlightService)
    private readonly spotlight: Pick<
      CommunitySpotlightService,
      'invalidatePostAreas' | 'invalidateAllAreas'
    >,
    @Inject(CommunityStreamRepository)
    private readonly streams: Pick<CommunityStreamRepository, 'assist'>,
    @Inject(UserSessionService) private readonly sessions: UserSessionService
  ) {}

  async run(plan: AfterCommitPlan): Promise<ModerationCacheInvalidation> {
    const steps: Promise<boolean>[] = []
    if (plan.spotlight.scope !== 'none')
      steps.push(this.bounded(() => this.bumpSpotlight(plan.spotlight)))
    if (plan.assist) steps.push(this.bounded(() => this.streams.assist()))
    const { sessionsOf } = plan
    if (sessionsOf)
      steps.push(this.bounded(() => this.sessions.invalidateUserSessions(sessionsOf)))
    const results = await Promise.all(steps)
    if (results.every(Boolean)) return 'completed'
    this.logger.warn({ event: 'moderation_cache_invalidation_deferred' })
    return 'deferred'
  }

  private async bumpSpotlight(spotlight: AfterCommitPlan['spotlight']): Promise<void> {
    if (spotlight.scope === 'all') return this.spotlight.invalidateAllAreas()
    if (spotlight.scope !== 'post' || !spotlight.postId) return
    const post = await this.prisma.lookbookPost.findUnique({
      where: { id: spotlight.postId },
      select: { area_country: true, area_region: true, area_city: true },
    })
    // A post that is gone cannot be mapped to the area it left.
    if (!post) return this.spotlight.invalidateAllAreas()
    return this.spotlight.invalidatePostAreas(storedAreaComponents(post))
  }

  private async bounded(step: () => Promise<unknown>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        step().then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), MODERATION_AFTER_COMMIT_BOUND_MS)
          const handle = timer as unknown as { unref?: () => void }
          handle.unref?.()
        }),
      ])
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}

@Injectable()
export class ModerationSanctionsService {
  private readonly logger = new Logger(ModerationSanctionsService.name)

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ModerationDecisionsRepository)
    private readonly repository: ModerationDecisionsRepository,
    @Inject(ModerationAfterCommit) private readonly afterCommit: ModerationAfterCommit,
    @Inject(MODERATION_QUEUE_CLOCK) private readonly clock: ModerationQueueClock
  ) {}

  /**
   * Moves the member's content for a ban. The caller holds the subject guard.
   *
   * Unpublished items are held for both kinds, because they are about to become visible and a
   * processor would otherwise turn them into `consent_suspended` and lose a comment body. Only a
   * permanent ban hides what is already public, and only it withdraws reactions.
   */
  async holdSubjectContent(
    tx: Tx,
    params: { subjectId: string; sanctionId: string; kind: ModerationBanTerms['kind'] }
  ): Promise<void> {
    const { subjectId, kind } = params
    const marker = communityBanMarker(params.sanctionId)
    const permanent = kind === 'permanent'
    if (permanent) await this.keepPriorReasons(tx, subjectId)
    await tx.lookbookPost.updateMany({
      where: {
        user_id: subjectId,
        status: { in: permanent ? ['published', 'pending_review'] : ['pending_review'] },
      },
      data: { status: 'flagged', moderation_reason: marker },
    })
    await tx.communityComment.updateMany({
      where: { user_id: subjectId, status: 'pending_screening' },
      data: { status: 'held_for_review', screening_reason: marker },
    })
    if (!permanent) return
    await tx.communityComment.updateMany({
      where: { user_id: subjectId, status: 'published' },
      data: { status: 'blocked', screening_reason: marker },
    })
    await tx.communityReaction.updateMany({
      where: { user_id: subjectId, selection: { not: null } },
      data: { selection: null, revision: { increment: 1 } },
    })
  }

  /**
   * A released row keeps its machine reason, and the marker must not cost it that for good. The
   * current reason replaces any older snapshot, null included, so a stale one never comes back.
   */
  private async keepPriorReasons(tx: Tx, subjectId: string): Promise<void> {
    const posts = await tx.lookbookPost.findMany({
      where: {
        user_id: subjectId,
        status: 'published',
        OR: [{ moderation_reason: { not: null } }, { ban_prior_reason: { not: null } }],
      },
      select: { id: true, moderation_reason: true },
    })
    for (const post of posts)
      await tx.lookbookPost.update({
        where: { id: post.id },
        data: { ban_prior_reason: post.moderation_reason },
      })
    const comments = await tx.communityComment.findMany({
      where: {
        user_id: subjectId,
        status: 'published',
        OR: [{ screening_reason: { not: null } }, { ban_prior_reason: { not: null } }],
      },
      select: { id: true, screening_reason: true },
    })
    for (const comment of comments)
      await tx.communityComment.update({
        where: { id: comment.id },
        data: { ban_prior_reason: comment.screening_reason },
      })
  }

  /** Writes the sanction row. An upgrade lifts the temporary ban it replaces. The decision row must exist. */
  async createSanction(
    tx: Tx,
    params: {
      sanctionId: string
      subjectId: string
      decisionId: string
      caseKey: string
      terms: ModerationBanTerms
      at: Date
    }
  ): Promise<CommunitySanction> {
    const { terms, at } = params
    const replaced = await tx.communitySanction.findMany({
      where: {
        user_id: params.subjectId,
        lifted_at: null,
        kind: 'temporary',
        expires_at: { gt: at },
      },
      select: { id: true },
    })
    await tx.communitySanction.updateMany({
      where: { id: { in: replaced.map((row) => row.id) } },
      data: { lifted_at: at, holds_released_at: at },
    })
    // What the replaced ban held now belongs to this one, so overturning this one can restore it.
    const held = replaced.map((row) => communityBanMarker(row.id))
    const marker = communityBanMarker(params.sanctionId)
    await tx.lookbookPost.updateMany({
      where: { user_id: params.subjectId, moderation_reason: { in: held } },
      data: { moderation_reason: marker },
    })
    await tx.communityComment.updateMany({
      where: { user_id: params.subjectId, screening_reason: { in: held } },
      data: { screening_reason: marker },
    })
    return writeModerationRecord(() =>
      tx.communitySanction.create({
        data: {
          id: params.sanctionId,
          user_id: params.subjectId,
          decision_id: params.decisionId,
          case_key: params.caseKey,
          kind: terms.kind,
          expires_at: moderationSanctionExpiry(terms, at),
          created_at: at,
        },
      })
    )
  }

  async recordAppeal(
    auth: RequestAuthContext,
    sanctionId: string,
    input: ModerationAppealInput
  ) {
    const payloadHash = computeDecisionPayloadHash({
      route: 'appeal',
      sanctionId,
      status: input.status,
      reason: input.reason,
    })

    let outcome: AppealOutcome
    try {
      outcome = await communityPrivacyTransaction(this.prisma, (tx) =>
        this.applyStep(tx, auth, sanctionId, input, payloadHash)
      )
    } catch (error) {
      if (isUniqueViolation(error, 'moderator_id', 'mutation_id')) {
        outcome = await communityPrivacyTransaction(this.prisma, async (tx) => {
          const existing = await this.repository.findByMutation(
            tx,
            auth.userId,
            input.mutationId
          )
          if (!existing) throw moderationDecisionError('appeal_transition_invalid')
          return this.replay(existing, payloadHash)
        })
      } else if (isUniqueViolation(error, 'case_key', 'sequence')) {
        throw moderationDecisionError('appeal_transition_invalid')
      } else if (error instanceof ModerationRecordWriteError) {
        throw moderationDecisionError('audit_unavailable')
      } else {
        throw error
      }
    }

    const overturned = outcome.stored.sanction.appealStatus === 'overturned'
    const cacheInvalidation = await this.afterCommit.run({
      spotlight: overturned ? { scope: 'all' } : { scope: 'none' },
      assist: overturned,
      sessionsOf: null,
    })
    if (!outcome.replayed)
      this.logger.log({
        event: 'moderation_appeal_recorded',
        decisionId: outcome.stored.decisionId,
        status: input.status,
        role: auth.role,
        moderator: moderatorLogRef(auth.userId),
      })
    return moderationAppealResponseSchema.parse({
      data: { ...outcome.stored, replayed: outcome.replayed, cacheInvalidation },
    })
  }

  private replay(
    existing: { payload_hash: string; response: Prisma.JsonValue },
    payloadHash: string
  ): AppealOutcome {
    if (existing.payload_hash !== payloadHash)
      throw moderationDecisionError('idempotency_mismatch')
    return {
      replayed: true,
      stored: moderationStoredAppealResultSchema.parse(existing.response),
    }
  }

  private async applyStep(
    tx: Tx,
    auth: RequestAuthContext,
    sanctionId: string,
    input: ModerationAppealInput,
    payloadHash: string
  ): Promise<AppealOutcome> {
    const head = await tx.communitySanction.findUnique({ where: { id: sanctionId } })
    if (head) await this.repository.lockCase(tx, head.case_key)
    const existing = await this.repository.findByMutation(
      tx,
      auth.userId,
      input.mutationId
    )
    if (existing) return this.replay(existing, payloadHash)
    if (!head) throw moderationDecisionError('sanction_not_found')

    await this.repository.lockSanctionEligibility(tx, auth.userId, null)
    const at = this.clock()
    if (await findActiveCommunitySanction(tx, auth.userId, at))
      throw moderationDecisionError('operator_sanctioned')
    const origin = await tx.moderationDecision.findUniqueOrThrow({
      where: { id: head.decision_id },
    })
    if (await this.appealViewerConflict(tx, auth.userId, head))
      throw moderationDecisionError('self_review_refused')
    if (input.status !== 'requested' && auth.role !== 'admin')
      throw moderationDecisionError('admin_required')

    if (input.status === 'overturned') await guardCommunitySubject(tx, head.user_id)
    await tx.$queryRaw`SELECT id FROM "CommunitySanction" WHERE id = ${sanctionId} FOR UPDATE`
    const sanction = await tx.communitySanction.findUniqueOrThrow({
      where: { id: sanctionId },
    })
    this.assertTransition(sanction, input.status, at)

    await tx.communitySanction.update({
      where: { id: sanctionId },
      data: {
        appeal_status: input.status,
        ...(input.status === 'overturned' ? { lifted_at: at } : {}),
      },
    })
    const restoredCount =
      input.status === 'overturned'
        ? await this.restoreContent(tx, sanction.user_id, sanction, at)
        : 0

    const decisionId = randomUUID()
    const stored = moderationStoredAppealResultSchema.parse({
      decisionId,
      decidedAt: at.toISOString(),
      sanction: toModerationSanction({
        ...sanction,
        appeal_status: input.status,
      }),
      active: input.status !== 'overturned',
      restoredCount,
    } satisfies ModerationStoredAppealResult)
    const sequence = (await this.repository.newestSequence(tx, sanction.case_key)) + 1
    await writeModerationRecord(() =>
      this.repository.insertDecision(tx, {
        id: decisionId,
        case_key: sanction.case_key,
        sequence,
        source: origin.source,
        post_id: origin.post_id,
        comment_id: origin.comment_id,
        report_ids: origin.report_ids,
        action: `appeal_${input.status}`,
        reason: input.reason,
        moderator_id: auth.userId,
        moderator_role: auth.role,
        subject_user_id: sanction.user_id,
        subject_alias: origin.subject_alias,
        mutation_id: input.mutationId,
        payload_hash: payloadHash,
        response: stored,
        is_terminal: false,
        decided_at: at,
      })
    )
    await writeModerationRecord(() =>
      tx.auditLog.create({
        data: {
          user_id: auth.userId,
          event_type: 'moderation_appeal_recorded',
          event_data: buildDecisionAuditData({
            decisionId,
            caseId: sanction.case_key,
            action: `appeal_${input.status}`,
            role: auth.role,
          }),
        },
      })
    )
    return { replayed: false, stored }
  }

  /**
   * One rule for the appeal controls and the appeal route: the sanction's subject and the author
   * and every reporter of the case it came from, whichever case the viewer has open.
   */
  async appealViewerConflict(
    tx: Tx,
    viewerId: string,
    sanction: Pick<CommunitySanction, 'user_id' | 'case_key' | 'decision_id'>
  ): Promise<boolean> {
    const origin = await tx.moderationDecision.findUniqueOrThrow({
      where: { id: sanction.decision_id },
      select: { report_ids: true },
    })
    return computeViewerConflict({
      viewerId,
      authorId: sanction.user_id,
      reporterIds: await this.originReporters(tx, sanction.case_key, origin.report_ids),
    })
  }

  /** The reporters of the originating case, those of the decision and any filed since. */
  private async originReporters(
    tx: Tx,
    caseKey: string,
    reportIds: readonly string[]
  ): Promise<(string | null)[]> {
    const id = parseModerationCaseId(caseKey)
    const current = id ? await this.repository.loadCase(tx, id) : null
    const ids = [...reportIds]
    const [posts, comments] = await Promise.all([
      tx.communityPostReport.findMany({
        where: { id: { in: ids } },
        select: { reporter_id: true },
      }),
      tx.communityCommentReport.findMany({
        where: { id: { in: ids } },
        select: { reporter_id: true },
      }),
    ])
    return [
      ...(current?.reports.map((report) => report.reporterId) ?? []),
      ...posts.map((row) => row.reporter_id),
      ...comments.map((row) => row.reporter_id),
    ]
  }

  private assertTransition(
    sanction: CommunitySanction,
    step: ModerationAppealInput['status'],
    at: Date
  ): void {
    const active =
      sanction.lifted_at === null &&
      (sanction.expires_at === null || sanction.expires_at > at)
    const legal =
      step === 'requested'
        ? sanction.appeal_status === 'not_requested'
        : sanction.appeal_status === 'requested'
    if (!active || !legal) throw moderationDecisionError('appeal_transition_invalid')
  }

  /**
   * The ban is already lifted here, so the access check below judges only the member's own
   * eligibility. A teen whose guardian revoked consent during the ban stays hidden: consent
   * revocation has no restore path by design, and an overturned ban must not become one.
   */
  private async restoreContent(
    tx: Tx,
    subjectId: string,
    sanction: CommunitySanction,
    at: Date
  ): Promise<number> {
    try {
      await assertCommunityDatabaseAccess(tx, subjectId)
    } catch (error) {
      // Unstamped, so the expiry sweep owes it: that path re-checks through screening and publishes nothing.
      if (error instanceof ForbiddenException) return 0
      throw error
    }
    const marker = communityBanMarker(sanction.id)
    const postWhere = {
      user_id: subjectId,
      status: 'flagged',
      moderation_reason: marker,
      published_at: { not: null },
      erasure_requested_at: null,
      anonymized_at: null,
    } satisfies Prisma.LookbookPostWhereInput
    const priorPosts = await tx.lookbookPost.findMany({
      where: { ...postWhere, ban_prior_reason: { not: null } },
      select: { id: true, ban_prior_reason: true },
    })
    const posts = await tx.lookbookPost.updateMany({
      where: postWhere,
      data: { status: 'published', moderation_reason: null },
    })
    for (const post of priorPosts)
      await tx.lookbookPost.update({
        where: { id: post.id },
        data: { moderation_reason: post.ban_prior_reason, ban_prior_reason: null },
      })
    const commentWhere = {
      user_id: subjectId,
      status: 'blocked',
      screening_reason: marker,
      publication_sequence: { not: null },
    } satisfies Prisma.CommunityCommentWhereInput
    const priorComments = await tx.communityComment.findMany({
      where: { ...commentWhere, ban_prior_reason: { not: null } },
      select: { id: true, ban_prior_reason: true },
    })
    const comments = await tx.communityComment.updateMany({
      where: commentWhere,
      data: { status: 'published', screening_reason: null },
    })
    for (const comment of priorComments)
      await tx.communityComment.update({
        where: { id: comment.id },
        data: { screening_reason: comment.ban_prior_reason, ban_prior_reason: null },
      })
    // An overturn means the ban was wrong, so what was never public goes back through screening.
    await returnBanHoldsToScreening(tx, subjectId, [sanction.id], at)
    await tx.communitySanction.update({
      where: { id: sanction.id },
      data: { holds_released_at: at },
    })
    return posts.count + comments.count
  }
}

interface AppealOutcome {
  replayed: boolean
  stored: ModerationStoredAppealResult
}
