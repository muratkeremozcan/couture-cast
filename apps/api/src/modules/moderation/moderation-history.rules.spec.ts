// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: U-AUDIT-HELPER, U-DIGEST, U-MAP-REASON, U-MAP-REPORTER, U-MAP-ACTOR, U-RET-CUTOFF
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ModerationEvidenceBundle } from '@couture/api-client/contracts/http'
import {
  buildModerationHistoryAuditData,
  mapModerationAuditEvent,
  mapModerationReason,
  MODERATION_ALERT_PRUNE_BATCH,
  MODERATION_ALERT_RETENTION_DAYS,
  MODERATION_HISTORY_SUBJECT,
  moderationAlertRetentionCutoff,
  moderationEvidenceDigest,
  moderationReporterState,
} from './moderation-history.rules.js'

const AT = '2026-11-05T12:00:00.000Z'
type Content = Pick<
  ModerationEvidenceBundle,
  'decisions' | 'reports' | 'auditEvents' | 'alerts'
>
const content = (): Content => ({
  decisions: [
    {
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
    },
  ],
  reports: [
    {
      reportId: 'report-1',
      source: 'post',
      reason: 'harassment',
      origin: 'member',
      reporterState: 'member',
      acceptedAt: AT,
      dueAt: AT,
      resolvedAt: null,
    },
  ],
  auditEvents: [
    {
      eventType: 'moderation_decision_applied',
      occurredAt: AT,
      actorId: 'moderator-1',
      role: 'moderator',
      action: 'resolve',
    },
  ],
  alerts: [
    {
      kind: 'breached',
      delivery: 'delivered',
      slaDueAt: AT,
      detectedAt: AT,
      deliveredAt: AT,
    },
  ],
})

describe('U-AUDIT-HELPER', () => {
  const counts = {
    decisions: 1,
    reports: 1,
    auditEvents: 1,
    alerts: 0,
    withheldForConflict: 0,
  }

  it('writes exact keys for an erasure request', () => {
    expect(
      buildModerationHistoryAuditData({
        eventType: 'moderation_erasure_requested',
        requestId: 'request-1',
        role: 'admin',
      })
    ).toEqual({ requestId: 'request-1', role: 'admin' })
  })

  it('writes exact keys for a case export', () => {
    expect(
      buildModerationHistoryAuditData({
        eventType: 'moderation_evidence_exported',
        exportId: 'export-1',
        scope: 'case',
        caseId: 'post.post-1',
        counts,
        sha256: 'a'.repeat(64),
        role: 'moderator',
      })
    ).toEqual({
      exportId: 'export-1',
      scope: 'case',
      caseId: 'post.post-1',
      counts,
      sha256: 'a'.repeat(64),
      role: 'moderator',
    })
  })

  it('writes exact keys for a range export', () => {
    expect(
      buildModerationHistoryAuditData({
        eventType: 'moderation_evidence_exported',
        exportId: 'export-1',
        scope: 'range',
        from: AT,
        to: AT,
        counts,
        sha256: 'a'.repeat(64),
        role: 'admin',
      })
    ).toEqual({
      exportId: 'export-1',
      scope: 'range',
      from: AT,
      to: AT,
      counts,
      sha256: 'a'.repeat(64),
      role: 'admin',
    })
  })

  it('drops a field a caller smuggles in, here and in the counts', () => {
    const data = buildModerationHistoryAuditData({
      eventType: 'moderation_erasure_requested',
      requestId: 'request-1',
      role: 'admin',
      subjectUserId: 'member-1',
      subjectAlias: 'Style Explorer',
      reason: 'their words',
    } as never)
    expect(JSON.stringify(data)).not.toMatch(/member-1|Style Explorer|their words/)
    const exported = buildModerationHistoryAuditData({
      eventType: 'moderation_evidence_exported',
      exportId: 'export-1',
      scope: 'case',
      caseId: 'post.post-1',
      counts: { ...counts, reporterId: 'member-1' } as never,
      sha256: 'a'.repeat(64),
      role: 'moderator',
    })
    expect(JSON.stringify(exported)).not.toContain('member-1')
  })
})

describe('U-DIGEST', () => {
  it('is stable across key order', () => {
    const base = content()
    const reordered = {
      alerts: base.alerts,
      auditEvents: base.auditEvents.map((row) => ({
        action: row.action,
        role: row.role,
        actorId: row.actorId,
        occurredAt: row.occurredAt,
        eventType: row.eventType,
      })),
      reports: base.reports,
      decisions: base.decisions,
    }
    expect(moderationEvidenceDigest(reordered)).toBe(moderationEvidenceDigest(base))
  })

  it.each([
    ['a decision', (c: Content) => (c.decisions[0]!.reason = 'Other words.')],
    ['a report', (c: Content) => (c.reports[0]!.reporterState = 'erased')],
    ['an audit event', (c: Content) => (c.auditEvents[0]!.actorId = null)],
    ['an alert', (c: Content) => (c.alerts[0]!.delivery = 'superseded')],
  ])('changes when %s changes', (_name, change) => {
    const changed = content()
    change(changed)
    expect(moderationEvidenceDigest(changed)).not.toBe(
      moderationEvidenceDigest(content())
    )
  })

  it('changes with row order, which the query fixes', () => {
    const base = content()
    base.decisions.push({ ...base.decisions[0]!, decisionId: 'decision-2', sequence: 2 })
    const flipped = { ...base, decisions: [...base.decisions].reverse() }
    expect(moderationEvidenceDigest(flipped)).not.toBe(moderationEvidenceDigest(base))
  })

  it('reads only the four arrays, so an envelope field cannot move it', () => {
    const base = content()
    expect(
      moderationEvidenceDigest({ ...base, exportId: 'x', generatedAt: AT } as Content)
    ).toBe(moderationEvidenceDigest(base))
  })

  it('matches a golden value, so a reviewer can recompute it', () => {
    const empty = { decisions: [], reports: [], auditEvents: [], alerts: [] }
    expect(moderationEvidenceDigest(empty)).toBe(
      createHash('sha256')
        .update('{"alerts":[],"auditEvents":[],"decisions":[],"reports":[]}')
        .digest('hex')
    )
  })
})

describe('U-MAP-REASON', () => {
  it('maps the constant to the marker, so it never reaches a file', () => {
    expect(mapModerationReason('[erased]')).toEqual({ reason: null, reasonRemoved: true })
  })

  it('keeps every other reason, including one that contains the text', () => {
    expect(mapModerationReason('Their words.')).toEqual({
      reason: 'Their words.',
      reasonRemoved: false,
    })
    expect(mapModerationReason('was [erased] earlier')).toEqual({
      reason: 'was [erased] earlier',
      reasonRemoved: false,
    })
  })
})

describe('U-MAP-REPORTER', () => {
  it.each([
    [{ reporter_id: 'member-1', origin: 'member' as const }, 'member'],
    [{ reporter_id: null, origin: 'screening' as const }, 'screening'],
    [{ reporter_id: null, origin: 'member' as const }, 'erased'],
  ])('reads %j as %s and carries no id', (report, state) => {
    const answer = moderationReporterState(report)
    expect(answer).toBe(state)
    expect(answer).not.toContain('member-1')
  })
})

describe('U-MAP-ACTOR', () => {
  const row = {
    event_type: 'moderation_decision_applied',
    timestamp: new Date(AT),
    user_id: 'moderator-1',
    role: 'moderator',
    action: 'resolve',
    actor_erased: false,
  }

  it('prints a live actor', () => {
    expect(mapModerationAuditEvent(row)).toEqual({
      eventType: 'moderation_decision_applied',
      occurredAt: AT,
      actorId: 'moderator-1',
      role: 'moderator',
      action: 'resolve',
    })
  })

  it('reads an actor with a request row as null', () => {
    expect(mapModerationAuditEvent({ ...row, actor_erased: true }).actorId).toBeNull()
  })

  it('copies nothing else from the row', () => {
    const mapped = mapModerationAuditEvent({
      ...row,
      event_data: { secret: 'event-data' },
      ip_address: '192.0.2.1',
    } as never)
    expect(JSON.stringify(mapped)).not.toMatch(/event-data|192\.0\.2\.1/)
  })
})

describe('U-RET-CUTOFF', () => {
  const now = new Date(AT)

  it('pins the rule', () => {
    expect(MODERATION_ALERT_RETENTION_DAYS).toBe(400)
    expect(MODERATION_ALERT_PRUNE_BATCH).toBe(500)
    expect(MODERATION_HISTORY_SUBJECT).toBe('system:moderation-history')
  })

  it('cuts exactly 400 days back, which clears a 12-month floor', () => {
    const cutoff = moderationAlertRetentionCutoff(now)
    expect(now.getTime() - cutoff.getTime()).toBe(400 * 86_400_000)
    const twelveMonthsBack = new Date(now)
    twelveMonthsBack.setUTCFullYear(now.getUTCFullYear() - 1)
    expect(cutoff.getTime()).toBeLessThan(twelveMonthsBack.getTime())
  })
})
