// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: the period export, what the console asks first, and the flag.
// A-X-BYTE-CAP, A-X-RANGE-CONFLICT, A-X-RANGE-LIMITS, A-X-RANGE-ROLE, A-X-SNAPSHOT, A-X-TZ
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { ModerationHistoryRepository } from '../src/modules/moderation/moderation-history.repository.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { erase, seedDecision } from './helpers/moderation-history-seed.js'
import {
  NOW,
  ERASURE,
  EXPORT,
  DAY,
  recomputeDigest,
  useModerationHistoryRoutes,
} from './helpers/moderation-history-route-context.js'

vi.setConfig({ testTimeout: 120_000 })

const {
  ctx,
  prisma,
  flagValues,
  failFlag,
  fx,
  auth,
  serverUrl,
  operator,
  postAs,
  exportAs,
  codeOf,
  parsed,
  auditCount,
} = useModerationHistoryRoutes()

describe('POST /evidence-exports: a period', () => {
  /** Each test owns a window of its own, far from the others. */
  let windowStart = new Date('2024-01-01T00:00:00.000Z').getTime()
  const newWindow = () => {
    const from = new Date(windowStart)
    windowStart += 100 * DAY
    return { from, to: new Date(from.getTime() + 90 * DAY) }
  }
  const range = (window: { from: Date; to: Date }) => ({
    scope: 'range',
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  })
  const seedMany = (
    count: number,
    window: { from: Date },
    reason = 'A rationale written by the moderator.'
  ) => {
    const run = randomUUID()
    return prisma.moderationDecision.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        case_key: `post.bulk-${run}-${index}`,
        sequence: 1,
        source: 'post',
        report_ids: [],
        action: 'resolve' as const,
        reason,
        moderator_role: 'moderator',
        mutation_id: randomUUID(),
        payload_hash: 'seeded',
        response: {},
        is_terminal: true,
        decided_at: new Date(window.from.getTime() + 1000),
      })),
    })
  }

  it('[A-X-RANGE-ROLE] refuses a moderator with admin_required, and no audit row', async () => {
    const moderator = await operator('moderator')
    const response = await exportAs(moderator, range(newWindow()))
    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('admin_required')
    expect(await auditCount('moderation_evidence_exported', moderator.id)).toBe(0)
  })

  it('[A-X-RANGE-CONFLICT] withholds every row of a case the admin wrote or reported', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const at = new Date(window.from.getTime() + 1000)

    const clean = await fx.postCase()
    const cleanRow = await seedDecision(prisma, {
      caseKey: clean.caseId,
      at,
      postId: clean.postId,
      reportIds: clean.reportIds,
    })

    const authored = await fx.post({ authorId: admin.id })
    const authoredReport = await fx.postReport(
      authored.id,
      (await fx.member('reporter')).id
    )
    await seedDecision(prisma, {
      caseKey: `post.${authored.id}`,
      at,
      postId: authored.id,
      reportIds: [authoredReport.id],
    })

    // The admin's report arrives after the first decision, so that row does not name it.
    const reported = await fx.postCase()
    await seedDecision(prisma, {
      caseKey: reported.caseId,
      sequence: 1,
      at,
      postId: reported.postId,
      reportIds: reported.reportIds,
    })
    const theirs = await fx.postReport(reported.postId, admin.id)
    await seedDecision(prisma, {
      caseKey: reported.caseId,
      sequence: 2,
      at,
      postId: reported.postId,
      reportIds: [...reported.reportIds, theirs.id],
    })

    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(200)
    const bundle = parsed(response)
    expect(bundle.decisions.map((row) => row.decisionId)).toEqual([cleanRow.id])
    expect(bundle.counts.withheldForConflict).toBe(3)
    expect(bundle.reports.map((row) => row.reportId)).toEqual(clean.reportIds)
    expect(recomputeDigest(bundle)).toBe(bundle.sha256)
  })

  it('[A-X-RANGE-LIMITS] pins from and to at the instant, both ends included', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const edge = await seedDecision(prisma, {
      caseKey: 'post.edge-from',
      at: window.from,
    })
    const last = await seedDecision(prisma, { caseKey: 'post.edge-to', at: window.to })
    const before = await seedDecision(prisma, {
      caseKey: 'post.edge-before',
      at: new Date(window.from.getTime() - 1),
    })
    const after = await seedDecision(prisma, {
      caseKey: 'post.edge-after',
      at: new Date(window.to.getTime() + 1),
    })
    const bundle = parsed(await exportAs(admin, range(window)))
    const ids = bundle.decisions.map((row) => row.decisionId)
    expect(ids).toEqual(expect.arrayContaining([edge.id, last.id]))
    expect(ids).not.toContain(before.id)
    expect(ids).not.toContain(after.id)
    const offset = parsed(
      await exportAs(admin, {
        scope: 'range',
        from: '2024-01-01T00:00:00+02:00',
        to: new Date(Date.parse('2024-01-01T00:00:00+02:00') + DAY).toISOString(),
      })
    )
    expect(offset.scope).toMatchObject({ from: '2023-12-31T22:00:00.000Z' })
  })

  it('[A-X-RANGE-LIMITS] refuses more than 90 days with invalid_range', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const response = await exportAs(admin, {
      ...range(window),
      to: new Date(window.from.getTime() + 90 * DAY + 1).toISOString(),
    })
    expect(response.status).toBe(400)
    expect(codeOf(response)).toBe('invalid_range')
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(0)
  })

  it('[A-X-RANGE-LIMITS, A-X-LOAD] takes 5,000 decisions inside the budget and refuses 5,001 on the count', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    await seedMany(5000, window)
    const started = performance.now()
    const allowed = await exportAs(admin, range(window))
    const elapsed = performance.now() - started
    expect(allowed.status).toBe(200)
    expect(parsed(allowed).counts.decisions).toBe(5000)
    expect(Buffer.byteLength(allowed.text)).toBeLessThanOrEqual(4_000_000)
    expect(elapsed).toBeLessThan(15_000)
    await seedMany(1, window)
    const findMany = vi.spyOn(ModerationHistoryRepository.prototype, 'decisionsInRange')
    const refused = await exportAs(admin, range(window))
    expect(refused.status).toBe(413)
    expect(codeOf(refused)).toBe('export_too_large')
    expect(findMany).not.toHaveBeenCalled()
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(1)
  })

  it('[A-X-BYTE-CAP] refuses a legal count over 4,000,000 bytes, with no audit row', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    await seedMany(5000, window, 'x'.repeat(1000))
    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(413)
    expect(codeOf(response)).toBe('export_too_large')
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(0)
  })

  it('[A-X-BYTE-CAP] passes a bundle just under 4,000,000 bytes', async () => {
    const admin = await operator('admin')
    const probe = newWindow()
    await seedMany(100, probe, 'x'.repeat(1000))
    const sized = await exportAs(admin, range(probe))
    const perRow = Buffer.byteLength(sized.text) / 100
    const window = newWindow()
    await seedMany(Math.floor(3_950_000 / perRow), window, 'x'.repeat(1000))
    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(200)
    const bytes = Buffer.byteLength(response.text)
    expect(bytes).toBeGreaterThan(3_800_000)
    expect(bytes).toBeLessThanOrEqual(4_000_000)
  })

  it('[A-X-SNAPSHOT] keeps counts, arrays and digest on one snapshot when a write lands mid-read', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const seeded = await fx.postCase()
    await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: new Date(window.from.getTime() + 1000),
      postId: seeded.postId,
      reportIds: seeded.reportIds,
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored by being called with `this`.
    const original = ModerationHistoryRepository.prototype.reports
    let landed = false
    vi.spyOn(ModerationHistoryRepository.prototype, 'reports').mockImplementation(
      async function (this: ModerationHistoryRepository, tx, ids) {
        if (!landed) {
          landed = true
          // The real client, so this commits while the export's transaction is open.
          await prisma.moderationSlaAlert.create({
            data: {
              dedupe_key: `sla:post:${seeded.reportIds[0]}:at_risk`,
              kind: 'at_risk',
              case_key: seeded.caseId,
              source: 'post',
              anchor_report_id: seeded.reportIds[0]!,
              risk: 'medium',
              sla_due_at: NOW,
              detected_at: NOW,
              next_attempt_at: NOW,
            },
          })
        }
        return (await original.call(this, tx, ids)) as Awaited<
          ReturnType<typeof original>
        >
      }
    )
    const bundle = parsed(await exportAs(admin, range(window)))
    expect(landed).toBe(true)
    expect(bundle.alerts).toEqual([])
    expect(bundle.counts.alerts).toBe(0)
    const rows = await prisma.auditLog.findMany({
      where: { user_id: admin.id, event_type: 'moderation_evidence_exported' },
    })
    expect(rows.at(-1)!.event_data).toMatchObject({ sha256: bundle.sha256 })
  })

  it('[A-X-TZ] selects the same rows on a Chicago session as on UTC', async () => {
    const window = newWindow()
    await seedDecision(prisma, { caseKey: 'post.tz-in', at: window.from })
    await seedDecision(prisma, {
      caseKey: 'post.tz-out',
      at: new Date(window.from.getTime() - 3 * 60 * 60 * 1000),
    })
    const session = (zone: string) => {
      const url = new URL(ctx.database.url)
      url.searchParams.set('options', `-c TimeZone=${zone}`)
      return new PrismaClient({ datasourceUrl: url.toString() })
    }
    const utc = session('UTC')
    const chicago = session('America/Chicago')
    const repository = new ModerationHistoryRepository()
    try {
      const read = (client: PrismaClient) =>
        repository
          .decisionsInRange(client as never, window.from, window.to)
          .then((rows) => rows.map((row) => row.id))
      const onUtc = await read(utc)
      expect(onUtc).toHaveLength(1)
      expect(await read(chicago)).toEqual(onUtc)
    } finally {
      await utc.$disconnect()
      await chicago.$disconnect()
    }
  })
})

describe('A-AVAILABILITY: what the console asks before it offers a control', () => {
  const AVAILABILITY = `${EXPORT}/availability`
  const getAs = (role: string, id: string) =>
    request(serverUrl()).get(AVAILABILITY).set('Authorization', auth(role, id))

  it('answers a moderator and an admin apart, in private', async () => {
    const moderator = await operator('moderator')
    const admin = await operator('admin')
    const asModerator = await getAs('moderator', moderator.id)
    expect(asModerator.status).toBe(200)
    expect(asModerator.headers['cache-control']).toBe('private, no-store')
    expect(asModerator.body).toEqual({ data: { rangeExport: false } })
    expect((await getAs('admin', admin.id)).body).toEqual({ data: { rangeExport: true } })
  })

  it('closes with the flag off, and hides that from anyone else', async () => {
    const admin = await operator('admin')
    flagValues.set('moderation_history_enabled', false)
    const closed = await getAs('admin', admin.id)
    expect(closed.status).toBe(503)
    expect(codeOf(closed)).toBe('moderation_history_disabled')
    const guardian = await getAs('guardian', admin.id)
    expect(guardian.status).toBe(403)
    expect(codeOf(guardian)).toBeUndefined()
    expect((await request(serverUrl()).get(AVAILABILITY)).status).toBe(401)
  })
})

describe('A-X-DENIED-NO-AUDIT and A-FLAG-OFF', () => {
  it('leaves the audit count unchanged on every refusal', async () => {
    const moderator = await operator('moderator')
    const admin = await operator('admin')
    const seeded = await fx.postCase()
    const before = await auditCount('moderation_evidence_exported')
    expect(
      (
        await request(serverUrl())
          .post(EXPORT)
          .send({ scope: 'case', caseId: seeded.caseId })
      ).status
    ).toBe(401)
    expect(
      (
        await postAs(EXPORT, 'guardian', moderator.id).send({
          scope: 'case',
          caseId: seeded.caseId,
        })
      ).status
    ).toBe(403)
    expect((await exportAs(moderator, { scope: 'case' })).status).toBe(400)
    expect(
      (await exportAs(moderator, { scope: 'case', caseId: 'post.no-such' })).status
    ).toBe(404)
    expect(
      (
        await exportAs(moderator, {
          scope: 'range',
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
        })
      ).status
    ).toBe(403)
    expect(
      (
        await exportAs(admin, {
          scope: 'range',
          from: '2024-01-02T00:00:00Z',
          to: '2024-01-01T00:00:00Z',
        })
      ).status
    ).toBe(400)
    flagValues.set('moderation_history_enabled', false)
    expect(
      (await exportAs(moderator, { scope: 'case', caseId: seeded.caseId })).status
    ).toBe(503)
    expect(await auditCount('moderation_evidence_exported')).toBe(before)
  })

  it.each([
    [
      'moderation_history_enabled off',
      () => flagValues.set('moderation_history_enabled', false),
    ],
    [
      'moderation_console_enabled off',
      () => flagValues.set('moderation_console_enabled', false),
    ],
    ['a failed flag read', () => failFlag('moderation_history_enabled')],
  ])(
    'closes both routes on %s, before input, and keeps enforcement live',
    async (_name, close) => {
      const admin = await operator('admin')
      const target = await fx.member('target')
      const decision = await seedDecision(prisma, {
        caseKey: `post.flag-${randomUUID()}`,
        at: NOW,
      })
      close()
      for (const response of [
        await postAs(ERASURE, 'admin', admin.id).send({ memberId: target.id }),
        await postAs(ERASURE, 'admin', admin.id).send({ bad: true }),
        await exportAs(admin, { scope: 'case', caseId: 'post.anything' }),
        await exportAs(admin, { bad: true }),
      ]) {
        expect(response.status).toBe(503)
        expect(codeOf(response)).toBe('moderation_history_disabled')
      }
      // A non-moderator never learns the flag state.
      const guardian = await postAs(EXPORT, 'guardian', admin.id).send({ bad: true })
      expect(guardian.status).toBe(403)
      expect(codeOf(guardian)).toBeUndefined()
      await expect(
        prisma.moderationDecision.update({
          where: { id: decision.id },
          data: { reason: 'rewritten' },
        })
      ).rejects.toThrow()
    }
  )
})

/** Completes an erasure on the real sweep, so a later step meets what a real one leaves. */
async function completeErasure(memberId: string) {
  const service = new CommunityMaintenanceService(prisma, new InMemoryCommunityStorage())
  await erase(prisma, memberId, NOW)
  const atWindow = new Date(NOW.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
  await service.sweepErasureRequests(atWindow)
  await service.sweepErasureRequests(new Date(atWindow.getTime() + 30_000))
  expect(
    (
      await prisma.moderationErasureRequest.findUniqueOrThrow({
        where: { member_id: memberId },
      })
    ).completed_at
  ).not.toBeNull()
}

describe('Evidence across the reports a decision joined', () => {
  /** A post with two reports, the first by the exporter, and a decision over both. */
  async function joined(role: 'moderator' | 'admin') {
    const seeded = await fx.postCase({ reports: 2 })
    const [mine, other] = seeded.reportIds as [string, string]
    const decision = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      postId: seeded.postId,
      subjectId: seeded.author.id,
      reportIds: [mine, other],
    })
    return {
      seeded,
      mine,
      other,
      decision,
      exporter: { id: seeded.reporters[0]!.id, role },
    }
  }

  it('[A-X-ORPHAN-SIBLING] refuses the other report once the post is gone, with no audit row', async () => {
    const { seeded, other, exporter } = await joined('moderator')
    const direct = await exportAs(exporter, { scope: 'case', caseId: seeded.caseId })
    expect([direct.status, codeOf(direct)]).toEqual([403, 'self_review_refused'])
    await completeErasure(seeded.author.id)

    const sibling = await exportAs(exporter, {
      scope: 'case',
      caseId: `orphan-post.${other}`,
    })
    expect([sibling.status, codeOf(sibling)]).toEqual([403, 'self_review_refused'])
    expect(await auditCount('moderation_evidence_exported', exporter.id)).toBe(0)
  })

  it('[A-X-RANGE-CLOSURE] withholds every decision reached through a shared report', async () => {
    const { mine, other, decision, exporter } = await joined('admin')
    // A chain across re-keyed cases: neither names the exporter's report, and neither shares its case key.
    const reachedOnlyThroughOther = await seedDecision(prisma, {
      caseKey: `orphan-post.${other}`,
      at: NOW,
      reportIds: [other, 'a-third-report'],
    })
    const reachedAtTheEnd = await seedDecision(prisma, {
      caseKey: 'orphan-post.a-third-report',
      at: NOW,
      reportIds: ['a-third-report'],
    })
    const unrelated = await fx.postCase()
    const kept = await seedDecision(prisma, {
      caseKey: unrelated.caseId,
      at: NOW,
      reportIds: unrelated.reportIds,
    })
    const day = NOW.toISOString().slice(0, 10)
    const answered = await exportAs(exporter, {
      scope: 'range',
      from: `${day}T00:00:00.000Z`,
      to: `${day}T23:59:59.999Z`,
    })
    expect(answered.status, JSON.stringify(answered.body)).toBe(200)
    const bundle = parsed(answered)
    const decisionIds = bundle.decisions.map((row) => row.decisionId)
    expect(decisionIds).not.toContain(decision.id)
    expect(decisionIds).not.toContain(reachedOnlyThroughOther.id)
    expect(decisionIds).not.toContain(reachedAtTheEnd.id)
    expect(decisionIds).toContain(kept.id)
    const reportIds = bundle.reports.map((row) => row.reportId)
    expect(reportIds).not.toContain(mine)
    expect(reportIds).not.toContain(other)
    expect(bundle.counts.withheldForConflict).toBeGreaterThanOrEqual(3)
  })

  it('[A-X-RANGE-CLOSURE] withholds a decision whose only link to the exporter is outside the period', async () => {
    const { seeded, other, exporter } = await joined('admin')
    await completeErasure(seeded.author.id)
    // The decision that joined the reports is on NOW's day. This one is two days later.
    const later = new Date(NOW.getTime() + 2 * DAY)
    const reached = await seedDecision(prisma, {
      caseKey: `orphan-post.${other}`,
      at: later,
      reportIds: [other],
    })
    const day = later.toISOString().slice(0, 10)
    const answered = await exportAs(exporter, {
      scope: 'range',
      from: `${day}T00:00:00.000Z`,
      to: `${day}T23:59:59.999Z`,
    })
    expect(answered.status, JSON.stringify(answered.body)).toBe(200)
    const bundle = parsed(answered)
    expect(bundle.decisions.map((row) => row.decisionId)).not.toContain(reached.id)
    expect(bundle.reports.map((row) => row.reportId)).not.toContain(other)
  })
})

describe('I-O-AFTER: an erased operator on the routes that read or write for staff', () => {
  const erased = async (role: 'moderator' | 'admin') => {
    const who = await operator(role)
    await completeErasure(who.id)
    return who
  }
  const getAs = (who: { id: string; role: string }, path: string) =>
    request(serverUrl())
      .get(path)
      .set('Authorization', auth(who.role, who.id))
      .set('x-couture-platform', 'web')

  it('refuses the queue, the case, the SLA page and the export availability', async () => {
    const seeded = await fx.postCase()
    const who = await erased('admin')
    for (const path of [
      '/api/v1/moderation/cases',
      `/api/v1/moderation/cases/${seeded.caseId}`,
      '/api/v1/moderation/sla',
      `${EXPORT}/availability`,
    ]) {
      const answered = await getAs(who, path)
      expect([path, answered.status]).toEqual([path, 403])
    }
  })

  it('refuses an export and an erasure request, and writes no audit row', async () => {
    const seeded = await fx.postCase()
    const target = await fx.member('target')
    const who = await erased('admin')
    const exported = await exportAs(who, { scope: 'case', caseId: seeded.caseId })
    expect(exported.status).toBe(403)
    const requested = await postAs(ERASURE, who.role, who.id).send({
      memberId: target.id,
    })
    expect(requested.status).toBe(403)
    expect(
      await prisma.moderationErasureRequest.count({ where: { member_id: target.id } })
    ).toBe(0)
    expect(await auditCount('moderation_evidence_exported', who.id)).toBe(0)
    expect(await auditCount('moderation_erasure_requested', who.id)).toBe(0)
  })

  it('refuses the older actions route', async () => {
    const who = await erased('admin')
    const answered = await postAs('/api/v1/moderation/actions', who.role, who.id).send({
      moderatorId: who.id,
      targetId: randomUUID(),
      action: 'note',
      reason: 'Words.',
    })
    expect(answered.status).toBe(403)
    expect(
      await prisma.moderationEvent.count({ where: { reviewed_by_id: who.id } })
    ).toBe(0)
  })
})
