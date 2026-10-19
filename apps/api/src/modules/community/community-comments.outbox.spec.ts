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
    {} as never,
    {} as never
  )
  await box.dispatchPending()
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
it('signals delivery failure safely and leaves its durable lease recoverable', async () => {
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
    {} as never,
    {} as never
  ).dispatchPending()
  expect(log.warn).toHaveBeenCalledExactlyOnceWith(
    {
      event: 'community_comment_delivery_failed',
      reason: 'delivery_failed',
      attempt: 4,
      pendingAgeMs: expect.any(Number) as unknown,
    },
    'Comment analytics delivery deferred'
  )
  expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(
    /secret|confidential|never logged/
  )
})
