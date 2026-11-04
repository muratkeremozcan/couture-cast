// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderation queue provider double. The real controller, guards and
// cache-header middleware run; only the service behind them and the flag answer are doubled, so
// the 403, 400 and 503 shapes come from the shipped code and the 200 bodies are parsed by the
// shipped contract before they are served.
// Story 6.11 test owner: C-D-PACT. The answers to a decision come from the shipped availability rule
// over the world a scenario names, the same rule the real service runs, and the refusal bodies come
// from the shipped error builder and the shipped ban refusal.
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  deriveAllowedActions,
  deriveAllowedAppealSteps,
  moderationActionAvailability,
  moderationAppealResponseSchema,
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
  moderationDecisionResponseSchema,
  type ModerationAppealInput,
  type ModerationAvailabilityInput,
  type ModerationDecisionInput,
} from '@couture/api-client/contracts/http'
import { assertCommunityMemberNotSanctioned } from '../../../../apps/api/src/modules/community/community-access.service'
import { moderationDecisionError } from '../../../../apps/api/src/modules/moderation/moderation-decision-rules'

export type ModerationScenario =
  | 'queue'
  | 'empty'
  | 'orphan_queue'
  | 'stale_cursor'
  | 'detail_with_image'
  | 'detail_without_image'
  | 'detail_comment_resolved'
  | 'detail_signing_failed'
  | 'unknown_case'
  | 'audit_unavailable'
  | 'decision_applied'
  | 'decision_replayed'
  | 'case_conflict'
  | 'action_not_applicable'
  | 'self_review_refused'
  | 'admin_required'
  | 'appeal_applied'
  | 'banned_feed'

let scenario: ModerationScenario = 'queue'
let consoleEnabled = true
let decisionsEnabled = true

export function configureModerationScenario(next: ModerationScenario) {
  scenario = next
}
export function configureModerationConsole(enabled: boolean) {
  consoleEnabled = enabled
}
export function configureModerationDecisions(enabled: boolean) {
  decisionsEnabled = enabled
}
export function resetModerationState() {
  scenario = 'queue'
  consoleEnabled = true
  decisionsEnabled = true
}

/** Fixed instants keep the recorded pact byte-stable across the three determinism runs. */
export const PACT_SERVER_NOW = '2026-11-03T12:00:00.000Z'
const iso = (hours: number) =>
  new Date(Date.parse(PACT_SERVER_NOW) + hours * 3_600_000).toISOString()

export const PACT_QUEUE_CURSOR = 'eyJ2IjoxfQ.c2lnbmF0dXJl'
export const PACT_SIGNED_URL =
  'https://storage.example.test/object/sign/community/p1/a.jpg?token=pact-signature'

export const PACT_CASE_REVISION = '0123456789abcdef'
const PACT_NEXT_REVISION = 'aaaabbbbccccdddd'
const PACT_SANCTION_ID = 'pact-sanction-1'
const BAN_EXPIRES_AT = iso(7 * 24)

/** An open reported post with a published target, read by a moderator with no conflict. */
const openCase: ModerationAvailabilityInput = {
  role: 'moderator',
  viewerConflict: false,
  operatorSanctioned: false,
  escalated: false,
  openReportCount: 1,
  target: { state: 'live', kind: 'post', status: 'published', erasureRequested: false },
  subjectBan: null,
  authorEligible: true,
  writesOpen: true,
}
const standingClean = {
  active: false,
  sanction: null,
  priorBanCount: 0,
  allowedAppealSteps: [],
}
const decisionState = (world: ModerationAvailabilityInput) => ({
  revision: PACT_CASE_REVISION,
  ...deriveAllowedActions(world),
  escalated: world.escalated,
  firstDecisionAt: null,
  subjectStanding: standingClean,
})

const fullItem = {
  caseId: 'post.pactpost1',
  source: 'post',
  status: 'open',
  risk: 'high',
  slaState: 'at_risk',
  slaDueAt: iso(3),
  acceptedAt: iso(-2),
  reportCount: 3,
  reasons: ['harassment', 'spam'],
  locale: 'en-US',
  hasFinding: true,
  excerpt: 'A reported caption',
  escalated: false,
}
const queueItems = [
  fullItem,
  {
    ...fullItem,
    caseId: 'comment.pactcomment2',
    source: 'comment',
    risk: 'low',
    slaState: 'on_track',
  },
  { ...fullItem, caseId: 'post.pactpost2' },
]
/** An erased comment: no locale and no excerpt survive, and both fields are null on the wire. */
const orphanItem = {
  caseId: 'orphan-comment.pactreport2',
  source: 'comment',
  status: 'open',
  risk: 'low',
  slaState: 'on_track',
  slaDueAt: iso(20),
  acceptedAt: iso(-1),
  reportCount: 1,
  reasons: ['other'],
  locale: null,
  hasFinding: false,
  excerpt: null,
  escalated: false,
}

const baseDetail = {
  caseId: 'post.pactpost1',
  source: 'post',
  status: 'open',
  risk: 'high',
  slaState: 'at_risk',
  slaDueAt: iso(3),
  acceptedAt: iso(-2),
  serverNow: PACT_SERVER_NOW,
  reportCount: 1,
  locale: 'en-US',
  subject: { state: 'alias', alias: 'quiet-fox-1234' },
  snapshot: {
    available: true,
    caption: 'What the reporter saw',
    altText: 'Alt text',
    body: null,
    climateBand: 'temperate_dry',
    capturedAt: iso(-2),
  },
  target: { state: 'live', status: 'published', publishedAt: iso(-5), parentBody: null },
  findings: {
    codes: ['text_policy_match'],
    categories: ['language'],
    engineVersion: '1.2.0',
    operatorNote: null,
  },
  reporters: [
    {
      identity: { state: 'alias', alias: 'brave-owl-9876' },
      origin: 'member',
      reason: 'harassment',
      details: 'Reporter note',
      reportedAt: iso(-2),
      resolved: false,
    },
  ],
  priorActions: [
    {
      actorKind: 'screening',
      action: 'flagged',
      reason: 'text_policy_match',
      occurredAt: iso(-6),
    },
  ],
  media: {
    state: 'available',
    url: PACT_SIGNED_URL,
    expiresAt: iso(0.03),
    altText: 'Alt text',
  },
  viewerConflict: false,
  ...decisionState(openCase),
}

export const moderationQueueServiceDouble = {
  listCases: (
    _auth: unknown,
    query: { cursor?: string; source?: string; risk?: string }
  ) => {
    if (scenario === 'stale_cursor' && query.cursor)
      throw new BadRequestException({
        statusCode: 400,
        code: 'invalid_cursor',
        message: 'Invalid moderation cursor.',
      })
    return Promise.resolve(
      moderationCasesResponseSchema.parse({
        data: {
          items:
            scenario === 'empty'
              ? []
              : scenario === 'orphan_queue'
                ? [orphanItem]
                : queueItems.filter(
                    (item) =>
                      (!query.source || item.source === query.source) &&
                      (!query.risk || item.risk === query.risk)
                  ),
          nextCursor: scenario === 'queue' ? PACT_QUEUE_CURSOR : null,
          serverNow: PACT_SERVER_NOW,
        },
      })
    )
  },
  getCase: (_auth: unknown, caseId: string) => {
    if (scenario === 'unknown_case')
      throw new NotFoundException({
        statusCode: 404,
        code: 'case_not_found',
        message: 'Moderation case not found.',
      })
    if (scenario === 'audit_unavailable')
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'audit_unavailable',
        message: 'The case view could not be recorded.',
      })
    if (scenario === 'detail_comment_resolved')
      return Promise.resolve(
        moderationCaseDetailResponseSchema.parse({
          data: {
            ...baseDetail,
            caseId,
            source: 'comment',
            status: 'resolved',
            slaState: 'resolved',
            locale: null,
            subject: { state: 'unknown', alias: null },
            snapshot: {
              available: true,
              caption: null,
              altText: null,
              body: 'A reported comment',
              climateBand: null,
              capturedAt: iso(-2),
            },
            target: {
              state: 'live',
              status: 'published',
              publishedAt: iso(-5),
              parentBody: 'The parent comment',
            },
            findings: null,
            reporters: [
              {
                identity: { state: 'unknown', alias: null },
                origin: 'member',
                reason: 'other',
                details: null,
                reportedAt: iso(-2),
                resolved: true,
              },
            ],
            priorActions: [],
            media: { state: 'unavailable', reason: 'no_image' },
            viewerConflict: true,
            ...decisionState({ ...openCase, viewerConflict: true }),
            firstDecisionAt: iso(-1),
          },
        })
      )
    if (scenario === 'detail_signing_failed')
      return Promise.resolve(
        moderationCaseDetailResponseSchema.parse({
          data: {
            ...baseDetail,
            caseId,
            snapshot: {
              available: false,
              caption: null,
              altText: null,
              body: null,
              climateBand: null,
              capturedAt: null,
            },
            findings: {
              codes: [],
              categories: [],
              engineVersion: null,
              operatorNote: 'Taken down by an operator',
            },
            media: { state: 'unavailable', reason: 'signing_failed' },
          },
        })
      )
    const withoutImage = scenario === 'detail_without_image'
    return Promise.resolve(
      moderationCaseDetailResponseSchema.parse({
        data: withoutImage
          ? {
              ...baseDetail,
              caseId,
              target: {
                state: 'erased',
                status: null,
                publishedAt: null,
                parentBody: null,
              },
              media: { state: 'unavailable', reason: 'target_erased' },
              reporters: [
                {
                  ...baseDetail.reporters[0],
                  identity: { state: 'erased', alias: null },
                  origin: 'member',
                },
              ],
              ...decisionState({ ...openCase, target: { state: 'erased' } }),
              subjectStanding: null,
            }
          : {
              ...baseDetail,
              caseId,
              // The author holds a temporary ban whose appeal this moderator may record.
              ...deriveAllowedActions({ ...openCase, subjectBan: 'temporary' }),
              subjectStanding: {
                active: true,
                sanction: {
                  sanctionId: PACT_SANCTION_ID,
                  kind: 'temporary',
                  expiresAt: BAN_EXPIRES_AT,
                  appealStatus: 'not_requested',
                },
                priorBanCount: 1,
                allowedAppealSteps: deriveAllowedAppealSteps({
                  role: 'moderator',
                  viewerConflict: false,
                  operatorSanctioned: false,
                  sanctionActive: true,
                  appealStatus: 'not_requested',
                }),
              },
            },
      })
    )
  },
}

const DECISION_WORLDS: Partial<Record<ModerationScenario, ModerationAvailabilityInput>> =
  {
    self_review_refused: { ...openCase, viewerConflict: true },
  }

const decisionResult = (
  caseId: string,
  input: ModerationDecisionInput,
  replayed: boolean
) =>
  moderationDecisionResponseSchema.parse({
    data: {
      decisionId: 'pact-decision-1',
      caseId,
      action: input.action,
      decidedAt: PACT_SERVER_NOW,
      firstDecisionAt: PACT_SERVER_NOW,
      revision: PACT_NEXT_REVISION,
      caseStatus: 'resolved',
      escalated: false,
      // A post takedown or a ban on a published post leaves the post flagged.
      targetStatus: 'flagged',
      sanction:
        input.action === 'ban'
          ? {
              sanctionId: PACT_SANCTION_ID,
              kind: 'temporary',
              expiresAt: BAN_EXPIRES_AT,
              appealStatus: 'not_requested',
            }
          : null,
      replayed,
      cacheInvalidation: 'completed',
    },
  })

export const moderationDecisionsServiceDouble = {
  decide: (_auth: unknown, caseId: string, input: ModerationDecisionInput) => {
    if (scenario === 'decision_replayed')
      return Promise.resolve(decisionResult(caseId, input, true))
    // The real service checks the revision between the viewer half and the state half of the rule.
    if (scenario === 'case_conflict' && input.expectedRevision !== PACT_CASE_REVISION)
      throw moderationDecisionError('case_conflict', {
        currentRevision: PACT_CASE_REVISION,
      })
    const verdict = moderationActionAvailability(
      DECISION_WORLDS[scenario] ?? openCase,
      input.action,
      input.action === 'ban' ? input.ban.kind : undefined
    )
    if (!verdict.available)
      throw moderationDecisionError(
        verdict.code,
        verdict.code === 'action_not_applicable' ? { detail: verdict.detail } : {}
      )
    return Promise.resolve(decisionResult(caseId, input, false))
  },
}

export const moderationSanctionsServiceDouble = {
  recordAppeal: (_auth: unknown, sanctionId: string, input: ModerationAppealInput) => {
    const allowed = deriveAllowedAppealSteps({
      role: 'moderator',
      viewerConflict: false,
      operatorSanctioned: false,
      sanctionActive: true,
      appealStatus: 'not_requested',
    })
    if (!allowed.includes(input.status))
      throw moderationDecisionError('appeal_transition_invalid')
    return Promise.resolve(
      moderationAppealResponseSchema.parse({
        data: {
          decisionId: 'pact-decision-2',
          decidedAt: PACT_SERVER_NOW,
          sanction: {
            sanctionId,
            kind: 'temporary',
            expiresAt: BAN_EXPIRES_AT,
            appealStatus: input.status,
          },
          active: true,
          restoredCount: 0,
          replayed: false,
          cacheInvalidation: 'completed',
        },
      })
    )
  },
}

/** The member the provider's auth double signs in. */
const BANNED_MEMBER = 'guardian-1'

/** One active ban on that member alone, so the refusal below is the one the shipped read gate builds. */
const bannedMemberTx = {
  communitySanction: {
    findFirst: ({ where }: { where: { user_id: string } }) =>
      Promise.resolve(
        where.user_id === BANNED_MEMBER
          ? {
              kind: 'temporary',
              expires_at: new Date(BAN_EXPIRES_AT),
              appeal_status: 'not_requested',
            }
          : null
      ),
  },
} as unknown as Pick<Prisma.TransactionClient, 'communitySanction'>

/**
 * The feed of a banned member. `CommunityService.getFeed` runs the read gate first, so the double
 * answers with the gate's own refusal and every other scenario reads the wrapped service.
 * The gate reads the id the controller forwards, so a controller that drops it gets no refusal.
 */
export function withCommunityBan<S extends { getFeed: (params: never) => unknown }>(
  service: S
): S {
  return {
    ...service,
    getFeed: async (params: never) => {
      if (scenario === 'banned_feed') {
        const { userId } = params as { userId: string }
        await assertCommunityMemberNotSanctioned(bannedMemberTx, userId)
      }
      return service.getFeed(params)
    },
  }
}

/** The only flags the moderation controllers read. Every other flag answers on. */
export const moderationFlagsDouble = {
  getFeatureFlag: (key: string) => {
    if (key === 'moderation_console_enabled') return Promise.resolve(consoleEnabled)
    if (key === 'moderation_decisions_enabled') return Promise.resolve(decisionsEnabled)
    return Promise.resolve(true)
  },
}
