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

  it('returns the PostHog value when it resolves to a boolean', async () => {
    const readPostHogFlag = vi.fn().mockResolvedValue(true)
    const readFallbackFlag = vi.fn()

    await expect(
      getFeatureFlag('premium_themes_enabled', 'user-1', {
        readPostHogFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)

    expect(readPostHogFlag).toHaveBeenCalledWith('premium_themes_enabled', 'user-1')
    expect(readFallbackFlag).not.toHaveBeenCalled()
  })

  it('falls back to the stored toggle when PostHog errors', async () => {
    const readPostHogFlag = vi.fn().mockRejectedValue(new Error('posthog unavailable'))
    const readFallbackFlag = vi.fn().mockResolvedValue(false)

    await expect(
      getFeatureFlag('color_analysis_enabled', 'user-2', {
        readPostHogFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(false)
  })

  it('falls back to the registry default when no adapter resolves a value', async () => {
    const readPostHogFlag = vi.fn().mockResolvedValue(undefined)
    const readFallbackFlag = vi.fn().mockResolvedValue(null)

    await expect(
      getFeatureFlag('weather_alerts_enabled', 'user-3', {
        readPostHogFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)
  })
})
