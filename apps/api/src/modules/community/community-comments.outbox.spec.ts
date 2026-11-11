// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { beforeEach, expect, it, vi } from 'vitest'
import { CommunityCommentsOutbox } from './community-comments.outbox.js'
const log = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../../logger/pino.config.js', () => ({
  createBaseLogger: () => ({ child: () => log }),
}))
beforeEach(() => log.warn.mockClear())
it('signals enqueue failure with bounded reason/attempt/age fields and no content or identity', async () => {
  const row = {
    id: 'outbox-secret-id',
    comment_id: 'comment-secret-id',
    generation: 2,
    attempts: 3,
    created_at: new Date(Date.now() - 1000),
  }
  const prisma = {
    communityCommentScreeningOutbox: {
      findMany: vi.fn().mockResolvedValue([row]),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
  const box = new CommunityCommentsOutbox(
    prisma as never,
    {
      enqueueComment: vi
        .fn()
        .mockRejectedValue(new Error('raw member-id and private body')),
    } as never,
    { acknowledgedDeliveryAvailable: () => true } as never,
    {} as never
  )
  await expect(box.dispatchPending()).resolves.toBe(0)
  expect(log.warn).toHaveBeenCalledExactlyOnceWith(
    {
      event: 'community_comment_enqueue_failed',
      reason: 'enqueue_failed',
      attempt: 4,
      pendingAgeMs: expect.any(Number) as unknown,
    },
    'Comment screening dispatch deferred'
  )
  expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/secret|member-id|private body/)
})
it('signals a settlement failure safely and leaves its durable lease recoverable', async () => {
  const row = {
    id: 'secret-event-id',
    actor: 'secret-actor',
    event_type: 'community_comment_submitted',
    payload: { private: 'never logged' },
    created_at: new Date(),
    attempts: 4,
  }
  const prisma = {
    communityCommentScreeningOutbox: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([]),
    $transaction: vi.fn().mockRejectedValue(new Error('raw confidential SQL and actor')),
  }
  await new CommunityCommentsOutbox(
    prisma as never,
    {} as never,
    { acknowledgedDeliveryAvailable: () => true } as never,
    {} as never
  ).dispatchPending()
  expect(log.warn).toHaveBeenCalledExactlyOnceWith(
    {
      event: 'community_comment_delivery_failed',
      reason: 'settlement_failed',
      attempt: 4,
      pendingAgeMs: expect.any(Number) as unknown,
    },
    'Comment analytics delivery deferred'
  )
  expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(
    /secret|confidential|never logged/
  )
})

it.each([
  [
    'an unconfigured sink',
    new Error('Analytics ingestion is unconfigured'),
    'sink_unconfigured',
  ],
  [
    'a sink that times out',
    Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    'sink_timeout',
  ],
  ['any other failure', new Error('socket hang up'), 'delivery_failed'],
])(
  'names %s as its deferral reason and reschedules the event',
  async (_, failure, reason) => {
    const row = {
      id: 'secret-event-id',
      actor: 'secret-actor',
      event_type: 'community_comment_submitted',
      payload: { private: 'never logged' },
      created_at: new Date(),
      attempts: 1,
    }
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ actor: row.actor }])
        .mockResolvedValueOnce([{ id: row.id }]),
      communityCommentAnalyticsOutbox: { updateMany },
    }
    const prisma = {
      communityCommentScreeningOutbox: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([]),
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    }
    await new CommunityCommentsOutbox(
      prisma as never,
      {} as never,
      {
        acknowledgedDeliveryAvailable: () => true,
        captureCommentEvent: vi.fn().mockRejectedValue(failure),
      } as never,
      {} as never
    ).dispatchPending()
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'community_comment_delivery_failed',
        reason,
        attempt: 1,
        pendingAgeMs: expect.any(Number) as unknown,
      },
      'Comment analytics delivery deferred'
    )
    // Not delivered: the lease is released and the next attempt is scheduled.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lease_id: null,
          next_attempt_at: expect.any(Date) as unknown,
        }) as unknown,
      })
    )
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/secret|never logged/)
  }
)
it('R14 continues the stale sweep after one dependency failure', async () => {
  const failed = vi
    .fn()
    .mockRejectedValueOnce(new Error('fixture unavailable'))
    .mockResolvedValue(undefined)
  const prisma = {
    communityComment: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'first', screening_outbox: null },
        { id: 'second', screening_outbox: null },
      ]),
    },
    communityCommentAnalyticsOutbox: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    communityCommentScreeningOutbox: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  const box = new CommunityCommentsOutbox(
    prisma as never,
    {} as never,
    {} as never,
    { failStale: failed } as never
  )
  await expect(box.sweepStale()).resolves.toBe(1)
  expect(failed).toHaveBeenNthCalledWith(2, 'second', null)
  expect(prisma.communityCommentAnalyticsOutbox.deleteMany).not.toHaveBeenCalled()
})

it('parks analytics delivery while the sink is unconfigured: no lease, one warning, no progress', async () => {
  const prisma = {
    communityCommentScreeningOutbox: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  const capture = vi.fn()
  const box = new CommunityCommentsOutbox(
    prisma as never,
    {} as never,
    { acknowledgedDeliveryAvailable: () => false, captureCommentEvent: capture } as never,
    {} as never
  )
  await expect(box.dispatchPending()).resolves.toBe(0)
  await expect(box.dispatchPending()).resolves.toBe(0)
  expect(prisma.$queryRaw).not.toHaveBeenCalled()
  expect(prisma.$transaction).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalled()
  expect(log.warn).toHaveBeenCalledExactlyOnceWith(
    { event: 'community_comment_delivery_parked', reason: 'sink_unconfigured' },
    'Comment analytics delivery parked until the acknowledged sink is configured'
  )
})

it('counts dispatched comments and delivered analytics as progress', async () => {
  const outboxRow = {
    id: 'outbox',
    comment_id: 'comment',
    generation: 0,
    attempts: 0,
    created_at: new Date(),
  }
  const event = {
    id: 'event',
    actor: 'actor',
    event_type: 'community_comment_submitted',
    payload: {},
    created_at: new Date(),
    attempts: 1,
  }
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ actor: event.actor }])
      .mockResolvedValueOnce([{ id: event.id }]),
    communityCommentAnalyticsOutbox: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const prisma = {
    communityCommentScreeningOutbox: {
      findMany: vi.fn().mockResolvedValue([outboxRow]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValueOnce([event]).mockResolvedValue([]),
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  }
  const box = new CommunityCommentsOutbox(
    prisma as never,
    { enqueueComment: vi.fn().mockResolvedValue(undefined) } as never,
    {
      acknowledgedDeliveryAvailable: () => true,
      captureCommentEvent: vi.fn().mockResolvedValue(undefined),
    } as never,
    {} as never
  )
  await expect(box.dispatchPending()).resolves.toBe(2)
})
