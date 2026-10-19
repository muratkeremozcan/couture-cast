import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommunityModerationWorker } from './community-moderation.worker.js'
import { COMMUNITY_COMMENT_JOB } from './community-moderation.queue.js'

const harness = vi.hoisted(() => ({
  process: vi.fn(),
  markFailed: vi.fn(),
  warn: vi.fn(),
  registered: undefined as ((job: Job) => Promise<void>) | undefined,
}))

vi.mock('./community-comments.processor.js', () => ({
  CommunityCommentsProcessor: class {
    process = harness.process
    markFailed = harness.markFailed
  },
}))
vi.mock('../../logger/pino.config.js', () => ({
  createBaseLogger: () => ({ child: () => ({ warn: harness.warn }) }),
}))
vi.mock('../../workers/base.worker.js', () => ({
  defaultWorkerOptions: () => ({}),
  createWorker: (_queue: string, processor: (job: Job) => Promise<void>) => {
    harness.registered = processor
    return { on: vi.fn(), close: vi.fn() }
  },
}))

beforeEach(() => {
  harness.process.mockReset()
  harness.markFailed.mockReset().mockResolvedValue(undefined)
  harness.warn.mockReset()
  harness.registered = undefined
  createCommunityModerationWorker({
    prisma: {} as never,
    storage: {} as never,
    telemetryService: {} as never,
  })
})

function job(attemptsMade: number): Job {
  return {
    name: COMMUNITY_COMMENT_JOB,
    data: { commentId: 'comment-confidential', generation: 2 },
    opts: { attempts: 3 },
    attemptsMade,
  } as Job
}

describe('comment worker screening error ownership', () => {
  it('preserves the exact screening error when final failure settlement also rejects', async () => {
    const screening = new Error('screening secret member content')
    harness.process.mockRejectedValue(screening)
    harness.markFailed.mockRejectedValue(new Error('confidential SQL settlement error'))

    await expect(harness.registered!(job(2))).rejects.toBe(screening)
    expect(harness.markFailed).toHaveBeenCalledExactlyOnceWith(
      'comment-confidential',
      false,
      2
    )
    expect(harness.warn).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'community_comment_failure_settlement_failed',
        reason: 'settlement_failed',
        attempt: 3,
      },
      'Comment screening failure settlement deferred'
    )
    expect(JSON.stringify(harness.warn.mock.calls)).not.toMatch(
      /secret|member content|confidential|SQL/
    )
  })

  it('preserves the screening error after successful final settlement', async () => {
    const screening = new Error('screening failed')
    harness.process.mockRejectedValue(screening)
    await expect(harness.registered!(job(2))).rejects.toBe(screening)
    expect(harness.markFailed).toHaveBeenCalledExactlyOnceWith(
      'comment-confidential',
      false,
      2
    )
    expect(harness.warn).not.toHaveBeenCalled()
  })

  it('leaves settlement untouched while a screening retry remains', async () => {
    const screening = new Error('screening failed')
    harness.process.mockRejectedValue(screening)
    await expect(harness.registered!(job(0))).rejects.toBe(screening)
    expect(harness.markFailed).not.toHaveBeenCalled()
    expect(harness.warn).not.toHaveBeenCalled()
  })
})
