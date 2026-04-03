// Step 10 step 3 owner: searchable owner anchor
import { Queue } from 'bullmq'
import type { QueueOptions, JobsOptions } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from './redis'

/** Story 0.4 owner file: BullMQ queue configuration.
 * BullMQ queue config in this service:
 * - What BullMQ is: a Redis-backed job queue and worker system for Node.js.
 * - Problems it solves: moves slow or retryable work out of request handlers, survives restarts,
 *   and gives standard retry/backoff behavior.
 * - Alternatives: RabbitMQ consumers, AWS SQS workers, Kafka consumers, or in-process task runners.
 * Ownership anchor:
 * - Story 0.4 Task 2 owner: define shared BullMQ queue names, retry policy, timeouts, and queue construction.
 *
 * Flow refs:
 * - S0.4/T4: worker bootstrap applies concurrency policy against these stable queue names.
 * - S0.4/T5: the dedicated worker process group starts from this shared queue config.
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

// Flow ref S0.4/T2: resolve shared Redis connection settings once so every
// queue client points at the same backend contract.
const redisConfig = getRedisConfig()
const connection = redisOptionsFromConfig(redisConfig)

// Flow ref S0.4/T2: keep retry/backoff/retention defaults centralized so queue
// producers and workers stay aligned.
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
}

// Flow ref S0.4/T2: stable queue names let producers, workers, and health
// checks talk about the same queues without string drift.
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

// Flow ref S0.4/T2: build Queue instances from one shared config source.
export function createQueues() {
  return queueConfigs.map(({ name, options }) => new Queue(name, options))
}
