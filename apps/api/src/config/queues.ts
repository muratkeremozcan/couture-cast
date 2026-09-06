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
  | 'billing-reconciliation'
  | 'maintenance'
  | 'palette-analysis'
  | 'community-moderation'

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
      defaultJobOptions,
    },
  },
  {
    name: 'alert-fanout',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  {
    name: 'color-extraction',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  {
    name: 'moderation-review',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  // Story 5.2 Decision 4a: payment recovery (forward-outbox re-drive), drift
  // correction, and commerce retention run as Job Schedulers on this queue —
  // the worker runtime is the repo's only substrate where schedules provably
  // fire (the serverless API's @Cron decorators never do).
  {
    name: 'billing-reconciliation',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  // The periodic sweeps that used to be NestJS `@Cron` methods. They sat on
  // `ScheduleModule` inside a Vercel serverless function, which has no
  // long-lived process to hold a timer, so none of them ever provably fired
  // outside a developer's laptop. One queue rather than one per sweep: BullMQ
  // splits jobs across every Worker subscribed to a name, so extra queues buy
  // extra connections and no isolation when the consumer runs serially anyway.
  {
    name: 'maintenance',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  // Story 5.4 Decision 12: palette analysis (selfie and wardrobe undertone/
  // depth derivation) gets its own queue rather than reusing
  // 'moderation-review'. That worker unconditionally parses
  // `silhouettePhotoProcessingJobSchema`, so a palette job on it would throw
  // before reaching any handler.
  {
    name: 'palette-analysis',
    options: {
      connection,
      defaultJobOptions,
    },
  },
  // Story 6.1 Task 4: automated content screening pipeline for community posts
  // (ADR-013). Jobs run server-side NSFW image screening and multilingual text
  // profanity filters before publishing or flagging lookbook posts.
  {
    name: 'community-moderation',
    options: {
      connection,
      defaultJobOptions,
    },
  },
]

// Flow ref S0.4/T2: build Queue instances from one shared config source.
export function createQueues() {
  return queueConfigs.map(({ name, options }) => new Queue(name, options))
}
