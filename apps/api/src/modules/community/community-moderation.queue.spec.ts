// Learning path Step 38: Community feed by climate band.
// Story 6.1: Community moderation queue unit tests.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueConfig } from '../../config/queues'
import {
  buildCommunityModerationJobId,
  COMMUNITY_MODERATION_JOB,
  COMMUNITY_MODERATION_QUEUE,
  communityModerationJobSchema,
  CommunityModerationQueue,
} from './community-moderation.queue'

const harness = vi.hoisted(() => ({
  queueAdd: vi.fn().mockResolvedValue(undefined),
  queueClose: vi.fn().mockResolvedValue(undefined),
  queueConstructor: vi.fn(),
  queueConfigs: [] as QueueConfig[],
}))

vi.mock('bullmq', () => ({
  Queue: class {
    add = harness.queueAdd
    close = harness.queueClose
    constructor(...args: unknown[]) {
      harness.queueConstructor(...args)
    }
  },
}))

vi.mock('../../config/queues', () => ({
  get queueConfigs() {
    return harness.queueConfigs
  },
}))

const { queueAdd, queueClose, queueConstructor, queueConfigs } = harness

describe('buildCommunityModerationJobId', () => {
  it('composes deterministic job id from postId and uploadSessionId', () => {
    const id1 = buildCommunityModerationJobId('post-abc', 'session-xyz')
    const id2 = buildCommunityModerationJobId('post-abc', 'session-xyz')
    expect(id1).toBe('post-abc__session-xyz')
    expect(id1).toBe(id2)
  })

  it('distinguishes different sessions for the same post to allow re-screening', () => {
    const id1 = buildCommunityModerationJobId('post-abc', 'session-1')
    const id2 = buildCommunityModerationJobId('post-abc', 'session-2')
    expect(id1).not.toBe(id2)
  })

  it('avoids colons because BullMQ reserves colons for Redis keys', () => {
    const id = buildCommunityModerationJobId('post-1', 'session-1')
    expect(id).not.toContain(':')
  })
})

describe('communityModerationJobSchema', () => {
  it('validates correct job payload', () => {
    const parsed = communityModerationJobSchema.parse({
      postId: 'post-123',
      uploadSessionId: 'session-456',
    })
    expect(parsed).toEqual({
      postId: 'post-123',
      uploadSessionId: 'session-456',
    })
  })

  it('accepts optional platform', () => {
    const parsed = communityModerationJobSchema.parse({
      postId: 'post-123',
      uploadSessionId: 'session-456',
      platform: 'mobile',
    })
    expect(parsed.platform).toBe('mobile')
  })

  it('rejects empty postId or uploadSessionId', () => {
    expect(() =>
      communityModerationJobSchema.parse({
        postId: '',
        uploadSessionId: 'session-456',
      })
    ).toThrow()
    expect(() =>
      communityModerationJobSchema.parse({
        postId: 'post-123',
        uploadSessionId: '',
      })
    ).toThrow()
  })

  it('rejects unknown properties strictly', () => {
    expect(() =>
      communityModerationJobSchema.parse({
        postId: 'post-123',
        uploadSessionId: 'session-456',
        unrecognized: true,
      })
    ).toThrow()
  })
})

describe('CommunityModerationQueue', () => {
  beforeEach(() => {
    queueAdd.mockClear()
    queueClose.mockClear()
    queueConstructor.mockClear()
    queueConfigs.splice(0, queueConfigs.length, {
      name: COMMUNITY_MODERATION_QUEUE,
      options: { connection: { host: 'redis.test' } },
    })
  })

  it('throws during construction if community-moderation config is missing', () => {
    queueConfigs.splice(0, queueConfigs.length)
    expect(() => new CommunityModerationQueue()).toThrow(
      'community-moderation queue configuration is missing'
    )
  })

  it('does not construct BullMQ client until first enqueue (lazy connection)', () => {
    new CommunityModerationQueue()
    expect(queueConstructor).not.toHaveBeenCalled()
  })

  it('enqueues job with deterministic ID and retention options', async () => {
    const queue = new CommunityModerationQueue()

    await queue.enqueue('post-1', 'session-1', 'web')

    expect(queueConstructor).toHaveBeenCalledWith(COMMUNITY_MODERATION_QUEUE, {
      connection: { host: 'redis.test' },
    })
    expect(queueAdd).toHaveBeenCalledWith(
      COMMUNITY_MODERATION_JOB,
      {
        postId: 'post-1',
        uploadSessionId: 'session-1',
        platform: 'web',
      },
      {
        jobId: 'post-1__session-1',
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      }
    )
  })

  it('reuses same BullMQ Queue client across multiple enqueues', async () => {
    const queue = new CommunityModerationQueue()

    await queue.enqueue('post-1', 'session-1')
    await queue.enqueue('post-2', 'session-2')

    expect(queueConstructor).toHaveBeenCalledTimes(1)
    expect(queueAdd).toHaveBeenCalledTimes(2)
  })

  it('closes BullMQ client on onModuleDestroy', async () => {
    const queue = new CommunityModerationQueue()
    await queue.enqueue('post-1', 'session-1')
    await queue.onModuleDestroy()

    expect(queueClose).toHaveBeenCalledTimes(1)
  })
})
