// Story 6.11 owner: applying one moderation decision to a whole case in `apps/api/src/modules/moderation/moderation-decisions.service.ts`.
// One decision is one transaction: target change, report stamps, sanction, decision row and audit row commit together.
// The order inside it is the serialization proof: case lock, replay, case read, sanction eligibility locks, privacy guard, member lock, post row lock, then the revision read.
// Report intake takes only the post row lock, so a revision read any earlier could stamp a report nobody reviewed.
import { randomUUID } from 'node:crypto'
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClient, type Prisma } from '@prisma/client'
import {
  deriveAllowedActions,
  deriveAllowedAppealSteps,
  moderationActionAvailability,
  moderationDecisionResponseSchema,
  moderationStoredDecisionResultSchema,
  moderationViewerRefusal,
  type ModerationAvailabilityInput,
  type ModerationCaseDecisionState,
  type ModerationDecisionAction,
  type ModerationDecisionInput,
  type ModerationSanctionKind,
  type ModerationStoredDecisionResult,
} from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../auth/security.types.js'
import {
  assertCommunityDatabaseAccess,
  findActiveCommunitySanction,
} from '../community/community-access.service.js'
import {
  CommunityModerationActionsService,
  ModerationRecordWriteError,
  writeModerationRecord,
  type OperatorEffect,
} from '../community/community-moderation.actions.js'
import {
  communityPrivacyTransaction,
  guardCommunityPost,
  guardCommunitySubject,
} from '../community/community-privacy.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  buildDecisionAuditData,
  computeDecisionPayloadHash,
  computeModerationCaseRevision,
  computeViewerConflict,
  isUniqueViolation,
  MODERATION_QUEUE_CLOCK,
  moderationDecisionError,
  moderatorLogRef,
  summarizeDecisionHistory,
  type ModerationQueueClock,
} from './moderation-decision-rules.js'
import {
  decisionCaseOpenReportIds,
  decisionCaseSubject,
  decisionCaseTargetState,
  decisionCaseTargetStatus,
  ModerationDecisionsRepository,
  type DecisionCase,
} from './moderation-decisions.repository.js'
import { parseModerationCaseId } from './moderation-queue.repository.js'
import {
  ModerationAfterCommit,
  moderationSanctionExpiry,
  ModerationSanctionsService,
  toModerationSanction,
  type AfterCommitPlan,
} from './moderation-sanctions.service.js'

type Tx = Prisma.TransactionClient

interface DecisionOutcome {
  replayed: boolean
  stored: ModerationStoredDecisionResult
  postId: string | null
  subjectId: string | null
}

/** What the row must hold for a replay to repeat the same after-commit work. */
function afterCommitPlan(outcome: DecisionOutcome): AfterCommitPlan {
  const { action, sanction } = outcome.stored
  if (action === 'resolve' || action === 'escalate')
    return { spotlight: { scope: 'none' }, assist: false, sessionsOf: null }
  return {
    spotlight:
      sanction?.kind === 'permanent'
        ? { scope: 'all' }
        : outcome.postId
          ? { scope: 'post', postId: outcome.postId }
          : { scope: 'none' },
    assist: true,
    sessionsOf: action === 'ban' ? outcome.subjectId : null,
  }
}

/** Read-only, so no write can fail it, and short enough that one read never holds a connection long. */
const CASE_SNAPSHOT_OPTIONS = {
  isolationLevel: 'RepeatableRead',
  timeout: 7000,
  maxWait: 1000,
} as const

@Injectable()
export class ModerationDecisionsService {
  private readonly logger = new Logger(ModerationDecisionsService.name)

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ModerationDecisionsRepository)
    private readonly repository: ModerationDecisionsRepository,
    @Inject(CommunityModerationActionsService)
    private readonly operator: CommunityModerationActionsService,
    @Inject(ModerationSanctionsService)
    private readonly sanctions: ModerationSanctionsService,
    @Inject(ModerationAfterCommit) private readonly afterCommit: ModerationAfterCommit,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(MODERATION_QUEUE_CLOCK) private readonly clock: ModerationQueueClock
  ) {}

  async decide(auth: RequestAuthContext, caseId: string, input: ModerationDecisionInput) {
    const payloadHash = computeDecisionPayloadHash({
      route: 'decision',
      caseId,
      action: input.action,
      reason: input.reason,
      ...(input.action === 'ban' ? { ban: input.ban } : {}),
    })
    // Flags are external state, so they resolve before any lock.
    const writesOpen =
      input.action === 'release' ? await this.writesOpenForCase(caseId) : true

    let outcome: DecisionOutcome
    try {
      outcome = await communityPrivacyTransaction(this.prisma, (tx) =>
        this.applyDecision(tx, auth, caseId, input, payloadHash, writesOpen)
      )
    } catch (error) {
      outcome = await this.recover(error, auth, caseId, input.mutationId, payloadHash)
    }

    const cacheInvalidation = await this.afterCommit.run(afterCommitPlan(outcome))
    if (!outcome.replayed)
      this.logger.log({
        event: 'moderation_decision_applied',
        decisionId: outcome.stored.decisionId,
        action: outcome.stored.action,
        role: auth.role,
        moderator: moderatorLogRef(auth.userId),
      })
    return moderationDecisionResponseSchema.parse({
      data: { ...outcome.stored, replayed: outcome.replayed, cacheInvalidation },
    })
  }

  /**
   * The decision fields of a case detail, computed by the rule the decision path enforces.
   * `readVisible` loads what the caller displays. It runs in this method's snapshot, so the revision
   * cannot cover a report that committed after the displayed evidence was read.
   * Answers null when the case does not exist.
   */
  async describeCase<Visible>(
    auth: RequestAuthContext,
    caseId: string,
    readVisible: (tx: Tx) => Promise<Visible | null>
  ): Promise<{ visible: Visible; state: ModerationCaseDecisionState } | null> {
    const id = parseModerationCaseId(caseId)
    if (!id) return null
    const now = this.clock()
    const read = await interactiveTransaction(
      this.prisma,
      async (tx) => {
        const visible = await readVisible(tx)
        const loaded = visible ? await this.repository.loadCase(tx, id) : null
        if (!visible || !loaded) return null
        const subject = decisionCaseSubject(loaded)
        const history = summarizeDecisionHistory(
          await this.repository.decisionHistory(
            tx,
            caseId,
            loaded.reports.map((report) => report.id)
          ),
          caseId
        )
        const sanctions = subject ? await this.repository.sanctionsOf(tx, subject) : []
        const active = subject
          ? await findActiveCommunitySanction(tx, subject, now)
          : null
        const newest = sanctions[0]
        return {
          visible,
          loaded,
          subject,
          history,
          sanctions,
          active,
          newest,
          availability: await this.availabilityInput(tx, auth, loaded, {
            escalated: history.escalated,
            subjectBan: active?.kind ?? null,
            writesOpen: false,
            now,
          }),
          appealConflict: newest
            ? await this.sanctions.appealViewerConflict(tx, auth.userId, newest)
            : false,
        }
      },
      CASE_SNAPSHOT_OPTIONS
    )
    if (!read) return null

    // Flags are external state, so they resolve after the snapshot closes.
    const { loaded, subject, history, sanctions, active, newest } = read
    const decisionsOpen = await this.decisionsFlagOpen(auth.userId)
    const availability = {
      ...read.availability,
      writesOpen: decisionsOpen ? await this.writesOpenFor(subject) : false,
    }
    return {
      visible: read.visible,
      state: {
        revision: computeModerationCaseRevision({
          sequence: history.sequence,
          openReportIds: decisionCaseOpenReportIds(loaded),
          targetStatus: decisionCaseTargetStatus(loaded),
        }),
        ...(decisionsOpen
          ? deriveAllowedActions(availability)
          : { allowedActions: [], banKinds: [] }),
        escalated: history.escalated,
        firstDecisionAt: history.firstDecisionAt?.toISOString() ?? null,
        subjectStanding: subject
          ? {
              active: active !== null,
              sanction: newest ? toModerationSanction(newest) : null,
              priorBanCount: Math.max(sanctions.length - 1, 0),
              allowedAppealSteps:
                decisionsOpen && newest
                  ? deriveAllowedAppealSteps({
                      role: availability.role,
                      viewerConflict: read.appealConflict,
                      operatorSanctioned: availability.operatorSanctioned,
                      sanctionActive: active?.id === newest.id,
                      appealStatus: newest.appeal_status,
                    })
                  : [],
            }
          : null,
      },
    }
  }

  private async decisionsFlagOpen(userId: string): Promise<boolean> {
    try {
      return await this.flags.getFeatureFlag('moderation_decisions_enabled', userId)
    } catch {
      return false
    }
  }

  private async writesOpenForCase(caseId: string): Promise<boolean> {
    const id = parseModerationCaseId(caseId)
    const loaded = id ? await this.repository.loadCase(this.prisma, id) : null
    return loaded ? this.writesOpenFor(decisionCaseSubject(loaded)) : false
  }

  private async writesOpenFor(subject: string | null): Promise<boolean> {
    if (!subject) return false
    try {
      return await this.flags.getFeatureFlag('community_write_enabled', subject)
    } catch {
      return false
    }
  }

  private async availabilityInput(
    tx: Tx,
    auth: RequestAuthContext,
    loaded: DecisionCase,
    state: {
      escalated: boolean
      subjectBan: ModerationSanctionKind | null
      writesOpen: boolean
      now: Date
    }
  ): Promise<ModerationAvailabilityInput> {
    const subject = decisionCaseSubject(loaded)
    return {
      role: auth.role === 'admin' ? 'admin' : 'moderator',
      viewerConflict: computeViewerConflict({
        viewerId: auth.userId,
        authorId: subject,
        reporterIds: loaded.reports.map((report) => report.reporterId),
      }),
      operatorSanctioned:
        (await findActiveCommunitySanction(tx, auth.userId, state.now)) !== null,
      escalated: state.escalated,
      openReportCount: decisionCaseOpenReportIds(loaded).length,
      target: decisionCaseTargetState(loaded),
      subjectBan: state.subjectBan,
      authorEligible: await this.authorEligible(tx, loaded),
      writesOpen: state.writesOpen,
    }
  }

  /** Only a held target asks: a release is the one action that reads this. */
  private async authorEligible(tx: Tx, loaded: DecisionCase): Promise<boolean> {
    const subject = decisionCaseSubject(loaded)
    const status = decisionCaseTargetStatus(loaded)
    if (!subject || status === null || status === 'published') return false
    try {
      await assertCommunityDatabaseAccess(tx, subject)
    } catch (error) {
      if (error instanceof ForbiddenException) return false
      throw error
    }
    return loaded.comment ? this.operator.commentCanPublish(tx, loaded.comment) : true
  }

  private replay(
    existing: {
      payload_hash: string
      response: Prisma.JsonValue
      post_id: string | null
      subject_user_id: string | null
    },
    payloadHash: string
  ): DecisionOutcome {
    if (existing.payload_hash !== payloadHash)
      throw moderationDecisionError('idempotency_mismatch')
    return {
      replayed: true,
      stored: moderationStoredDecisionResultSchema.parse(existing.response),
      postId: existing.post_id,
      subjectId: existing.subject_user_id,
    }
  }

  private async recover(
    error: unknown,
    auth: RequestAuthContext,
    caseId: string,
    mutationId: string,
    payloadHash: string
  ): Promise<DecisionOutcome> {
    if (isUniqueViolation(error, 'moderator_id', 'mutation_id')) {
      // Postgres aborted that transaction, so the winning row is read in a new one.
      const existing = await this.repository.findByMutation(
        this.prisma,
        auth.userId,
        mutationId
      )
      if (!existing) throw moderationDecisionError('case_conflict')
      return this.replay(existing, payloadHash)
    }
    if (isUniqueViolation(error, 'case_key', 'sequence')) {
      const currentRevision = await this.currentRevision(caseId)
      throw moderationDecisionError(
        'case_conflict',
        currentRevision ? { currentRevision } : {}
      )
    }
    if (error instanceof ModerationRecordWriteError)
      throw moderationDecisionError('audit_unavailable')
    throw error
  }

  private async currentRevision(caseId: string): Promise<string | null> {
    const id = parseModerationCaseId(caseId)
    const loaded = id ? await this.repository.loadCase(this.prisma, id) : null
    if (!loaded) return null
    const history = summarizeDecisionHistory(
      await this.repository.decisionHistory(
        this.prisma,
        caseId,
        loaded.reports.map((report) => report.id)
      ),
      caseId
    )
    return computeModerationCaseRevision({
      sequence: history.sequence,
      openReportIds: decisionCaseOpenReportIds(loaded),
      targetStatus: decisionCaseTargetStatus(loaded),
    })
  }

  private async applyDecision(
    tx: Tx,
    auth: RequestAuthContext,
    caseId: string,
    input: ModerationDecisionInput,
    payloadHash: string,
    writesOpen: boolean
  ): Promise<DecisionOutcome> {
    const id = parseModerationCaseId(caseId)
    if (id) await this.repository.lockCase(tx, caseId)
    const existing = await this.repository.findByMutation(
      tx,
      auth.userId,
      input.mutationId
    )
    if (existing) return this.replay(existing, payloadHash)
    if (!id) throw moderationDecisionError('case_not_found')
    const before = await this.repository.loadCase(tx, id)
    if (!before) throw moderationDecisionError('case_not_found')

    await this.repository.lockSanctionEligibility(
      tx,
      auth.userId,
      input.action === 'ban' ? decisionCaseSubject(before) : null
    )
    await this.takeTargetLocks(tx, before, input.action)

    // Everything below reads the case as the locks now hold it.
    const loaded = await this.repository.loadCase(tx, id)
    if (!loaded) throw moderationDecisionError('case_not_found')
    const at = this.clock()
    const history = summarizeDecisionHistory(
      await this.repository.decisionHistory(
        tx,
        caseId,
        loaded.reports.map((report) => report.id)
      ),
      caseId
    )
    await this.assertDecidable(tx, auth, loaded, input, history, writesOpen, at)

    const decisionId = randomUUID()
    const sanctionId = input.action === 'ban' ? randomUUID() : null
    const newStatus = await this.applyEffects(tx, auth, loaded, input, at, sanctionId)
    const stored = this.buildStoredResult({
      decisionId,
      sanctionId,
      caseId,
      input,
      loaded,
      history,
      newStatus,
      at,
    })
    await this.writeRecord(tx, auth, {
      decisionId,
      sanctionId,
      caseId,
      input,
      loaded,
      payloadHash,
      stored,
      sequence: history.sequence + 1,
      at,
    })
    return {
      replayed: false,
      stored,
      postId: loaded.post?.id ?? null,
      subjectId: decisionCaseSubject(loaded),
    }
  }

  /** Refusals in the order the spec fixes: viewer, then the revision, then the state of the case. */
  private async assertDecidable(
    tx: Tx,
    auth: RequestAuthContext,
    loaded: DecisionCase,
    input: ModerationDecisionInput,
    history: ReturnType<typeof summarizeDecisionHistory>,
    writesOpen: boolean,
    at: Date
  ): Promise<void> {
    const subject = decisionCaseSubject(loaded)
    const activeBan = subject ? await findActiveCommunitySanction(tx, subject, at) : null
    const availability = await this.availabilityInput(tx, auth, loaded, {
      escalated: history.escalated,
      subjectBan: activeBan?.kind ?? null,
      writesOpen,
      now: at,
    })
    const banKind = input.action === 'ban' ? input.ban.kind : undefined
    const refusal = moderationViewerRefusal(availability, input.action, banKind)
    if (refusal) throw moderationDecisionError(refusal)
    const currentRevision = computeModerationCaseRevision({
      sequence: history.sequence,
      openReportIds: decisionCaseOpenReportIds(loaded),
      targetStatus: decisionCaseTargetStatus(loaded),
    })
    if (currentRevision !== input.expectedRevision)
      throw moderationDecisionError('case_conflict', { currentRevision })
    const available = moderationActionAvailability(availability, input.action, banKind)
    if (!available.available)
      throw moderationDecisionError(
        available.code,
        'detail' in available ? { detail: available.detail } : {}
      )
  }

  private buildStoredResult(params: {
    decisionId: string
    sanctionId: string | null
    caseId: string
    input: ModerationDecisionInput
    loaded: DecisionCase
    history: ReturnType<typeof summarizeDecisionHistory>
    newStatus: string | null
    at: Date
  }): ModerationStoredDecisionResult {
    const { decisionId, sanctionId, caseId, input, loaded, history, newStatus, at } =
      params
    const isTerminal = input.action !== 'escalate'
    const openAfter = isTerminal ? [] : decisionCaseOpenReportIds(loaded)
    const firstDecisionAt = history.firstDecisionAt ?? (isTerminal ? at : null)
    return moderationStoredDecisionResultSchema.parse({
      decisionId,
      caseId,
      action: input.action,
      decidedAt: at.toISOString(),
      firstDecisionAt: firstDecisionAt?.toISOString() ?? null,
      revision: computeModerationCaseRevision({
        sequence: history.sequence + 1,
        openReportIds: openAfter,
        targetStatus: newStatus,
      }),
      caseStatus: openAfter.length > 0 ? 'open' : 'resolved',
      escalated: !isTerminal,
      targetStatus: newStatus,
      sanction:
        input.action === 'ban' && sanctionId
          ? {
              sanctionId,
              kind: input.ban.kind,
              expiresAt: moderationSanctionExpiry(input.ban, at)?.toISOString() ?? null,
              appealStatus: 'not_requested',
            }
          : null,
    } satisfies ModerationStoredDecisionResult)
  }

  /** The attributed record: the decision row, the sanction it created and the audit row. */
  private async writeRecord(
    tx: Tx,
    auth: RequestAuthContext,
    params: {
      decisionId: string
      sanctionId: string | null
      caseId: string
      input: ModerationDecisionInput
      loaded: DecisionCase
      payloadHash: string
      stored: ModerationStoredDecisionResult
      sequence: number
      at: Date
    }
  ): Promise<void> {
    const { decisionId, sanctionId, caseId, input, loaded, at } = params
    const subject = decisionCaseSubject(loaded)
    const subjectAlias = await this.repository.subjectAlias(tx, loaded)
    await writeModerationRecord(() =>
      this.repository.insertDecision(tx, {
        id: decisionId,
        case_key: caseId,
        sequence: params.sequence,
        source: loaded.id.source,
        post_id: loaded.post?.id ?? null,
        comment_id: loaded.comment?.id ?? null,
        report_ids: loaded.reports.map((report) => report.id),
        action: input.action,
        reason: input.reason,
        moderator_id: auth.userId,
        moderator_role: auth.role,
        subject_user_id: subject,
        subject_alias: subjectAlias,
        mutation_id: input.mutationId,
        payload_hash: params.payloadHash,
        response: params.stored,
        is_terminal: input.action !== 'escalate',
        decided_at: at,
      })
    )
    if (input.action === 'ban' && sanctionId && subject)
      await this.sanctions.createSanction(tx, {
        sanctionId,
        subjectId: subject,
        decisionId,
        caseKey: caseId,
        terms: input.ban,
        at,
      })
    await writeModerationRecord(() =>
      tx.auditLog.create({
        data: {
          user_id: auth.userId,
          event_type: 'moderation_decision_applied',
          event_data: buildDecisionAuditData({
            decisionId,
            caseId,
            action: input.action,
            role: auth.role,
            ...(input.action === 'ban' ? { banKind: input.ban.kind } : {}),
          }),
        },
      })
    )
  }

  private async takeTargetLocks(
    tx: Tx,
    loaded: DecisionCase,
    action: ModerationDecisionAction
  ): Promise<void> {
    const subject = decisionCaseSubject(loaded)
    const postId = loaded.post?.id ?? loaded.comment?.post_id ?? null
    if (action === 'ban' && subject) {
      // Takes the member guard, every related post guard, the member, report and submission locks and the post rows.
      await guardCommunitySubject(tx, subject)
    } else {
      if (postId) await guardCommunityPost(tx, postId)
      if (subject)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${subject}))`
    }
    if (!postId) return
    try {
      await this.operator.lockPost(tx, postId)
    } catch (error) {
      // Erasure removed the post after the first read, and its case key is gone with it.
      if (error instanceof NotFoundException)
        throw moderationDecisionError('case_not_found')
      throw error
    }
  }

  /** Applies the action and returns the target's status afterwards. */
  private async applyEffects(
    tx: Tx,
    auth: RequestAuthContext,
    loaded: DecisionCase,
    input: ModerationDecisionInput,
    at: Date,
    sanctionId: string | null
  ): Promise<string | null> {
    const effect = { operatorId: auth.userId, reason: input.reason, at }
    const status = decisionCaseTargetStatus(loaded)
    if (input.action === 'escalate') {
      await this.recordTargetAction(tx, loaded, effect, 'escalated_by_operator')
      return status
    }

    let next = status
    if (input.action === 'release') {
      await this.releaseTarget(tx, loaded, effect)
      next = 'published'
    }
    if (input.action === 'takedown') {
      next = await this.takeDownTarget(tx, loaded, effect)
    }
    if (input.action === 'ban') {
      if (status === 'published') next = await this.takeDownTarget(tx, loaded, effect)
      await this.sanctions.holdSubjectContent(tx, {
        subjectId: decisionCaseSubject(loaded) as string,
        sanctionId: sanctionId as string,
        kind: input.ban.kind,
      })
      await this.recordTargetAction(tx, loaded, effect, 'banned_by_operator')
    }

    const reportIds = decisionCaseOpenReportIds(loaded)
    if (loaded.id.source === 'post')
      await this.operator.resolveOpenPostReports(tx, reportIds, effect)
    else await this.operator.resolveOpenCommentReports(tx, reportIds, effect)
    return next
  }

  private async releaseTarget(
    tx: Tx,
    { post, comment, reports }: DecisionCase,
    effect: OperatorEffect
  ): Promise<void> {
    if (post) return this.operator.applyPostRelease(tx, post, effect)
    if (!comment) return
    await this.operator.applyCommentRelease(tx, comment, effect)
    await this.recordCommentAction(tx, reports, effect, 'released_by_operator')
  }

  private async takeDownTarget(
    tx: Tx,
    { post, comment, reports }: DecisionCase,
    effect: OperatorEffect
  ): Promise<string | null> {
    if (post) {
      await this.operator.applyPostTakedown(tx, post, effect)
      return 'flagged'
    }
    if (!comment) return null
    await this.operator.applyCommentTakedown(tx, comment)
    await this.recordCommentAction(tx, reports, effect, 'taken_down_by_operator')
    return 'blocked'
  }

  /** The prior-action row of an action the operator service has no method for. */
  private async recordTargetAction(
    tx: Tx,
    { post, comment, reports }: DecisionCase,
    effect: OperatorEffect,
    action: string
  ): Promise<void> {
    if (comment) return this.recordCommentAction(tx, reports, effect, action)
    if (!post) return
    await writeModerationRecord(() =>
      tx.moderationEvent.create({
        data: {
          post_id: post.id,
          reviewed_by_id: effect.operatorId,
          action,
          reason: effect.reason,
          image_object_path: post.image_object_path,
          created_at: effect.at,
        },
      })
    )
  }

  /** A comment action writes one row on the newest report of the case. */
  private async recordCommentAction(
    tx: Tx,
    reports: DecisionCase['reports'],
    effect: OperatorEffect,
    action: string
  ): Promise<void> {
    await writeModerationRecord(() =>
      tx.communityCommentAudit.create({
        data: {
          report_id: reports.at(-1)?.id ?? null,
          action,
          reason: effect.reason,
          occurred_at: effect.at,
        },
      })
    )
  }
}
