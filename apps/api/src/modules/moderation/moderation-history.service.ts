// Story 6.13 owner: starting an erasure and exporting evidence, in `apps/api/src/modules/moderation/moderation-history.service.ts`.
import { randomUUID } from 'node:crypto'
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaClient, type ModerationDecision, type Prisma } from '@prisma/client'
import {
  MODERATION_ERASURE_DEADLINE_MS,
  MODERATION_EVIDENCE_BYTES_MAX,
  MODERATION_EVIDENCE_DECISIONS_MAX,
  MODERATION_EVIDENCE_SCHEMA_VERSION,
  isModerationEvidenceRangeValid,
  moderationEvidenceBundleSchema,
  type ModerationErasureResult,
  type ModerationEvidenceBundle,
  type ModerationEvidenceExportRequest,
  type ModerationHistoryErrorCode,
} from '@couture/api-client/contracts/http'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { viewerConflictsWithEvidence } from './moderation-case-conflict.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import {
  ModerationRecordWriteError,
  writeModerationRecord,
} from '../community/community-moderation.actions.js'
import { CommunityService } from '../community/community.service.js'
import {
  computeViewerConflict,
  MODERATION_QUEUE_CLOCK,
  type ModerationQueueClock,
} from './moderation-decision-rules.js'
import {
  decisionCaseSubject,
  ModerationDecisionsRepository,
} from './moderation-decisions.repository.js'
import {
  mapEvidenceDecision,
  ModerationHistoryRepository,
} from './moderation-history.repository.js'
import {
  buildModerationHistoryAuditData,
  moderationEvidenceDigest,
} from './moderation-history.rules.js'
import { parseModerationCaseId } from './moderation-queue.repository.js'

type Tx = Prisma.TransactionClient

/** One snapshot, so `counts`, the arrays and the digest always describe the same rows. Measured by `A-X-LOAD`. */
const EXPORT_TRANSACTION = {
  isolationLevel: 'RepeatableRead',
  timeout: 20_000,
  maxWait: 2000,
} as const

const ERROR_MESSAGES: Record<ModerationHistoryErrorCode, string> = {
  moderation_history_disabled: 'Moderation history is not available.',
  admin_required: 'This action needs an admin.',
  self_review_refused: 'You cannot export a case you wrote or reported.',
  member_not_found: 'No such member.',
  case_not_found: 'No such case.',
  invalid_request: 'Invalid request.',
  invalid_range: 'The period must start before it ends and span at most 90 days.',
  export_too_large: 'This export is too large. Choose a shorter period.',
  audit_unavailable: 'The audit record could not be written, so nothing was returned.',
}

export function moderationHistoryError(code: ModerationHistoryErrorCode): HttpException {
  const body = (statusCode: number) => ({
    statusCode,
    code,
    message: ERROR_MESSAGES[code],
  })
  switch (code) {
    case 'moderation_history_disabled':
    case 'audit_unavailable':
      return new ServiceUnavailableException(body(503))
    case 'admin_required':
    case 'self_review_refused':
      return new ForbiddenException(body(403))
    case 'member_not_found':
    case 'case_not_found':
      return new NotFoundException(body(404))
    case 'invalid_request':
    case 'invalid_range':
      return new BadRequestException(body(400))
    case 'export_too_large':
      return new HttpException(body(413), HttpStatus.PAYLOAD_TOO_LARGE)
  }
}

/** A failed audit write is the one closed refusal here. Anything else stays a real error. */
async function auditedOrRefused<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ModerationRecordWriteError)
      throw moderationHistoryError('audit_unavailable')
    throw error
  }
}

@Injectable()
export class ModerationHistoryService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(CommunityService) private readonly community: CommunityService,
    @Inject(ModerationHistoryRepository)
    private readonly repository: ModerationHistoryRepository,
    @Inject(ModerationDecisionsRepository)
    private readonly decisions: ModerationDecisionsRepository,
    @Inject(MODERATION_QUEUE_CLOCK) private readonly clock: ModerationQueueClock
  ) {}

  async requestErasure(
    auth: RequestAuthContext,
    memberId: string
  ): Promise<ModerationErasureResult> {
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true },
    })
    if (!member) throw moderationHistoryError('member_not_found')
    const erasure = await auditedOrRefused(() =>
      this.community.requestAccountContentErasure(memberId, {
        id: auth.userId,
        assertMayAct: async (tx) => {
          // Self-erasure is the member's own request, and a repeat of it is already answered by the guard.
          if (auth.userId !== memberId)
            await this.decisions.assertOperatorNotErased(tx, auth.userId)
        },
        auditData: (requestId) =>
          buildModerationHistoryAuditData({
            eventType: 'moderation_erasure_requested',
            requestId,
            role: auth.role,
          }),
      })
    )
    return {
      requestId: erasure.requestId,
      requestedAt: erasure.requestedAt.toISOString(),
      deadlineAt: new Date(
        erasure.requestedAt.getTime() + MODERATION_ERASURE_DEADLINE_MS
      ).toISOString(),
      replayed: erasure.replayed,
    }
  }

  /** Reads, digests and audits in one transaction, so a failed audit row returns no bytes. */
  async exportEvidence(
    auth: RequestAuthContext,
    request: ModerationEvidenceExportRequest
  ): Promise<ModerationEvidenceBundle> {
    if (request.scope === 'range') {
      if (auth.role !== 'admin') throw moderationHistoryError('admin_required')
      if (!isModerationEvidenceRangeValid(request))
        throw moderationHistoryError('invalid_range')
    }
    return auditedOrRefused(() =>
      interactiveTransaction(
        this.prisma,
        async (tx) =>
          request.scope === 'case'
            ? this.exportCase(tx, auth, request.caseId)
            : this.exportRange(tx, auth, new Date(request.from), new Date(request.to)),
        EXPORT_TRANSACTION
      )
    )
  }

  private async exportCase(
    tx: Tx,
    auth: RequestAuthContext,
    caseId: string
  ): Promise<ModerationEvidenceBundle> {
    const id = parseModerationCaseId(caseId)
    const loaded = id ? await this.decisions.loadCase(tx, id) : null
    if (!loaded) throw moderationHistoryError('case_not_found')
    if (
      computeViewerConflict({
        viewerId: auth.userId,
        authorId: decisionCaseSubject(loaded),
        reporterIds: loaded.reports.map((report) => report.reporterId),
      })
    )
      throw moderationHistoryError('self_review_refused')

    const caseReportIds = loaded.reports.map((report) => report.id)
    const decisions = await this.repository.decisionsOfCase(tx, caseId, caseReportIds)
    // Judged on everything the bundle will hold. One orphan case reads one report, and its decisions then
    // bring in the sibling reports of the deleted target, so the case's own reports are not enough.
    const conflicting = await this.repository.conflictingDecisionIds(
      tx,
      auth.userId,
      decisions
    )
    if (
      conflicting.size > 0 ||
      (await viewerConflictsWithEvidence(tx, auth.userId, caseId, caseReportIds))
    )
      throw moderationHistoryError('self_review_refused')
    return this.assemble(tx, auth, {
      scope: { scope: 'case', caseId },
      decisions,
      reportIds: caseReportIds,
      caseIds: [caseId],
      withheldForConflict: 0,
    })
  }

  private async exportRange(
    tx: Tx,
    auth: RequestAuthContext,
    from: Date,
    to: Date
  ): Promise<ModerationEvidenceBundle> {
    const total = await this.repository.countDecisionsInRange(tx, from, to)
    if (total > MODERATION_EVIDENCE_DECISIONS_MAX)
      throw moderationHistoryError('export_too_large')
    const inRange = await this.repository.decisionsInRange(tx, from, to)
    const conflicting = await this.repository.conflictingDecisionIds(
      tx,
      auth.userId,
      inRange
    )
    return this.assemble(tx, auth, {
      scope: {
        scope: 'range',
        from: from.toISOString(),
        to: to.toISOString(),
      },
      decisions: inRange.filter((row) => !conflicting.has(row.id)),
      reportIds: [],
      caseIds: [],
      withheldForConflict: conflicting.size,
    })
  }

  private async assemble(
    tx: Tx,
    auth: RequestAuthContext,
    input: {
      scope: ModerationEvidenceBundle['scope']
      decisions: readonly ModerationDecision[]
      reportIds: readonly string[]
      caseIds: readonly string[]
      withheldForConflict: number
    }
  ): Promise<ModerationEvidenceBundle> {
    const decisionIds = input.decisions.map((row) => row.id)
    const reportIds = [
      ...new Set([
        ...input.reportIds,
        ...input.decisions.flatMap((row) => row.report_ids),
      ]),
    ]
    const caseIds = [
      ...new Set([...input.caseIds, ...input.decisions.map((row) => row.case_key)]),
    ]
    const content = {
      decisions: input.decisions.map(mapEvidenceDecision),
      reports: await this.repository.reports(tx, reportIds),
      auditEvents: await this.repository.auditEvents(tx, decisionIds, caseIds),
      alerts: await this.repository.alerts(tx, decisionIds, reportIds),
    }
    const counts = {
      decisions: content.decisions.length,
      reports: content.reports.length,
      auditEvents: content.auditEvents.length,
      alerts: content.alerts.length,
      withheldForConflict: input.withheldForConflict,
    }
    const exportId = randomUUID()
    const sha256 = moderationEvidenceDigest(content)
    const bundle = moderationEvidenceBundleSchema.parse({
      schemaVersion: MODERATION_EVIDENCE_SCHEMA_VERSION,
      exportId,
      generatedAt: this.clock().toISOString(),
      scope: input.scope,
      sha256,
      counts,
      ...content,
    } satisfies ModerationEvidenceBundle)
    if (Buffer.byteLength(JSON.stringify(bundle)) > MODERATION_EVIDENCE_BYTES_MAX)
      throw moderationHistoryError('export_too_large')

    const common = { exportId, counts, sha256, role: auth.role }
    await writeModerationRecord(() =>
      tx.auditLog.create({
        data: {
          user_id: auth.userId,
          event_type: 'moderation_evidence_exported',
          event_data: buildModerationHistoryAuditData(
            input.scope.scope === 'case'
              ? {
                  eventType: 'moderation_evidence_exported',
                  scope: 'case',
                  caseId: input.scope.caseId,
                  ...common,
                }
              : {
                  eventType: 'moderation_evidence_exported',
                  scope: 'range',
                  from: input.scope.from,
                  to: input.scope.to,
                  ...common,
                }
          ),
        },
      })
    )
    return bundle
  }
}
