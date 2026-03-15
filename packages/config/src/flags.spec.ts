import { describe, expect, it, vi } from 'vitest'

import {
  FEATURE_FLAG_KEYS,
  coerceFeatureFlagValue,
  getDefaultFeatureFlagValue,
  getFeatureFlag,
} from './flags.js'

describe('feature flag registry', () => {
  it('exposes the story 0.7 task 8 flag set', () => {
    expect(FEATURE_FLAG_KEYS).toEqual([
      'premium_themes_enabled',
      'community_feed_enabled',
      'color_analysis_enabled',
      'weather_alerts_enabled',
    ])
  })

  it('returns registry defaults for known keys', () => {
    expect(getDefaultFeatureFlagValue('premium_themes_enabled')).toBe(false)
    expect(getDefaultFeatureFlagValue('weather_alerts_enabled')).toBe(true)
  })

  it('coerces only values that match the declared flag type', () => {
    expect(coerceFeatureFlagValue('premium_themes_enabled', true)).toBe(true)
    expect(coerceFeatureFlagValue('premium_themes_enabled', 'variant-a')).toBe(undefined)
  })
})

describe('getFeatureFlag', () => {
  it('rejects unknown flag keys through the public API', async () => {
    await expect(getFeatureFlag('unknown_flag', 'user-0')).rejects.toThrow(
      'Unknown feature flag: unknown_flag'
    )
  })

  it('returns the remote provider value when it resolves to a boolean', async () => {
    const readRemoteFlag = vi.fn().mockResolvedValue(true)
    const readFallbackFlag = vi.fn()

    await expect(
      getFeatureFlag('premium_themes_enabled', 'user-1', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)

    expect(readRemoteFlag).toHaveBeenCalledWith('premium_themes_enabled', 'user-1')
    expect(readFallbackFlag).not.toHaveBeenCalled()
  })

  it('falls back to the stored toggle when the remote provider errors', async () => {
    const readRemoteFlag = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const readFallbackFlag = vi.fn().mockResolvedValue(false)

    await expect(
      getFeatureFlag('color_analysis_enabled', 'user-2', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(false)
  })

  it('falls back to the registry default when no adapter resolves a value', async () => {
    const readRemoteFlag = vi.fn().mockResolvedValue(undefined)
    const readFallbackFlag = vi.fn().mockResolvedValue(null)

    await expect(
      getFeatureFlag('weather_alerts_enabled', 'user-3', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)
  })
})
