// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import { describe, expect, it, vi } from 'vitest'
import type { FeatureFlagsService } from './feature-flags.service'

import { FeatureFlagsWarmup } from './feature-flags.warmup'

describe('FeatureFlagsWarmup', () => {
  it('warms the fallback cache on module init', async () => {
    const syncFlags = vi.fn().mockResolvedValue({ synced: 4, fallbackCount: 0 })
    const service = { syncFlags } as unknown as FeatureFlagsService
    const warmup = new FeatureFlagsWarmup(service)

    await warmup.onModuleInit()

    expect(syncFlags).toHaveBeenCalledTimes(1)
  })

  /**
   * There is no schedule behind this method any more. The five-minute refresh
   * runs as the `feature-flags-sync` BullMQ Job Scheduler in the worker
   * runtime, and `workers/maintenance.processor.spec.ts` owns that path. What
   * is left here is an explicit, caller-driven sync, which `onModuleInit` above
   * is the only production caller of.
   */
  it('runs the fallback sync when called explicitly', async () => {
    const syncFlags = vi.fn().mockResolvedValue({ synced: 4, fallbackCount: 0 })
    const service = { syncFlags } as unknown as FeatureFlagsService
    const warmup = new FeatureFlagsWarmup(service)

    await warmup.syncFeatureFlags()

    expect(syncFlags).toHaveBeenCalledTimes(1)
  })
})
