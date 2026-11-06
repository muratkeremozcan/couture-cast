// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: the sweep finishing an account erasure on real Postgres, with the clock injected
// and a fake only at the object store.
// I-E-CANARY-SCAN, I-C-WINDOW, -NO-POSTS, -LATE-WRITE, -STORAGE-DOWN, -REKEY, -THIRD-PARTY-COMMENT, -REPAIR-CATCH,
// -REPAIR-SPAM, -BATCH, -EARLIER-WITHDRAWAL, -TZ
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'
import {
  ERASED_REASON,
  erase,
  IDENTITY_ALLOW_LIST,
  scanForIdentity,
  seedDecision,
  seedErasableMember,
} from './helpers/moderation-history-seed.js'

vi.setConfig({ testTimeout: 120_000 })

const REQUESTED_AT = new Date('2026-11-05T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const DEADLINE_MS = ERASURE_DEADLINE_HOURS * HOUR_MS
const after = (ms: number, from = REQUESTED_AT) => new Date(from.getTime() + ms)

const ctx = moderationDecisionsTestContext()
const { prisma, clock } = ctx
const fx = decisionFixtures(prisma, clock.now)
let boot: DecisionBoot

beforeAll(async () => {
  clock.at(REQUESTED_AT)
  boot = await ctx.bootApp()
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
  clock.at(REQUESTED_AT)
})

const requestOf = (memberId: string) =>
  prisma.moderationErasureRequest.findUniqueOrThrow({ where: { member_id: memberId } })

function maintenance(client: PrismaClient = prisma) {
  const storage = new InMemoryCommunityStorage()
  return { storage, service: new CommunityMaintenanceService(client, storage) }
}

/** A seeded member whose post and audit rows point at a real object in the fake store. */
async function erasable(storage: InMemoryCommunityStorage, at = REQUESTED_AT) {
  const seeded = await seedErasableMember(prisma, fx, at)
  const post = await prisma.lookbookPost.findUniqueOrThrow({
    where: { id: seeded.post.id },
  })
  storage.put(post.image_object_path!, Buffer.from('object'))
  return { ...seeded, objectPath: post.image_object_path! }
}

describe('I-C-WINDOW: the 72-hour deadline', () => {
  it('stays open up to the late-write window, then completes inside the deadline', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT, seeded.operator.id)

    await service.sweepErasureRequests(after(60_000))
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    await service.sweepErasureRequests(
      after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - 60_000)
    )
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    expect(
      await prisma.lookbookPost.findUnique({ where: { id: seeded.post.id } })
    ).not.toBeNull()

    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))
    const request = await requestOf(seeded.member.id)
    expect(request.completed_at).not.toBeNull()
    expect(
      request.completed_at!.getTime() - request.requested_at.getTime()
    ).toBeLessThanOrEqual(DEADLINE_MS)
    expect(
      await prisma.lookbookPost.findUnique({ where: { id: seeded.post.id } })
    ).toBeNull()
    expect(storage.objects.has(seeded.objectPath)).toBe(false)
  })

  it('[I-E-CANARY-SCAN] leaves the member in no column of any table except the named ones', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT, seeded.operator.id)
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))
    expect((await requestOf(seeded.member.id)).completed_at).not.toBeNull()

    const hits = await scanForIdentity(prisma, [
      seeded.member.id,
      seeded.member.alias,
      seeded.canaries.caption,
      seeded.canaries.altText,
      seeded.canaries.details,
    ])
    const unexpected = hits.filter((hit) => !IDENTITY_ALLOW_LIST.has(hit))
    // subject_alias is the pseudonym D2 keeps, because the mapping that gave it meaning is gone.
    expect(unexpected.filter((hit) => !hit.endsWith('.subject_alias'))).toEqual([])
    const aliasKeepers = unexpected.filter((hit) => hit.endsWith('.subject_alias'))
    expect(aliasKeepers.sort()).toEqual(
      expect.arrayContaining(['ModerationDecision.subject_alias'])
    )
    for (const keeper of aliasKeepers)
      expect([
        'ModerationDecision.subject_alias',
        'CommunityPostReport.subject_alias',
        'ModerationEvent.subject_alias',
      ]).toContain(keeper)
    // The third party's words stay by design, and the third party is still a reporter.
    expect(
      (
        await prisma.communityPostReport.findUniqueOrThrow({
          where: { id: seeded.report.id },
        })
      ).details
    ).toBe(seeded.canaries.thirdPartyDetails)
  })
})

describe('I-C-NO-POSTS', () => {
  it('completes a member with no posts on the first sweep', async () => {
    const { service } = maintenance()
    const seeded = await fx.postCase()
    const reporter = seeded.reporters[0]!
    await erase(prisma, reporter.id, REQUESTED_AT)
    await service.sweepErasureRequests(after(1000))
    expect((await requestOf(reporter.id)).completed_at).toEqual(after(1000))
  })
})

describe('I-C-LATE-WRITE', () => {
  it('deletes an object recreated in the window, and waits for the purge stamp', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT)
    await service.sweepErasureRequests(after(60_000))
    expect(storage.objects.has(seeded.objectPath)).toBe(false)

    storage.put(seeded.objectPath, Buffer.from('late write'))
    await service.sweepErasureRequests(after(HOUR_MS))
    expect(storage.objects.has(seeded.objectPath)).toBe(false)
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: seeded.post.id } }))
        .objects_purged_at
    ).toBeNull()
  })
})

describe('I-C-STORAGE-DOWN', () => {
  it('stays open, logs overdue only past 72 hours, and completes after recovery', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT)
    const failure = vi
      .spyOn(storage, 'remove')
      .mockRejectedValue(new Error('storage unavailable'))
    const errors = vi.spyOn(
      (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
      'error'
    )
    const overdueLogs = () =>
      errors.mock.calls.filter(
        ([entry]) =>
          (entry as { event?: string } | undefined)?.event ===
          'moderation_erasure_overdue'
      )

    await service.sweepErasureRequests(after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS))
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()

    await service.sweepErasureRequests(after(DEADLINE_MS))
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    expect(overdueLogs()).toEqual([])

    await service.sweepErasureRequests(after(DEADLINE_MS + 60_000))
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    const logs = overdueLogs()
    expect(logs).toHaveLength(1)
    const logged = logs[0]![0] as Record<string, unknown>
    expect(logged.count).toBeGreaterThanOrEqual(1)
    expect(logged.deadlineHours).toBe(ERASURE_DEADLINE_HOURS)
    expect(JSON.stringify(logs[0])).not.toContain(seeded.member.id)

    failure.mockRestore()
    const recovered = after(DEADLINE_MS + 2 * HOUR_MS)
    await service.sweepErasureRequests(recovered)
    await service.sweepErasureRequests(after(30_000, recovered))
    expect((await requestOf(seeded.member.id)).completed_at).not.toBeNull()
  })
})

describe('I-C-REKEY', () => {
  it('moves the case to its orphan id, and the history stays reachable through report_ids', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT)
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))

    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(report.post_id).toBeNull()
    expect(report.image_object_path).toBeNull()
    const event = await prisma.moderationEvent.findUniqueOrThrow({
      where: { id: seeded.event.id },
    })
    expect(event.post_id).toBeNull()
    expect(event.image_object_path).toBeNull()
    const decision = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    expect(decision.post_id).toBeNull()
    expect(decision.case_key).toBe(`post.${seeded.post.id}`)

    clock.at(after(30_000, atWindow))
    const staff = boot.staff('moderator', await fx.operator())
    const detail = await staff.detail(`orphan-post.${seeded.report.id}`)
    const prior = detail.priorActions.find((entry) => entry.action === 'ban')
    expect(prior).toMatchObject({ reason: null, reasonRemoved: true })
    expect(JSON.stringify(detail)).not.toContain(ERASED_REASON)
    expect(JSON.stringify(detail)).not.toContain(seeded.member.id)
  })
})

describe('I-C-THIRD-PARTY-COMMENT', () => {
  it('re-keys a third party comment report, and keeps its audit and that person on the decision', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    const commenter = await fx.member('commenter')
    const comment = await fx.comment({ postId: seeded.post.id, authorId: commenter.id })
    const report = await fx.commentReport(comment.id, seeded.thirdParty.id)
    await prisma.communityCommentAudit.create({
      data: { report_id: report.id, action: 'reported', reason: 'harassment' },
    })
    const decision = await seedDecision(prisma, {
      caseKey: `comment.${comment.id}`,
      at: REQUESTED_AT,
      subjectId: commenter.id,
      commentId: comment.id,
      reportIds: [report.id],
    })
    const auditRows = await prisma.communityCommentAudit.count({
      where: { report_id: report.id },
    })
    expect(auditRows).toBeGreaterThan(0)
    await erase(prisma, seeded.member.id, REQUESTED_AT)
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))

    expect(
      await prisma.communityComment.findUnique({ where: { id: comment.id } })
    ).toBeNull()
    const kept = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: report.id },
    })
    expect(kept.comment_id).toBeNull()
    expect(kept.reporter_id).toBe(seeded.thirdParty.id)
    expect(
      await prisma.communityCommentAudit.count({ where: { report_id: report.id } })
    ).toBe(auditRows)
    const row = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: decision.id },
    })
    expect(row.comment_id).toBeNull()
    expect(row.subject_user_id).toBe(commenter.id)
    expect(row.reason).toBe('A rationale written by the moderator.')
    expect(row.anonymized_at).toBeNull()
  })
})

describe('I-C-REPAIR', () => {
  it('[I-C-REPAIR-CATCH] clears a decision that committed around the request, on the next sweep', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT, seeded.operator.id)
    const late = await seedDecision(prisma, {
      caseKey: `post.${seeded.post.id}`,
      sequence: 50,
      at: after(1000),
      subjectId: seeded.member.id,
      moderatorId: seeded.operator.id,
    })
    await service.sweepErasureRequests(after(60_000))
    const row = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: late.id },
    })
    expect(row.subject_user_id).toBeNull()
    expect(row.reason).toBe(ERASED_REASON)
    expect(row.anonymized_at).not.toBeNull()
  })

  it('[I-C-REPAIR-SPAM] writes nothing and raises nothing across many sweeps', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    await erase(prisma, seeded.member.id, REQUESTED_AT, seeded.operator.id)
    const count = () =>
      prisma.auditLog.count({
        where: {
          user_id: seeded.operator.id,
          event_type: 'moderation_history_anonymized',
        },
      })
    const before = await count()
    expect(before).toBe(1)
    for (let minutes = 1; minutes <= 6; minutes++)
      await service.sweepErasureRequests(after(minutes * 60_000))
    expect(await count()).toBe(before)
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))
    const completed = (await requestOf(seeded.member.id)).completed_at
    expect(completed).not.toBeNull()
    await service.sweepErasureRequests(after(60_000, atWindow))
    expect((await requestOf(seeded.member.id)).completed_at).toEqual(completed)
    expect(await count()).toBe(before)
  })
})

describe('I-C-BATCH', () => {
  it('waits for every post when they outnumber one sweep batch', async () => {
    const { storage, service } = maintenance()
    const member = await fx.member('many-posts')
    const repository = new CommunityRepository(prisma)
    const ids: string[] = []
    for (let index = 0; index < 205; index++) {
      const post = await fx.post({ authorId: member.id })
      const path = `community/${post.id}/object.jpg`
      await prisma.lookbookPost.update({
        where: { id: post.id },
        data: { image_object_path: path },
      })
      storage.put(path, Buffer.from('x'))
      ids.push(post.id)
    }
    await repository.requestErasureForUser(member.id, REQUESTED_AT)
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    expect((await requestOf(member.id)).completed_at).toBeNull()
    for (let tick = 1; tick <= 4; tick++)
      await service.sweepErasureRequests(after(tick * 30_000, atWindow))
    const request = await requestOf(member.id)
    expect(request.completed_at).not.toBeNull()
    expect(
      request.completed_at!.getTime() - request.requested_at.getTime()
    ).toBeLessThanOrEqual(DEADLINE_MS)
    expect(await prisma.lookbookPost.count({ where: { id: { in: ids } } })).toBe(0)
  })
})

describe('I-C-EARLIER-WITHDRAWAL', () => {
  it('keeps a withdrawn post on its own clock, and that post still blocks completion', async () => {
    const { storage, service } = maintenance()
    const seeded = await erasable(storage)
    const withdrawnAt = after(-10 * HOUR_MS)
    await new CommunityRepository(prisma).withdrawPostAndRequestErasure(
      seeded.post.id,
      withdrawnAt
    )
    await erase(prisma, seeded.member.id, REQUESTED_AT)
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: seeded.post.id } }))
        .erasure_requested_at
    ).toEqual(withdrawnAt)

    await service.sweepErasureRequests(after(HOUR_MS))
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    const pastItsWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - 10 * HOUR_MS)
    await service.sweepErasureRequests(pastItsWindow)
    await service.sweepErasureRequests(after(30_000, pastItsWindow))
    expect((await requestOf(seeded.member.id)).completed_at).not.toBeNull()
  })
})

describe('I-C-TZ', () => {
  let chicago: PrismaClient

  beforeAll(() => {
    const url = new URL(ctx.database.url)
    url.searchParams.set('options', '-c TimeZone=America/Chicago')
    chicago = new PrismaClient({ datasourceUrl: url.toString() })
  })

  afterAll(async () => {
    await chicago.$disconnect()
  })

  it('lands the window and the deadline on the same instants', async () => {
    const [{ zone } = { zone: '' }] = await chicago.$queryRaw<
      { zone: string }[]
    >`SELECT current_setting('TimeZone') AS zone`
    expect(zone).toBe('America/Chicago')
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(chicago, storage)
    const seeded = await erasable(storage)
    await new CommunityRepository(chicago).requestErasureForUser(
      seeded.member.id,
      REQUESTED_AT
    )
    expect((await requestOf(seeded.member.id)).requested_at).toEqual(REQUESTED_AT)

    await service.sweepErasureRequests(
      after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - 60_000)
    )
    expect((await requestOf(seeded.member.id)).completed_at).toBeNull()
    const atWindow = after(COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(after(30_000, atWindow))
    expect((await requestOf(seeded.member.id)).completed_at).not.toBeNull()
  })
})
