// Learning path Step 38: Community feed by climate band.
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { CommunityModerationOutboxDispatcher } from './community-moderation.outbox'
import type { CommunityModerationPublisher } from './community-moderation.queue'

describe('CommunityModerationOutboxDispatcher', () => {
  const createDispatcher = () => {
    const findMany = vi.fn()
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      communityModerationOutbox: { findMany, update },
    } as unknown as PrismaClient

    const enqueue = vi.fn().mockResolvedValue(undefined)
    const queue = { enqueue } as CommunityModerationPublisher

    return {
      dispatcher: new CommunityModerationOutboxDispatcher(prisma, queue),
      findMany,
      update,
      enqueue,
    }
  }

  const outboxRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'outbox-1',
    post_id: 'post-1',
    post: { image_object_path: 'community/post-1/session-abc.jpg' },
    ...overrides,
  })

  it('claims only rows that have not been dispatched', async () => {
    const { dispatcher, findMany } = createDispatcher()
    findMany.mockResolvedValueOnce([])

    await dispatcher.dispatchPending()

    expect(findMany).toHaveBeenCalledWith({
      where: { dispatched_at: null },
      orderBy: { created_at: 'asc' },
      take: 100,
      include: { post: true },
    })
  })

  it('enqueues with the upload session parsed out of the object path', async () => {
    // The job id is `postId__uploadSessionId`, so taking the session from the
    // path keeps it stable across retries without needing a column of its own.
    const { dispatcher, findMany, enqueue, update } = createDispatcher()
    findMany.mockResolvedValueOnce([outboxRow()])

    const result = await dispatcher.dispatchPending()

    expect(enqueue).toHaveBeenCalledWith('post-1', 'session-abc')
    expect(update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        dispatched_at: expect.any(Date) as Date,
        attempts: { increment: 1 },
        last_error: null,
      },
    })
    expect(result).toEqual({ dispatched: 1, failed: 0 })
  })

  it('falls back to the post id when the path predates the session convention', async () => {
    const { dispatcher, findMany, enqueue } = createDispatcher()
    findMany.mockResolvedValueOnce([
      outboxRow({ post: { image_object_path: 'community/legacy/user-1/thing.jpg' } }),
    ])

    await dispatcher.dispatchPending()

    expect(enqueue).toHaveBeenCalledWith('post-1', 'post-1')
  })

  it('falls back to the post id when the post has no object path at all', async () => {
    const { dispatcher, findMany, enqueue } = createDispatcher()
    findMany.mockResolvedValueOnce([outboxRow({ post: { image_object_path: null } })])

    await dispatcher.dispatchPending()

    expect(enqueue).toHaveBeenCalledWith('post-1', 'post-1')
  })

  it('leaves a row claimable and records the error when the enqueue fails', async () => {
    const { dispatcher, findMany, enqueue, update } = createDispatcher()
    findMany.mockResolvedValueOnce([outboxRow()])
    enqueue.mockRejectedValueOnce(new Error('redis unavailable'))

    const result = await dispatcher.dispatchPending()

    expect(result).toEqual({ dispatched: 0, failed: 1 })
    // No `dispatched_at`: the row must stay claimable for the next sweep.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { attempts: { increment: 1 }, last_error: 'redis unavailable' },
    })
  })

  it('keeps going after one row fails', async () => {
    const { dispatcher, findMany, enqueue } = createDispatcher()
    findMany.mockResolvedValueOnce([
      outboxRow(),
      outboxRow({
        id: 'outbox-2',
        post_id: 'post-2',
        post: { image_object_path: 'community/post-2/session-def.jpg' },
      }),
    ])
    enqueue.mockRejectedValueOnce(new Error('transient'))

    const result = await dispatcher.dispatchPending()

    expect(result).toEqual({ dispatched: 1, failed: 1 })
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('caps the batch at the sweep maximum even when asked for more', async () => {
    const { dispatcher, findMany } = createDispatcher()
    findMany.mockResolvedValueOnce([])

    await dispatcher.dispatchPending(5_000)

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
  })
})
