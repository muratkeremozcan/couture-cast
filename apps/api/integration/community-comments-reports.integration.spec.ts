// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { describe, expect, it } from 'vitest'
import {
  buildCommunityPostReportCreateInput,
  createCommunityPostReport,
} from '@couture/testing'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  commentsTestContext,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  pinClock,
} from './helpers/community-comments-context.js'

const { prisma, processor, service, input, fixture, create, publish } =
  commentsTestContext()

// Accepted contract values: 50 shared reports per rolling day, routed within five minutes.
const REPORT_LIMIT = 50
const ROUTING_BOUND_MS = 5 * MINUTE_MS
const NOW = new Date('2026-10-19T12:00:00.000Z')

async function reportFixture() {
  const { userId, postId } = await fixture()
  const reporter = await fixture()
  const root = await publish(userId, postId)
  const params = {
    userId: reporter.userId,
    postId,
    commentId: root.id,
    reason: 'spam' as const,
    platform: 'web' as const,
  }
  return { userId, postId, reporter, root, params }
}

describe('Story 6.4 comment report intake', () => {
  it('commits report intake, audit, snapshot and a five-minute routing bound together', async () => {
    const { root, params } = await reportFixture()
    const response = await service.report(params)
    expect(
      Date.parse(response.routedAt) - Date.parse(response.acceptedAt)
    ).toBeLessThanOrEqual(ROUTING_BOUND_MS)
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { comment_id: root.id },
      include: { audit: true },
    })
    expect(report.audit).toHaveLength(1)
    expect(report.audit[0]).toMatchObject({ action: 'reported', reason: 'spam' })
    expect(report.sla_due_at.getTime() - report.accepted_at.getTime()).toBe(DAY_MS)
    expect(report.content_snapshot).toEqual({
      body: 'Beautiful layers.',
      locale: 'en-US',
    })
  })

  it('deduplicates an identical retry and refuses a changed reason or a self-report', async () => {
    const { userId, params } = await reportFixture()
    const response = await service.report(params)
    expect(await service.report(params)).toEqual(response)
    await expect(service.report({ ...params, reason: 'other' })).rejects.toMatchObject({
      status: 409,
    })
    await expect(service.report({ ...params, userId })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('keeps the comment audit append-only', async () => {
    const { root, params } = await reportFixture()
    await service.report(params)
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { comment_id: root.id },
      include: { audit: true },
    })
    await expect(
      prisma.communityCommentAudit.update({
        where: { id: report.audit[0]!.id },
        data: { reason: 'other' },
      })
    ).rejects.toThrow(/append-only/)
  })

  it('keeps a published snapshot through author deletion, stores a placeholder afterwards and scrubs on author erasure', async () => {
    const { userId, postId, root, params } = await reportFixture()
    await service.report(params)
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { comment_id: root.id },
    })
    await service.delete({ userId, postId, commentId: root.id, platform: 'web' })
    const another = await fixture()
    await service.report({ ...params, userId: another.userId })
    const placeholderReport = await prisma.communityCommentReport.findFirstOrThrow({
      where: { reporter_id: another.userId },
    })
    expect(placeholderReport.content_snapshot).toEqual({ unavailable: true })
    const retained = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: report.id },
    })
    expect(retained.content_snapshot).toEqual(report.content_snapshot)
    expect(retained.content_snapshot).toMatchObject({ body: 'Beautiful layers.' })
    await new CommunityRepository(prisma).requestErasureForUser(userId, new Date())
    expect(
      (
        await prisma.communityCommentReport.findUniqueOrThrow({
          where: { id: report.id },
        })
      ).content_snapshot
    ).toBeNull()
  })

  it("refuses to report another member's pending comment and writes no report", async () => {
    const { postId, reporter, params } = await reportFixture()
    const author = await fixture()
    const pending = await create(author.userId, postId)
    await expect(
      service.report({ ...params, commentId: pending.id })
    ).rejects.toMatchObject({ status: 400, message: 'Comment target is unavailable.' })
    expect(
      await prisma.communityCommentReport.count({
        where: { reporter_id: reporter.userId },
      })
    ).toBe(0)
  })

  it("refuses to report another member's withheld comment and writes no member report", async () => {
    const { postId, reporter, params } = await reportFixture()
    const author = await fixture()
    const held = await create(author.userId, postId, input('damn'))
    await processor.process(held.id)
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: held.id } })).status
    ).toBe('held_for_review')
    await expect(service.report({ ...params, commentId: held.id })).rejects.toMatchObject(
      { status: 400, message: 'Comment target is unavailable.' }
    )
    expect(
      await prisma.communityCommentReport.count({
        where: { reporter_id: reporter.userId },
      })
    ).toBe(0)
  })

  it('shares report limits with post reporting and bypasses quota for accepted replays', async () => {
    pinClock(NOW)
    const { userId, postId, reporter, params } = await reportFixture()
    await service.report(params)
    // All quota rows share the service clock, one hour inside the rolling day.
    const seededAt = new Date(NOW.getTime() - HOUR_MS)
    await prisma.communityPostReport.createMany({
      data: Array.from({ length: REPORT_LIMIT - 1 }, () =>
        buildCommunityPostReportCreateInput(
          createCommunityPostReport(
            { reporterId: reporter.userId, postId: null, reason: 'spam' },
            { now: seededAt }
          )
        )
      ),
    })
    expect((await service.report(params)).reported).toBe(true)
    const next = await publish(userId, postId)
    await expect(service.report({ ...params, commentId: next.id })).rejects.toMatchObject(
      { status: 429 }
    )
    const result = await new CommunityRepository(prisma).recordReport({
      postId,
      reporterId: reporter.userId,
      reason: 'spam',
      abuseLimit: REPORT_LIMIT,
      slaHours: 24,
      subjectAlias: 'Synthetic',
    })
    expect(result.kind).toBe('rate_limited')
  })
})
