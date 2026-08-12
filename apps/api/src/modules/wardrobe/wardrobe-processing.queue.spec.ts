// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off the mocked BullMQ boundary, which is the established pattern for these suites. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueConfig } from '../../config/queues'
import {
  GARMENT_COLOR_PROCESSING_JOB,
  garmentColorProcessingJobSchema,
  WardrobeProcessingQueue,
} from './wardrobe-processing.queue'

/**
 * BullMQ and the shared queue configuration are Redis-backed boundaries: the
 * config module resolves a live connection at import time. Replacing both keeps
 * the lazy-construction contract testable without opening a socket, and is the
 * only way to exercise the missing-configuration case at all.
 */
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

describe('garmentColorProcessingJobSchema', () => {
  it('validates garmentId and rejects invalid inputs', () => {
    expect(garmentColorProcessingJobSchema.parse({ garmentId: 'g_123' })).toEqual({
      garmentId: 'g_123',
    })
    expect(() => garmentColorProcessingJobSchema.parse({ garmentId: '' })).toThrow()
    expect(GARMENT_COLOR_PROCESSING_JOB).toBe('garment-color-processing')
  })

  /** A stray field would silently widen the job payload workers deserialize. */
  it('rejects an unknown field on the job payload', () => {
    expect(() =>
      garmentColorProcessingJobSchema.parse({ garmentId: 'g_123', priority: 1 })
    ).toThrow()
  })
})

describe('WardrobeProcessingQueue', () => {
  beforeEach(() => {
    queueAdd.mockClear()
    queueClose.mockClear()
    queueConstructor.mockClear()
    queueConfigs.splice(0, queueConfigs.length, {
      name: 'color-extraction',
      options: { connection: { host: 'redis.test' } },
    })
  })

  /**
   * Constructing the BullMQ client eagerly opens a Redis TCP handshake at
   * serverless cold start, which previously failed the health-check path before
   * any queue work existed. Construction must wait for the first enqueue.
   */
  it('does not construct the BullMQ client until the first enqueue', () => {
    new WardrobeProcessingQueue()
    expect(queueConstructor).not.toHaveBeenCalled()
  })

  it('enqueues the garment under a deduplicating job id with bounded retention', async () => {
    const queue = new WardrobeProcessingQueue()

    await queue.enqueue('garment-1')

    expect(queueConstructor).toHaveBeenCalledWith('color-extraction', {
      connection: { host: 'redis.test' },
    })
    expect(queueAdd).toHaveBeenCalledWith(
      'garment-color-processing',
      { garmentId: 'garment-1' },
      {
        jobId: 'garment-1',
        removeOnComplete: { age: 604_800 },
        removeOnFail: { age: 604_800 },
      }
    )
  })

  /** One client per instance: a second enqueue must reuse the open connection. */
  it('reuses the same client across enqueues', async () => {
    const queue = new WardrobeProcessingQueue()

    await queue.enqueue('garment-1')
    await queue.enqueue('garment-2')

    expect(queueConstructor).toHaveBeenCalledTimes(1)
    expect(queueAdd).toHaveBeenCalledTimes(2)
  })

  /** An invalid garment id must be rejected before a job reaches Redis. */
  it('rejects an empty garment id without enqueuing', async () => {
    const queue = new WardrobeProcessingQueue()

    await expect(queue.enqueue('')).rejects.toThrow()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('closes the client on module destroy', async () => {
    const queue = new WardrobeProcessingQueue()
    await queue.enqueue('garment-1')

    await queue.onModuleDestroy()

    expect(queueClose).toHaveBeenCalledTimes(1)
  })

  /** Shutting down a never-used queue must not construct a client to close it. */
  it('is a no-op on destroy when no client was ever created', async () => {
    const queue = new WardrobeProcessingQueue()

    await queue.onModuleDestroy()

    expect(queueConstructor).not.toHaveBeenCalled()
    expect(queueClose).not.toHaveBeenCalled()
  })

  /** A second destroy must not close an already-released client again. */
  it('releases the client so a repeated destroy closes nothing', async () => {
    const queue = new WardrobeProcessingQueue()
    await queue.enqueue('garment-1')

    await queue.onModuleDestroy()
    await queue.onModuleDestroy()

    expect(queueClose).toHaveBeenCalledTimes(1)
  })

  /**
   * The queue name is looked up by string. Failing loudly at construction is what
   * stops a renamed queue from silently producing jobs nobody consumes.
   */
  it('refuses to construct when the color-extraction queue is not configured', () => {
    queueConfigs.splice(0, queueConfigs.length)

    expect(() => new WardrobeProcessingQueue()).toThrow(
      'color-extraction queue configuration is missing'
    )
  })
})
