import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { CommunityCommentsService } from '../src/modules/community/community-comments.service.js'
import { CommunityCommentsOutbox } from '../src/modules/community/community-comments.outbox.js'
import { eraseCommunityComments } from '../src/modules/community/community-comments.privacy.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  commentInput,
  persistCommentFixture,
} from './helpers/community-comments-context.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasourceUrl: database.url })
const queue = { enqueueComment: vi.fn().mockResolvedValue(undefined) }
const processor = { markFailed: vi.fn().mockResolvedValue(undefined) }
const flags = { getFeatureFlag: vi.fn().mockResolvedValue(true) }
const service = new CommunityCommentsService(
  new CommunityCommentsRepository(prisma),
  flags as never,
  { assertWardrobeUploadAllowed: vi.fn().mockResolvedValue(undefined) } as never
)
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function seed() {
  const { user, post } = await persistCommentFixture(prisma)
  await service.create({
    userId: user.id,
    postId: post.id,
    platform: 'web',
    input: commentInput(),
  })
  const subject = await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
    where: { user_id: user.id },
  })
  const event = await prisma.communityCommentAnalyticsOutbox.findFirstOrThrow({
    where: { actor: subject.actor },
  })
  return { user, post, subject, event }
}
beforeAll(() => database.migrate(), 30_000)
beforeEach(() => prisma.communityCommentAnalyticsSubject.deleteMany())
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

/** Delay only the return of an actually committed SQL lease, preserving its real rows. */
function pauseClaim(
  claimed: ReturnType<typeof gate>,
  release: ReturnType<typeof gate>
): PrismaClient {
  let paused = false
  return new Proxy(prisma, {
    get(target, key) {
      if (key === '$queryRaw')
        return async (...args: Parameters<PrismaClient['$queryRaw']>) => {
          const rows = await target.$queryRaw(...args)
          if (
            !paused &&
            Array.isArray(args[0]) &&
            args[0].join('').includes('UPDATE "CommunityCommentAnalyticsOutbox"') &&
            Array.isArray(rows) &&
            rows.length
          ) {
            paused = true
            claimed.release()
            await release.promise
          }
          return rows
        }
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? (value.bind(target) as unknown) : value
    },
  })
}

describe('live comment analytics delivery ownership', () => {
  it('persists real snake_case telemetry and retries one stable event only after sink acknowledgement', async () => {
    const { user, event, subject } = await seed(),
      started = gate(),
      ack = gate()
    const captureAcknowledged = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic sink refused'))
      .mockImplementationOnce(async () => {
        started.release()
        await ack.promise
      })
    const outbox = new CommunityCommentsOutbox(
      prisma,
      queue as never,
      new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged }),
      processor as never
    )
    await outbox.dispatchPending()
    expect(
      await prisma.communityCommentAnalyticsOutbox.findUniqueOrThrow({
        where: { id: event.id },
      })
    ).toMatchObject({ delivered_at: null, attempts: 1, lease_id: null })
    const stored = await prisma.telemetryEvent.findUniqueOrThrow({
      where: { id: event.id },
    })
    expect(stored).toMatchObject({
      user_id: null,
      event_type: 'community_comment_submitted',
      properties: {
        platform: 'web',
        is_self: true,
        is_reply: false,
        $insert_id: event.id,
        dedupe_key: event.id,
        $ip: null,
      },
    })
    expect(JSON.stringify(stored)).not.toContain(user.id)
    expect(JSON.stringify(stored)).not.toContain('Beautiful layers.')
    await prisma.communityCommentAnalyticsOutbox.update({
      where: { id: event.id },
      data: { next_attempt_at: new Date(0) },
    })
    const delivery = outbox.dispatchPending()
    try {
      await started.promise
      expect(
        (
          await prisma.communityCommentAnalyticsOutbox.findUniqueOrThrow({
            where: { id: event.id },
          })
        ).delivered_at
      ).toBeNull()
    } finally {
      ack.release()
    }
    await delivery
    expect(
      (
        await prisma.communityCommentAnalyticsOutbox.findUniqueOrThrow({
          where: { id: event.id },
        })
      ).delivered_at
    ).not.toBeNull()
    expect(captureAcknowledged).toHaveBeenCalledTimes(2)
    for (const [captured] of captureAcknowledged.mock.calls)
      expect(captured).toMatchObject({
        distinctId: subject.actor,
        properties: { $insert_id: event.id, dedupe_key: event.id },
      })
    expect(await prisma.telemetryEvent.count({ where: { id: event.id } })).toBe(1)
  })

  it('skips a leased event when erasure commits before live delivery ownership', async () => {
    const { user, event } = await seed(),
      claimed = gate(),
      release = gate(),
      captureAcknowledged = vi.fn().mockResolvedValue(undefined)
    const outbox = new CommunityCommentsOutbox(
      pauseClaim(claimed, release),
      queue as never,
      new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged }),
      processor as never
    )
    const delivery = outbox.dispatchPending()
    try {
      await claimed.promise
      await prisma.$transaction((tx) => eraseCommunityComments(tx, user.id))
      expect(
        await prisma.communityCommentAnalyticsOutbox.count({ where: { id: event.id } })
      ).toBe(0)
    } finally {
      release.release()
    }
    await delivery
    expect(captureAcknowledged).not.toHaveBeenCalled()
    expect(await prisma.telemetryEvent.count({ where: { id: event.id } })).toBe(0)
  })

  it('holds erasure until an already owned delivery acknowledges and never captures after erasure', async () => {
    const { user, event } = await seed(),
      started = gate(),
      ack = gate(),
      order: string[] = []
    const captureAcknowledged = vi.fn(async () => {
      started.release()
      await ack.promise
      order.push('acknowledged')
    })
    const outbox = new CommunityCommentsOutbox(
      prisma,
      queue as never,
      new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged }),
      processor as never
    )
    const delivery = outbox.dispatchPending()
    await started.promise
    const erasure = prisma
      .$transaction((tx) => eraseCommunityComments(tx, user.id))
      .then(() => {
        order.push('erased')
      })
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<
          { blocked: bigint }[]
        >`SELECT count(*) AS blocked FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%CommunityCommentAnalyticsSubject%'`
        expect(Number(row?.blocked)).toBeGreaterThan(0)
      })
      expect(order).toEqual([])
    } finally {
      ack.release()
    }
    await Promise.all([delivery, erasure])
    expect(order).toEqual(['acknowledged', 'erased'])
    expect(captureAcknowledged).toHaveBeenCalledOnce()
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({ where: { id: event.id } })
    ).toBe(0)
  })
})
