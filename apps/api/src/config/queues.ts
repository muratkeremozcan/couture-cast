import { Queue } from 'bullmq'
import type { QueueOptions, JobsOptions } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from './redis'

export type QueueName =
  | 'weather-ingestion'
  | 'alert-fanout'
  | 'color-extraction'
  | 'moderation-review'

export type QueueConfig = {
  name: QueueName
  options: QueueOptions
}

const redisConfig = getRedisConfig()
const connection = redisOptionsFromConfig(redisConfig)

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
}

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

export function createQueues() {
  return queueConfigs.map(({ name, options }) => new Queue(name, options))
}
