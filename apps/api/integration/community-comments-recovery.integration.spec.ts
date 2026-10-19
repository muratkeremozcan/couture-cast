import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { CommunityCommentsOutbox } from '../src/modules/community/community-comments.outbox.js'
import {
  commentsTestContext,
  MINUTE_MS,
  pinClock,
  SECOND_MS,
} from './helpers/community-comments-context.js'

const { prisma, processor, fixture, create } = commentsTestContext()

// Accepted contract value: pending screening older than 15 minutes fails privately.
const STALE_SCREENING_MS = 15 * MINUTE_MS
// Accepted contract: a failed screening enqueue waits 30 seconds before retrying.
const ENQUEUE_RETRY_MS = 30 * SECOND_MS
const NOW = new Date('2026-10-19T12:00:00.000Z')

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
function outbox(
  telemetry: unknown = { captureCommentEvent: vi.fn() },
  queue: unknown = { enqueueComment: vi.fn().mockResolvedValue(undefined) }
) {
  return new CommunityCommentsOutbox(
    prisma,
    queue as never,
    telemetry as never,
    processor
  )
}
async function age(id: string, createdAt: Date, outboxUpdatedAt = createdAt) {
  await prisma.communityComment.update({ where: { id }, data: { created_at: createdAt } })
  await prisma.communityCommentScreeningOutbox.update({
    where: { comment_id: id },
    data: { updated_at: outboxUpdatedAt },
  })
}

// The sweeps are global, so each case starts from an empty comment and analytics backlog.
beforeEach(async () => {
  await prisma.communityCommentAnalyticsSubject.deleteMany()
  await prisma.communityComment.deleteMany()
})

describe('Story 6.4 screening dispatch and recovery', () => {
  it('dispatches a fresh first generation immediately, then backs off its failed enqueue until the exact retry boundary', async () => {
    const { userId, postId } = await fixture()
    const pending = await create(userId, postId)
    const enqueueComment = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic Redis unavailable'))
      .mockResolvedValue(undefined)
    const recovery = outbox(undefined, { enqueueComment })
    await prisma.communityCommentScreeningOutbox.update({
      where: { comment_id: pending.id },
      data: { updated_at: NOW },
    })
    pinClock(NOW)
    try {
      await recovery.dispatchPending()
      expect(enqueueComment).toHaveBeenCalledExactlyOnceWith(pending.id, 0)
      expect(
        await prisma.communityCommentScreeningOutbox.findUniqueOrThrow({
          where: { comment_id: pending.id },
        })
      ).toMatchObject({ attempts: 1, generation: 0, dispatched_at: null })
      // Preserve the failed attempt while fixing Prisma's database-side update clock.
      await prisma.communityCommentScreeningOutbox.update({
        where: { comment_id: pending.id },
        data: { updated_at: NOW },
      })
      vi.setSystemTime(new Date(NOW.getTime() + ENQUEUE_RETRY_MS - 1))
      await recovery.dispatchPending()
      expect(enqueueComment).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date(NOW.getTime() + ENQUEUE_RETRY_MS))
      await recovery.dispatchPending()
      expect(enqueueComment.mock.calls).toEqual([
        [pending.id, 0],
        [pending.id, 0],
      ])
      expect(
        await prisma.communityCommentScreeningOutbox.findUniqueOrThrow({
          where: { comment_id: pending.id },
        })
      ).toMatchObject({
        attempts: 2,
        generation: 0,
        dispatched_at: new Date(NOW.getTime() + ENQUEUE_RETRY_MS),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails a 16-minute-old pending row once and leaves a 14-minute-old row pending', async () => {
    const { userId, postId } = await fixture()
    const stale = await create(userId, postId)
    const fresh = await create(userId, postId)
    await age(stale.id, new Date(NOW.getTime() - STALE_SCREENING_MS - MINUTE_MS))
    // An old outbox stamp isolates the comment-age cutoff as the only reason to skip it.
    await age(
      fresh.id,
      new Date(NOW.getTime() - STALE_SCREENING_MS + MINUTE_MS),
      new Date(NOW.getTime() - STALE_SCREENING_MS - MINUTE_MS)
    )
    pinClock(NOW)
    await outbox().sweepStale()
    vi.useRealTimers()
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: stale.id } })
    ).toMatchObject({
      status: 'screening_failed',
      screening_reason: 'screening_unavailable',
    })
    const reports = await prisma.communityCommentReport.findMany({
      where: { comment_id: stale.id },
      include: { audit: true },
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      reporter_id: null,
      content_snapshot: null,
      audit: [{ action: 'screening_failed', reason: 'screening_unavailable' }],
    })
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: fresh.id } })
    ).toMatchObject({ status: 'pending_screening', body: 'Beautiful layers.' })
    expect(
      await prisma.communityCommentReport.count({ where: { comment_id: fresh.id } })
    ).toBe(0)
  })

  it('does not fail a row whose outbox a concurrent transaction refreshed while the sweep waited on its lock', async () => {
    pinClock(NOW)
    const { userId, postId } = await fixture()
    const pending = await create(userId, postId)
    await age(pending.id, new Date(NOW.getTime() - STALE_SCREENING_MS - MINUTE_MS))
    const locked = gate(),
      commit = gate()
    const refresh = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommunityCommentScreeningOutbox" WHERE comment_id = ${pending.id} FOR UPDATE`
        await tx.communityCommentScreeningOutbox.update({
          where: { comment_id: pending.id },
          data: { updated_at: NOW },
        })
        locked.release()
        await commit.promise
      },
      { timeout: 10_000 }
    )
    let sweep: Promise<void> | undefined
    try {
      await locked.promise
      // The sweep reads the old committed stamp, selects the row, then queues on its lock.
      sweep = outbox().sweepStale()
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<
          { blocked: bigint }[]
        >`SELECT count(*) AS blocked FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%generation,updated_at FROM "CommunityCommentScreeningOutbox"%'`
        expect(Number(row?.blocked)).toBe(1)
      })
    } finally {
      commit.release()
    }
    await Promise.all([refresh, sweep])
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } })
    ).toMatchObject({ status: 'pending_screening', body: 'Beautiful layers.' })
    expect(
      await prisma.communityCommentReport.count({ where: { comment_id: pending.id } })
    ).toBe(0)
  })

  it('recovers stale screening and retries analytics after acknowledged sink failure', async () => {
    // Two clock domains: the stale sweep reads the JS clock, so it runs pinned to NOW;
    // analytics backoff writes JS time that the claim compares with database now(), so
    // dispatch runs on live time.
    const { userId, postId } = await fixture()
    const pending = await create(userId, postId)
    await age(pending.id, new Date(NOW.getTime() - STALE_SCREENING_MS - MINUTE_MS))
    const captureAcknowledged = vi
      .fn()
      .mockRejectedValueOnce(new Error('sink unavailable'))
      .mockResolvedValue(undefined)
    const telemetry = new TelemetryService(prisma, {
      capture: vi.fn(),
      captureAcknowledged,
    })
    const recovery = outbox(telemetry)
    pinClock(NOW)
    try {
      await recovery.sweepStale()
    } finally {
      vi.useRealTimers()
    }
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } }))
        .status
    ).toBe('screening_failed')
    await recovery.dispatchPending()
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { delivered_at: null },
      })
    ).toBeGreaterThan(0)
    await prisma.communityCommentAnalyticsOutbox.updateMany({
      where: { delivered_at: null },
      data: { next_attempt_at: new Date(0) },
    })
    await recovery.dispatchPending()
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { delivered_at: null },
      })
    ).toBe(0)
    const payloads = captureAcknowledged.mock.calls.map((call) => JSON.stringify(call))
    expect(
      payloads.some(
        (value) => value.includes(userId) || value.includes('Beautiful layers.')
      )
    ).toBe(false)
  })
})
