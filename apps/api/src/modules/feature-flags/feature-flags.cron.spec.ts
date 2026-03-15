import { describe, expect, it, vi } from 'vitest'
import type { FeatureFlagsService } from './feature-flags.service'

import { FeatureFlagsCron } from './feature-flags.cron'

describe('FeatureFlagsCron', () => {
  it('warms the fallback cache on module init', async () => {
    const syncFlags = vi.fn().mockResolvedValue({ synced: 4, fallbackCount: 0 })
    const service = { syncFlags } as unknown as FeatureFlagsService
    const cron = new FeatureFlagsCron(service)

    await cron.onModuleInit()

    expect(syncFlags).toHaveBeenCalledTimes(1)
  })

  it('runs the fallback sync on the five-minute schedule hook', async () => {
    const syncFlags = vi.fn().mockResolvedValue({ synced: 4, fallbackCount: 0 })
    const service = { syncFlags } as unknown as FeatureFlagsService
    const cron = new FeatureFlagsCron(service)

    await cron.syncFeatureFlags()

    expect(syncFlags).toHaveBeenCalledTimes(1)
  })
})
