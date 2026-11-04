// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the moderation queue provider double. The real controller, guards and
// cache-header middleware run; only the service behind them and the flag answer are doubled, so
// the 403, 400 and 503 shapes come from the shipped code and the 200 bodies are parsed by the
// shipped contract before they are served.
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  moderationCaseDetailResponseSchema,
  moderationCasesResponseSchema,
} from '@couture/api-client/contracts/http'

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

let scenario: ModerationScenario = 'queue'
let consoleEnabled = true

export function configureModerationScenario(next: ModerationScenario) {
  scenario = next
}
export function configureModerationConsole(enabled: boolean) {
  consoleEnabled = enabled
}
export function resetModerationState() {
  scenario = 'queue'
  consoleEnabled = true
}

/** Fixed instants keep the recorded pact byte-stable across the three determinism runs. */
export const PACT_SERVER_NOW = '2026-11-03T12:00:00.000Z'
const iso = (hours: number) =>
  new Date(Date.parse(PACT_SERVER_NOW) + hours * 3_600_000).toISOString()

export const PACT_QUEUE_CURSOR = 'eyJ2IjoxfQ.c2lnbmF0dXJl'
export const PACT_SIGNED_URL =
  'https://storage.example.test/object/sign/community/p1/a.jpg?token=pact-signature'

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
}

export const moderationQueueServiceDouble = {
  listCases: (_auth: unknown, query: { cursor?: string }) => {
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
                : queueItems,
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
                reason: 'other',
                details: null,
                reportedAt: iso(-2),
                resolved: true,
              },
            ],
            priorActions: [],
            media: { state: 'unavailable', reason: 'no_image' },
            viewerConflict: true,
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
                },
              ],
            }
          : { ...baseDetail, caseId },
      })
    )
  },
}

/** The only flag the moderation controller reads. Every other flag answers on. */
export const moderationFlagsDouble = {
  getFeatureFlag: (key: string) =>
    Promise.resolve(key === 'moderation_console_enabled' ? consoleEnabled : true),
}
