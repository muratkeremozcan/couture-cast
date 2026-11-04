// Story 6.10 owner: risk, SLA, privacy and media mapping of the moderator queue in `apps/api/src/modules/moderation/moderation-queue.service.ts`.
// Read-only. The only write is the D10 audit row, and it lands before any signed URL exists.
import { createHash } from 'node:crypto'
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  communityModerationReasonCategories,
  deriveCaseRisk,
  deriveSlaState,
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  MODERATION_RISK_BY_RANK,
  type CommunityReportReason,
  type ModerationCaseDetail,
  type ModerationCaseSource,
  type ModerationCaseStatus,
  type ModerationCasesQuery,
  type ModerationMedia,
} from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../auth/security.types.js'
import { SupabaseCommunityStorageAdapter } from '../community/community-storage.adapter.js'
import {
  decodeModerationQueueCursor,
  encodeModerationQueueCursor,
} from './moderation-queue-cursor.js'
import {
  ModerationQueueRepository,
  parseModerationCaseId,
  type LoadedCase,
  type ReportRecord,
} from './moderation-queue.repository.js'

/** The one clock of a request. Tests inject a fixed instant. */
export const MODERATION_QUEUE_CLOCK = Symbol('MODERATION_QUEUE_CLOCK')
export type ModerationQueueClock = () => Date
export const systemModerationQueueClock: ModerationQueueClock = () => new Date()

/** A moderator opens one case, so the signed image outlives the page by two minutes. */
export const MODERATION_MEDIA_TTL_SECONDS = 120
const OPERATOR_NOTE_MAX = 2000

const caseNotFound = () =>
  new NotFoundException({
    statusCode: 404,
    code: 'case_not_found',
    message: 'Moderation case not found.',
  })

const auditUnavailable = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    code: 'audit_unavailable',
    message: 'The case view could not be recorded.',
  })

type Snapshot = ModerationCaseDetail['snapshot']

/** Allowlist projection: unknown stored keys never leave the API, malformed JSON reads as unavailable. */
export function projectSnapshot(raw: unknown): Snapshot {
  const empty: Snapshot = {
    available: false,
    caption: null,
    altText: null,
    body: null,
    climateBand: null,
    capturedAt: null,
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return empty
  const value = raw as Record<string, unknown>
  if (value.unavailable === true) return empty
  const text = (key: string): string | null =>
    typeof value[key] === 'string' ? value[key] : null
  const capturedAt = text('capturedAt')
  const captured =
    capturedAt !== null && !Number.isNaN(Date.parse(capturedAt))
      ? new Date(capturedAt).toISOString()
      : null
  const projected = {
    caption: text('caption'),
    altText: text('altText'),
    body: text('body'),
    climateBand: text('climateBand'),
    capturedAt: captured,
  }
  // An object with no known key says nothing about what was reported.
  const known = Object.values(projected).some((entry) => entry !== null)
  return known ? { available: true, ...projected } : empty
}

/** Stored data never causes a 500: every value is clamped to its contract bound before the output parse. */
const clamp = (value: string | null | undefined, max: number): string | null => {
  if (value === null || value === undefined || value.length === 0) return null
  if (value.length <= max) return value
  let out = value.slice(0, max)
  // The contract counts UTF-16 units, so a cut must not leave half of a surrogate pair.
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}
/** The same rule the queue SQL applies: ASCII letters, digits and hyphens, 1 to 35 characters. */
const clampLocale = (value: string | null | undefined): string | null =>
  value && /^[A-Za-z0-9-]{1,35}$/.test(value) ? value : null

function snapshotLocale(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const locale = (raw as Record<string, unknown>).locale
  return typeof locale === 'string' ? clampLocale(locale) : null
}

function splitCodes(reason: string | null): string[] {
  return (reason ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
}

@Injectable()
export class ModerationQueueService {
  private readonly logger = new Logger(ModerationQueueService.name)

  constructor(
    @Inject(ModerationQueueRepository)
    private readonly repository: ModerationQueueRepository,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: Pick<SupabaseCommunityStorageAdapter, 'signReadUrl'>,
    @Inject(MODERATION_QUEUE_CLOCK) private readonly clock: ModerationQueueClock
  ) {}

  async listCases(auth: RequestAuthContext, query: ModerationCasesQuery) {
    const now = this.clock()
    const after = query.cursor ? decodeModerationQueueCursor(query.cursor, query) : null
    const rows = await this.repository.listCases(query, now, after)
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    const nextCursor =
      rows.length > query.limit && last
        ? encodeModerationQueueCursor(
            { rank: last.riskRank, dueKey: last.dueKey, caseKey: last.caseKey },
            query
          )
        : null

    const items = page.map((row) => {
      const status: ModerationCaseStatus = row.openCount > 0 ? 'open' : 'resolved'
      return {
        caseId: row.caseKey,
        source: row.source,
        status,
        risk: MODERATION_RISK_BY_RANK[row.riskRank] ?? 'low',
        slaState: deriveSlaState({ status, dueAt: row.dueAt, now }),
        slaDueAt: row.dueAt.toISOString(),
        acceptedAt: row.acceptedAt.toISOString(),
        reportCount: row.reportCount,
        reasons: row.reasons as CommunityReportReason[],
        locale: clampLocale(row.locale),
        hasFinding: row.hasFinding,
        excerpt: clamp(row.excerpt, 280),
      }
    })

    this.logger.log({
      event: 'moderation_queue_page',
      moderator: createHash('sha256').update(auth.userId).digest('hex').slice(0, 12),
      filters: (['source', 'locale', 'risk', 'sla'] as const).filter(
        (name) => query[name] !== undefined
      ),
      status: query.status,
      count: items.length,
    })

    return moderationCasesResponseSchema.parse({
      data: { items, nextCursor, serverNow: now.toISOString() },
    })
  }

  async getCase(auth: RequestAuthContext, caseId: string) {
    const id = parseModerationCaseId(caseId)
    if (!id) throw caseNotFound()
    const now = this.clock()
    const loaded = await this.repository.loadCase(id)
    if (!loaded) throw caseNotFound()

    const detail = this.buildDetail(auth, caseId, loaded, now)

    // The audit row comes before any signed URL: a failed audit returns no case data and no media.
    try {
      await this.repository.recordCaseView({
        userId: auth.userId,
        caseId,
        source: loaded.source,
        role: auth.role,
      })
    } catch (error) {
      this.logger.error(
        { event: 'moderation_case_audit_failed', code: 'audit_unavailable' },
        error instanceof Error ? error.name : 'unknown'
      )
      throw auditUnavailable()
    }

    const media = await this.resolveMedia(loaded, detail.snapshot.altText, now)
    return moderationCaseDetailResponseSchema.parse({ data: { ...detail, media } })
  }

  private buildDetail(
    auth: RequestAuthContext,
    caseId: string,
    loaded: LoadedCase,
    now: Date
  ): Omit<ModerationCaseDetail, 'media'> {
    const open = loaded.reports.filter((report) => report.resolvedAt === null)
    const status: ModerationCaseStatus = open.length > 0 ? 'open' : 'resolved'
    const relevant = open.length > 0 ? open : loaded.reports
    const reasons = [...new Set(relevant.map((report) => report.reason))]
    const distinctReporters =
      new Set(
        relevant.flatMap((report) => (report.reporterId ? [report.reporterId] : []))
      ).size + relevant.filter((report) => report.reporterId === null).length

    const findings = this.findings(loaded)
    const hasFinding = this.hasFinding(loaded)
    // A reduce takes any number of reports; spreading them into Math.min would hit the argument limit.
    const dueAt = new Date(
      relevant.reduce((min, report) => Math.min(min, report.dueAt.getTime()), Infinity)
    )
    const acceptedAt = new Date(
      relevant.reduce(
        (min, report) => Math.min(min, report.acceptedAt.getTime()),
        Infinity
      )
    )
    const first = relevant[0] as ReportRecord
    const live = loaded.post ?? loaded.comment

    return {
      caseId: caseId,
      source: loaded.source,
      status,
      risk: deriveCaseRisk({
        reasons: reasons as CommunityReportReason[],
        hasFinding,
        distinctOpenReporters: distinctReporters,
      }),
      slaState: deriveSlaState({ status, dueAt, now }),
      slaDueAt: dueAt.toISOString(),
      acceptedAt: acceptedAt.toISOString(),
      serverNow: now.toISOString(),
      reportCount: relevant.length,
      locale: this.locale(loaded, relevant),
      subject: this.subject(loaded, first),
      snapshot: projectSnapshot(first.snapshot),
      target: this.target(loaded),
      findings,
      reporters: relevant.map((report) => ({
        identity: this.identity(report.reporterId, loaded),
        reason: report.reason as CommunityReportReason,
        details: clamp(report.details, 500),
        reportedAt: report.acceptedAt.toISOString(),
        resolved: report.resolvedAt !== null,
      })),
      priorActions: loaded.priorActions.map((action) => ({
        actorKind: action.actorKind,
        action: clamp(action.action, 64) ?? 'unknown',
        reason: clamp(action.reason, OPERATOR_NOTE_MAX),
        occurredAt: action.occurredAt.toISOString(),
      })),
      viewerConflict:
        (live !== null && live.userId === auth.userId) ||
        loaded.reports.some((report) => report.reporterId === auth.userId),
    }
  }

  private identity(userId: string | null, loaded: LoadedCase) {
    if (userId === null) return { state: 'erased' as const, alias: null }
    const alias = clamp(loaded.aliases.get(userId), 64)
    return alias
      ? { state: 'alias' as const, alias }
      : { state: 'unknown' as const, alias: null }
  }

  private subject(loaded: LoadedCase, first: ReportRecord) {
    if (loaded.source === 'post') {
      const subjectAlias = clamp(first.subjectAlias, 64)
      if (subjectAlias) return { state: 'alias' as const, alias: subjectAlias }
      if (!loaded.post) return { state: 'erased' as const, alias: null }
      return this.identity(loaded.post.userId, loaded)
    }
    // Comment reports carry no subject alias, so the live author's alias row answers.
    if (!loaded.comment) return { state: 'erased' as const, alias: null }
    return this.identity(loaded.comment.userId, loaded)
  }

  private target(loaded: LoadedCase): ModerationCaseDetail['target'] {
    if (loaded.post) {
      return {
        state: 'live',
        status: clamp(loaded.post.status, 64),
        publishedAt: loaded.post.publishedAt?.toISOString() ?? null,
        parentBody: null,
      }
    }
    if (loaded.comment) {
      return {
        state: 'live',
        status: clamp(loaded.comment.status, 64),
        publishedAt: loaded.comment.publishedAt?.toISOString() ?? null,
        parentBody: loaded.comment.parentBody,
      }
    }
    return { state: 'erased', status: null, publishedAt: null, parentBody: null }
  }

  /**
   * The case locale is the locale of its earliest relevant report: that report's snapshot locale,
   * else the live target's. The queue SQL applies the same rule, so a filter and the detail agree.
   */
  private locale(loaded: LoadedCase, relevant: ReportRecord[]): string | null {
    const first = relevant[0]
    return (
      (first ? snapshotLocale(first.snapshot) : null) ??
      clampLocale(loaded.post?.locale ?? loaded.comment?.locale)
    )
  }

  private hasFinding(loaded: LoadedCase): boolean {
    if (loaded.post) {
      return communityModerationReasonCategories(loaded.post.moderationReason) !== null
    }
    if (loaded.comment) {
      return ['held_for_review', 'blocked'].includes(loaded.comment.status)
    }
    return false
  }

  private findings(loaded: LoadedCase): ModerationCaseDetail['findings'] {
    const reason =
      loaded.post?.moderationReason ?? loaded.comment?.screeningReason ?? null
    const engineVersion = clamp(
      loaded.post?.engineVersion ?? loaded.comment?.screeningVersion ?? null,
      64
    )
    const categories = communityModerationReasonCategories(reason)
    if (categories !== null) {
      return {
        codes: splitCodes(reason).flatMap((code) => clamp(code, 64) ?? []),
        categories,
        engineVersion,
        operatorNote: null,
      }
    }
    if (
      loaded.comment &&
      ['held_for_review', 'blocked'].includes(loaded.comment.status)
    ) {
      return { codes: [], categories: [], engineVersion, operatorNote: null }
    }
    // A reason that is not a screening code is an operator's own words.
    if (loaded.post && reason !== null && reason.trim().length > 0) {
      return {
        codes: [],
        categories: [],
        engineVersion,
        operatorNote: clamp(reason.trim(), OPERATOR_NOTE_MAX),
      }
    }
    return null
  }

  private async resolveMedia(
    loaded: LoadedCase,
    altText: string | null,
    now: Date
  ): Promise<ModerationMedia> {
    if (loaded.source === 'comment') return { state: 'unavailable', reason: 'no_image' }
    const post = loaded.post
    if (!post) return { state: 'unavailable', reason: 'target_erased' }
    if (post.anonymizedAt) return { state: 'unavailable', reason: 'anonymized' }
    if (post.objectsPurgedAt) return { state: 'unavailable', reason: 'purged' }
    if (!post.imagePath) return { state: 'unavailable', reason: 'no_image' }
    try {
      const url = await this.storage.signReadUrl(
        post.imagePath,
        MODERATION_MEDIA_TTL_SECONDS
      )
      return {
        state: 'available',
        url,
        expiresAt: new Date(
          now.getTime() + MODERATION_MEDIA_TTL_SECONDS * 1000
        ).toISOString(),
        altText,
      }
    } catch {
      // Closed code only. The error can carry the object path, and the URL never reaches a log.
      this.logger.warn({ event: 'moderation_media_unavailable', code: 'signing_failed' })
      return { state: 'unavailable', reason: 'signing_failed' }
    }
  }
}

export type { ModerationCaseSource }
