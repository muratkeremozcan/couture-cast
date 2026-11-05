// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: the strict contracts of the erasure route and the evidence bundle.
// U-C-EXPORT-EXCLUDED, U-C-ERASURE-STRICT, U-C-RESERVED-REASON, U-C-RANGE, U-C-OPENAPI
import { describe, expect, it } from 'vitest'
import {
  MODERATION_ERASED_REASON,
  moderationDecisionReasonSchema,
  moderationDecisionInputSchema,
} from '../src/contracts/http/moderation-decisions'
import {
  isModerationEvidenceRangeValid,
  MODERATION_ERASURE_DEADLINE_MS,
  MODERATION_EVIDENCE_BYTES_MAX,
  MODERATION_EVIDENCE_DECISIONS_MAX,
  MODERATION_EVIDENCE_RANGE_MAX_MS,
  moderationErasureRequestSchema,
  moderationErasureResponseSchema,
  moderationEvidenceAlertSchema,
  moderationEvidenceAuditEventSchema,
  moderationEvidenceBundleSchema,
  moderationEvidenceDecisionSchema,
  moderationEvidenceExportRequestSchema,
  moderationEvidenceReportSchema,
} from '../src/contracts/http/moderation-history'

const AT = '2026-11-05T12:00:00.000Z'

const decision = {
  decisionId: 'decision-1',
  caseId: 'post.post-1',
  sequence: 1,
  source: 'post',
  action: 'resolve',
  reason: 'A rationale.',
  reasonRemoved: false,
  moderatorId: 'moderator-1',
  moderatorRole: 'moderator',
  subjectAlias: 'Style Explorer',
  isTerminal: true,
  decidedAt: AT,
  anonymizedAt: null,
}
const report = {
  reportId: 'report-1',
  source: 'post',
  reason: 'harassment',
  origin: 'member',
  reporterState: 'member',
  acceptedAt: AT,
  dueAt: AT,
  resolvedAt: null,
}
const auditEvent = {
  eventType: 'moderation_decision_applied',
  occurredAt: AT,
  actorId: 'moderator-1',
  role: 'moderator',
  action: 'resolve',
}
const alert = {
  kind: 'breached',
  delivery: 'delivered',
  slaDueAt: AT,
  detectedAt: AT,
  deliveredAt: AT,
}
const bundle = {
  schemaVersion: 1,
  exportId: '6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11',
  generatedAt: AT,
  scope: { scope: 'case', caseId: 'post.post-1' },
  sha256: 'a'.repeat(64),
  counts: { decisions: 1, reports: 1, auditEvents: 1, alerts: 1, withheldForConflict: 0 },
  decisions: [decision],
  reports: [report],
  auditEvents: [auditEvent],
  alerts: [alert],
}

const EXCLUDED = [
  ['reporter_id', 'member-1'],
  ['reporterId', 'member-1'],
  ['subject_user_id', 'member-1'],
  ['subjectUserId', 'member-1'],
  ['details', 'I saw this on my feed.'],
  ['content_snapshot', { caption: 'Their caption' }],
  ['contentSnapshot', { caption: 'Their caption' }],
  ['image_object_path', 'community/post-1/object.jpg'],
  ['imageObjectPath', 'community/post-1/object.jpg'],
  ['signedUrl', 'https://storage.test/object/sign/x?token=y'],
  ['mutation_id', '6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11'],
  ['mutationId', '6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11'],
  ['payload_hash', 'hash'],
  ['payloadHash', 'hash'],
  ['response', {}],
  ['ip_address', '192.0.2.1'],
  ['ipAddress', '192.0.2.1'],
  ['email', 'someone@example.test'],
  ['name', 'Someone'],
] as const

describe('U-C-EXPORT-EXCLUDED: a new column cannot leak', () => {
  it('accepts the bundle as specified', () => {
    expect(moderationEvidenceBundleSchema.safeParse(bundle).success).toBe(true)
  })

  describe.each(EXCLUDED)('%s', (key, value) => {
    it.each([
      ['decision', moderationEvidenceDecisionSchema, decision],
      ['report', moderationEvidenceReportSchema, report],
      ['audit event', moderationEvidenceAuditEventSchema, auditEvent],
      ['alert', moderationEvidenceAlertSchema, alert],
      ['envelope', moderationEvidenceBundleSchema, bundle],
    ])('is refused on the %s', (_name, schema, valid) => {
      expect(schema.safeParse({ ...valid, [key]: value }).success).toBe(false)
    })

    it('is refused when nested in an array of the bundle', () => {
      expect(
        moderationEvidenceBundleSchema.safeParse({
          ...bundle,
          reports: [{ ...report, [key]: value }],
        }).success
      ).toBe(false)
    })
  })

  it('states only member, screening or erased for a reporter', () => {
    for (const reporterState of ['member', 'screening', 'erased'])
      expect(
        moderationEvidenceReportSchema.safeParse({ ...report, reporterState }).success
      ).toBe(true)
    expect(
      moderationEvidenceReportSchema.safeParse({ ...report, reporterState: 'member-1' })
        .success
    ).toBe(false)
  })

  it('takes a null actor and a null moderator for an erased operator', () => {
    expect(
      moderationEvidenceAuditEventSchema.safeParse({ ...auditEvent, actorId: null })
        .success
    ).toBe(true)
    expect(
      moderationEvidenceDecisionSchema.safeParse({
        ...decision,
        moderatorId: null,
        reason: null,
        reasonRemoved: true,
        anonymizedAt: AT,
      }).success
    ).toBe(true)
  })

  it('takes only closed audit event types', () => {
    expect(
      moderationEvidenceAuditEventSchema.safeParse({
        ...auditEvent,
        eventType: 'moderation_erasure_requested',
      }).success
    ).toBe(false)
  })
})

describe('U-C-ERASURE-STRICT', () => {
  it('takes a member id alone', () => {
    expect(
      moderationErasureRequestSchema.safeParse({ memberId: 'member-1' }).success
    ).toBe(true)
    expect(moderationErasureRequestSchema.safeParse({}).success).toBe(false)
    expect(moderationErasureRequestSchema.safeParse({ memberId: '' }).success).toBe(false)
    expect(
      moderationErasureRequestSchema.safeParse({ memberId: 'member-1', reason: 'x' })
        .success
    ).toBe(false)
  })

  it('answers exactly four fields', () => {
    const data = { requestId: 'r', requestedAt: AT, deadlineAt: AT, replayed: false }
    expect(moderationErasureResponseSchema.safeParse({ data }).success).toBe(true)
    expect(
      moderationErasureResponseSchema.safeParse({
        data: { ...data, memberId: 'member-1' },
      }).success
    ).toBe(false)
  })

  it('pins the deadline at 72 hours', () => {
    expect(MODERATION_ERASURE_DEADLINE_MS).toBe(72 * 60 * 60 * 1000)
  })
})

describe('U-C-RESERVED-REASON', () => {
  it('uses the one constant the database knows', () => {
    expect(MODERATION_ERASED_REASON).toBe('[erased]')
  })

  it.each(['[erased]', ' [erased] ', '\n[erased]\t'])('refuses %j', (reason) => {
    expect(moderationDecisionReasonSchema.safeParse(reason).success).toBe(false)
  })

  it('accepts a reason that only contains the text', () => {
    expect(
      moderationDecisionReasonSchema.safeParse(
        'Their earlier words were [erased] by support.'
      ).success
    ).toBe(true)
  })

  it('refuses it through the decision request too', () => {
    const parsed = moderationDecisionInputSchema.safeParse({
      action: 'resolve',
      reason: '[erased]',
      mutationId: '6f1d8c0a-6c9a-4f43-9a55-7a2a8d4d2c11',
      expectedRevision: 'a'.repeat(16),
    })
    expect(parsed.success).toBe(false)
  })
})

describe('U-C-RANGE', () => {
  const from = '2026-08-01T00:00:00.000Z'
  const fromMs = Date.parse(from)
  const at = (ms: number) => new Date(fromMs + ms).toISOString()

  it('takes exactly 90 days and refuses 1 ms more', () => {
    expect(MODERATION_EVIDENCE_RANGE_MAX_MS).toBe(90 * 24 * 60 * 60 * 1000)
    expect(
      isModerationEvidenceRangeValid({ from, to: at(MODERATION_EVIDENCE_RANGE_MAX_MS) })
    ).toBe(true)
    expect(
      isModerationEvidenceRangeValid({
        from,
        to: at(MODERATION_EVIDENCE_RANGE_MAX_MS + 1),
      })
    ).toBe(false)
  })

  it('refuses from at or after to', () => {
    expect(isModerationEvidenceRangeValid({ from, to: from })).toBe(false)
    expect(isModerationEvidenceRangeValid({ from, to: at(-1) })).toBe(false)
  })

  it('reads an offset as the same instant', () => {
    const request = moderationEvidenceExportRequestSchema.parse({
      scope: 'range',
      from: '2026-08-01T00:00:00-05:00',
      to: '2026-08-01T05:00:00.000Z',
    })
    expect(request.scope).toBe('range')
    expect(
      isModerationEvidenceRangeValid({
        from: '2026-08-01T00:00:00-05:00',
        to: '2026-08-01T05:00:00.000Z',
      })
    ).toBe(false)
    expect(
      isModerationEvidenceRangeValid({
        from: '2026-08-01T00:00:00-05:00',
        to: '2026-08-01T05:00:00.001Z',
      })
    ).toBe(true)
  })

  it('refuses a body that mixes scopes, or a stray field', () => {
    expect(
      moderationEvidenceExportRequestSchema.safeParse({
        scope: 'case',
        caseId: 'post.post-1',
        from,
      }).success
    ).toBe(false)
    expect(
      moderationEvidenceExportRequestSchema.safeParse({ scope: 'range', from }).success
    ).toBe(false)
    expect(
      moderationEvidenceExportRequestSchema.safeParse({
        scope: 'case',
        caseId: '../../etc/passwd',
      }).success
    ).toBe(false)
  })

  it('pins the limits D8 and TEA-10 name', () => {
    expect(MODERATION_EVIDENCE_DECISIONS_MAX).toBe(5000)
    expect(MODERATION_EVIDENCE_BYTES_MAX).toBe(4_000_000)
  })
})
