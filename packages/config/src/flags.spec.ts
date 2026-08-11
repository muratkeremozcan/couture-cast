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
      'commerce_affiliate_enabled',
    ])
  })

  it('defaults the commerce kill switch to off', () => {
    // Story 5.1 decision 13: the fallback order is remote answer, then the
    // FeatureFlag cache row, then this default. Defaulting to false is what
    // stops a degraded PostHog from switching commerce on by accident.
    expect(getDefaultFeatureFlagValue('commerce_affiliate_enabled')).toBe(false)
  })

  it('returns registry defaults for known keys', () => {
    expect(getDefaultFeatureFlagValue('premium_themes_enabled')).toBe(false)
    expect(getDefaultFeatureFlagValue('weather_alerts_enabled')).toBe(true)
  })

  it('coerces only values that match the declared flag type', () => {
    expect(coerceFeatureFlagValue('premium_themes_enabled', true)).toBe(true)
    expect(coerceFeatureFlagValue('premium_themes_enabled', 'variant-a')).toBe(undefined)
  })

  it('freezes the exported key list so a caller cannot widen the contract', () => {
    // Every runtime shares this array. If one app could push a key onto it, the
    // "unknown flag" guard below would stop protecting the others.
    expect(Object.isFrozen(FEATURE_FLAG_KEYS)).toBe(true)
  })

  it('declares a usable code default for every registered flag', () => {
    // Story 0.7 Task 8 step 1: a cold start with no PostHog and no warm cache
    // must still resolve every flag, so each key needs a default of its kind.
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof getDefaultFeatureFlagValue(key)).toBe('boolean')
    }
  })

  it('rejects values that do not match the declared boolean kind', () => {
    // A PostHog string variant or a stale cache row must not be smuggled in as
    // a boolean; truthiness coercion here would silently flip a rollout.
    const rejected: unknown[] = [0, 1, 'true', 'false', null, undefined, {}, []]

    for (const value of rejected) {
      expect(coerceFeatureFlagValue('weather_alerts_enabled', value)).toBe(undefined)
    }
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

  it('rejects an unknown key before it touches any adapter', async () => {
    // A typo must fail loudly at the call site instead of quietly resolving to
    // "flag disabled", which would look like an intentional rollout state.
    const readRemoteFlag = vi.fn()
    const readFallbackFlag = vi.fn()

    await expect(
      getFeatureFlag('premium_themes', 'user-4', { readRemoteFlag, readFallbackFlag })
    ).rejects.toThrow('Unknown feature flag: premium_themes')

    expect(readRemoteFlag).not.toHaveBeenCalled()
    expect(readFallbackFlag).not.toHaveBeenCalled()
  })

  it('resolves to the code default when no adapters are wired at all', async () => {
    // Local, unit-test and pre-PostHog runtimes call this with no adapters. The
    // ritual still has to render, so the code default is the only answer.
    await expect(getFeatureFlag('color_analysis_enabled', 'user-5')).resolves.toBe(true)
    await expect(getFeatureFlag('community_feed_enabled', 'user-5')).resolves.toBe(false)
  })

  it('prefers the remote answer over a disagreeing cached value', async () => {
    // Flow ref S0.7/T8/2 vs S0.7/T8/3: the cache holds the last known rollout,
    // so a live remote answer has to win even when the two conflict.
    const readRemoteFlag = vi.fn().mockResolvedValue(true)
    const readFallbackFlag = vi.fn().mockResolvedValue(false)

    await expect(
      getFeatureFlag('community_feed_enabled', 'user-6', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)

    expect(readFallbackFlag).not.toHaveBeenCalled()
  })

  it('uses the cached value when only the fallback adapter is wired', async () => {
    // The API sync path (S0.7/T8/4) keeps this cache warm precisely so a
    // runtime without a PostHog client still sees the last known rollout.
    const readFallbackFlag = vi.fn().mockResolvedValue(true)

    await expect(
      getFeatureFlag('premium_themes_enabled', 'user-7', { readFallbackFlag })
    ).resolves.toBe(true)

    expect(readFallbackFlag).toHaveBeenCalledWith('premium_themes_enabled')
  })

  it('returns the code default when the remote answer is unusable and no cache is wired', async () => {
    // Partially wired adapters: PostHog answered with a string variant for a
    // boolean flag and there is no cache to fall through to.
    const readRemoteFlag = vi.fn().mockResolvedValue('variant-a')

    await expect(
      getFeatureFlag('color_analysis_enabled', 'user-8', { readRemoteFlag })
    ).resolves.toBe(true)
  })

  it('ignores a cached value that no longer matches the declared flag kind', async () => {
    // A row written before the flag changed kind must not leak a string where
    // every caller expects a boolean.
    const readRemoteFlag = vi.fn().mockResolvedValue(undefined)
    const readFallbackFlag = vi.fn().mockResolvedValue('yes')

    await expect(
      getFeatureFlag('weather_alerts_enabled', 'user-9', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)
  })

  it('degrades to the cache when the remote adapter throws before returning a promise', async () => {
    // A misconfigured PostHog client throws synchronously rather than
    // rejecting; the guard has to catch both shapes of failure.
    const readRemoteFlag = vi.fn(() => {
      throw new Error('posthog client not initialised')
    })
    const readFallbackFlag = vi.fn().mockResolvedValue(true)

    await expect(
      getFeatureFlag('premium_themes_enabled', 'user-10', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)
  })

  it('degrades to the code default when the cache read fails', async () => {
    // The cache is the second line of defence, not a hard dependency. This read
    // used to sit outside the guard, so a database blip rejected out of
    // getFeatureFlag and took the code default down with it — every caller
    // would have had to reimplement the fallback the module exists to provide.
    const readFallbackFlag = vi.fn().mockRejectedValue(new Error('cache table missing'))

    await expect(
      getFeatureFlag('weather_alerts_enabled', 'user-11', { readFallbackFlag })
    ).resolves.toBe(true)
  })

  it('degrades to the code default when both the remote and the cache fail', async () => {
    // The outage case that matters in production: provider down, cache down,
    // and the core ritual still has to answer.
    const readRemoteFlag = vi.fn().mockRejectedValue(new Error('posthog down'))
    const readFallbackFlag = vi.fn().mockRejectedValue(new Error('cache down'))

    await expect(
      getFeatureFlag('color_analysis_enabled', 'user-12', {
        readRemoteFlag,
        readFallbackFlag,
      })
    ).resolves.toBe(true)
    expect(readFallbackFlag).toHaveBeenCalledWith('color_analysis_enabled')
  })
})
