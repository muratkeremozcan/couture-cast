// Learning path Step 5: Queueing and worker reliability.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-5-queueing-and-worker-reliability
import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jobFailure: {
    create: vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(),
  },
  workerConstructorArgs: [] as [string, unknown, unknown][],
  failedHandlers: [] as ((job?: Job, err?: Error) => void)[],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    jobFailure = mocks.jobFailure
  },
}))

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(name: string, processor: unknown, options: unknown) {
      mocks.workerConstructorArgs.push([name, processor, options])
    }

    on(event: string, handler: (job?: Job, err?: Error) => void) {
      if (event === 'failed') {
        mocks.failedHandlers.push(handler)
      }
      return this
    }
  },
  Queue: class {},
}))

// vi.mock is hoisted above this import, so the mocked bullmq/Prisma modules are
// already in place by the time the worker factory is evaluated.
import { createWorker, defaultJobOptions, defaultWorkerOptions } from './base.worker.js'

const buildJob = (overrides: Partial<Job> = {}) =>
  ({
    id: 'job-42',
    data: { locationKey: 'chicago-il' },
    attemptsMade: 3,
    ...overrides,
  }) as unknown as Job

const emitFailure = (job?: Job, err?: Error) => {
  const handler = mocks.failedHandlers.at(-1)
  if (!handler) {
    throw new Error('expected createWorker to register a failed listener')
  }
  handler(job, err)
}

describe('base worker foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workerConstructorArgs.length = 0
    mocks.failedHandlers.length = 0
    mocks.jobFailure.create.mockResolvedValue({ id: 'failure-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createWorker', () => {
    const processor = vi.fn<(job: Job) => Promise<void>>()

    it('builds the BullMQ worker with the supplied processor and options', () => {
      const options = defaultWorkerOptions(4)

      createWorker('weather-refresh', processor, options)

      expect(mocks.workerConstructorArgs[0]).toEqual([
        'weather-refresh',
        processor,
        options,
      ])
      expect(mocks.failedHandlers).toHaveLength(1)
    })

    it('records a dead-letter row when a job fails', async () => {
      createWorker('weather-refresh', processor, defaultWorkerOptions(1))

      emitFailure(buildJob(), new Error('provider timeout'))

      await vi.waitFor(() => {
        expect(mocks.jobFailure.create).toHaveBeenCalledWith({
          data: {
            queue_name: 'weather-refresh',
            job_id: 'job-42',
            job_data: { locationKey: 'chicago-il' },
            error_message: 'provider timeout',
            attempts: 3,
          },
        })
      })
    })

    it('ignores a failure event that carries no job', async () => {
      // BullMQ emits `failed` without a job when it cannot deserialise one; there
      // is no durable record to write in that case.
      createWorker('weather-refresh', processor, defaultWorkerOptions(1))

      emitFailure(undefined, new Error('boom'))

      await Promise.resolve()
      expect(mocks.jobFailure.create).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'no error object at all', err: undefined },
      { name: 'an error with a blank message', err: new Error('') },
    ])('falls back to a placeholder message when there is $name', async ({ err }) => {
      // The DLQ row must still be written; an unhelpful message beats losing the job.
      createWorker('alert-fanout', processor, defaultWorkerOptions(1))

      emitFailure(buildJob(), err)

      await vi.waitFor(() => {
        expect(mocks.jobFailure.create.mock.calls[0]?.[0].data).toMatchObject({
          error_message: 'Unknown error',
        })
      })
    })

    it('defaults the attempt count to zero when BullMQ did not report one', async () => {
      createWorker('alert-fanout', processor, defaultWorkerOptions(1))

      emitFailure(buildJob({ attemptsMade: undefined }), new Error('nope'))

      await vi.waitFor(() => {
        expect(mocks.jobFailure.create.mock.calls[0]?.[0].data).toMatchObject({
          attempts: 0,
        })
      })
    })

    it('does not surface a rejection when the dead-letter write itself fails', async () => {
      // This runs inside a fire-and-forget listener, so an escaping rejection
      // would become an unhandled rejection and take the worker process down.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.jobFailure.create.mockRejectedValue(new Error('database unreachable'))
      createWorker('alert-fanout', processor, defaultWorkerOptions(1))

      emitFailure(buildJob(), new Error('provider timeout'))

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to write job failure',
          expect.any(Error)
        )
      })
    })
  })

  describe('defaultWorkerOptions', () => {
    afterEach(() => {
      delete process.env.REDIS_URL
    })

    it('applies the queue-specific concurrency cap alongside the shared connection', () => {
      process.env.REDIS_URL = 'redis://queue.example.com:6399'

      expect(defaultWorkerOptions(8)).toMatchObject({
        concurrency: 8,
        connection: { host: 'queue.example.com', port: 6399 },
      })
    })
  })

  it('retries background jobs three times with exponential backoff', () => {
    expect(defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    })
  })
})
