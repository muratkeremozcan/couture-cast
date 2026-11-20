// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS,
  COMMUNITY_MODERATION_LOCK_DURATION_MS,
  COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
  communityModerationWorkerOptions,
} from '../modules/community/community-moderation.worker'
import {
  HOSTED_WORKER_CONCURRENCY,
  IDLE_DRAIN_DELAY_SECONDS,
  IDLE_LOCK_DURATION_MS,
  IDLE_MAX_STALLED_COUNT,
  IDLE_STALLED_INTERVAL_MS,
  hostedWorkerOptions,
} from './idle-worker-options'

describe('hosted wardrobe worker idle backoff', () => {
  it('takes the community worker backoff values, drainDelay in seconds', () => {
    expect(IDLE_DRAIN_DELAY_SECONDS).toBe(COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS)
    expect(IDLE_LOCK_DURATION_MS).toBe(COMMUNITY_MODERATION_LOCK_DURATION_MS)
    expect(IDLE_STALLED_INTERVAL_MS).toBe(COMMUNITY_MODERATION_STALLED_INTERVAL_MS)
    expect(IDLE_DRAIN_DELAY_SECONDS).toBe(300)
    expect(IDLE_LOCK_DURATION_MS).toBe(30_000)
    expect(IDLE_STALLED_INTERVAL_MS).toBe(120_000)
    expect(IDLE_MAX_STALLED_COUNT).toBe(1)
  })

  it('builds the same BullMQ options as the community consumer for every hosted consumer', () => {
    const hosted = hostedWorkerOptions()
    const community = communityModerationWorkerOptions()
    // Every option, not only the five named below, matches the community consumer's, apart from
    // the worker name only the community consumer sets.
    expect({ ...hosted, name: undefined }).toEqual({ ...community, name: undefined })
    expect(hosted).toMatchObject({
      concurrency: 1,
      drainDelay: 300,
      lockDuration: 30_000,
      stalledInterval: 120_000,
      maxStalledCount: 1,
    })
    for (const key of [
      'concurrency',
      'drainDelay',
      'lockDuration',
      'stalledInterval',
      'maxStalledCount',
    ] as const) {
      expect(hosted[key]).toBe(community[key])
    }
    expect(HOSTED_WORKER_CONCURRENCY).toBe(1)
  })
})
