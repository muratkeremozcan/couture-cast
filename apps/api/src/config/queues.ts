import { Queue } from 'bullmq'
import type { QueueOptions, JobsOptions } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from './redis'

/** Story 0.4 Task 2/3/4/5 context
 * BullMQ queue config in this service:
 * - What BullMQ is: a Redis-backed job queue and worker system for Node.js.
 * - Problems it solves: moves slow or retryable work out of request handlers, survives restarts,
 *   and gives standard retry/backoff behavior.
 * - Alternatives: RabbitMQ consumers, AWS SQS workers, Kafka consumers, or in-process task runners.
 * - Setup steps:
 *   1) Resolve shared Redis connection settings.
 *   2) Define stable queue names used by producers and workers.
 *   3) Define shared default job retry/backoff/retention options.
 *   4) Create Queue instances from one shared config source.
 */
export type QueueName =
  | 'weather-ingestion'
  | 'alert-fanout'
  | 'color-extraction'
  | 'moderation-review'

export type QueueConfig = {
  name: QueueName
  options: QueueOptions
}

// 1) Resolve shared Redis connection settings.
const redisConfig = getRedisConfig()
const connection = redisOptionsFromConfig(redisConfig)

// 3) Define shared default job retry/backoff/retention options.
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
}

// 2) Define stable queue names used by producers and workers.
export const queueConfigs: QueueConfig[] = [
  {
    name: 'weather-ingestion',
    options: {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        timeout: 30_000,
      } as JobsOptions,
    },
  },
  {
    name: 'alert-fanout',
    options: {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        timeout: 10_000,
      } as JobsOptions,
    },
  },
  {
    name: 'color-extraction',
    options: {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        timeout: 60_000,
      } as JobsOptions,
    },
  },
  {
    name: 'moderation-review',
    options: {
      connection,
      defaultJobOptions: {
        ...defaultJobOptions,
        timeout: 120_000,
      } as JobsOptions,
    },
  },
]

// 4) Create Queue instances from one shared config source.
export function createQueues() {
  return queueConfigs.map(({ name, options }) => new Queue(name, options))
}
