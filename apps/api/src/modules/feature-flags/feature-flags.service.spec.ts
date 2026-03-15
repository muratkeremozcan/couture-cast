import { describe, expect, it, vi } from 'vitest'
import { FEATURE_FLAG_KEYS } from '@couture/config'
import type { PostHogService } from '../../posthog/posthog.service'

import { FeatureFlagsService } from './feature-flags.service'
import type { FeatureFlagsRepository } from './feature-flags.repository'

function createService({
  remoteValue,
  fallbackValue,
}: {
  remoteValue?: unknown
  fallbackValue?: unknown
}) {
  const findValue = vi.fn().mockResolvedValue(fallbackValue ?? null)
  const upsertMany = vi.fn().mockResolvedValue(undefined)
  const getFeatureFlagValue = vi.fn().mockResolvedValue(remoteValue)

  const repository = {
    findValue,
    upsertMany,
  } as unknown as FeatureFlagsRepository

  const posthog = {
    getFeatureFlagValue,
  } as unknown as PostHogService

  const service = new FeatureFlagsService(repository, posthog)

  return { service, findValue, upsertMany, getFeatureFlagValue }
}

describe('FeatureFlagsService', () => {
  it('returns the live PostHog value when available', async () => {
    const { service, findValue, getFeatureFlagValue } = createService({
      remoteValue: true,
      fallbackValue: false,
    })

    await expect(
      service.getFeatureFlag('premium_themes_enabled', 'user-1')
    ).resolves.toBe(true)
    expect(getFeatureFlagValue).toHaveBeenCalledWith('premium_themes_enabled', 'user-1')
    expect(findValue).not.toHaveBeenCalled()
  })

  it('falls back to the database toggle when PostHog has no value', async () => {
    const { service, findValue } = createService({
      remoteValue: undefined,
      fallbackValue: false,
    })

    await expect(
      service.getFeatureFlag('color_analysis_enabled', 'user-2')
    ).resolves.toBe(false)
    expect(findValue).toHaveBeenCalledWith('color_analysis_enabled')
  })

  it('ignores remote values that do not match the declared flag type', async () => {
    const { service, findValue } = createService({
      remoteValue: 'variant-a',
      fallbackValue: false,
    })

    await expect(
      service.getFeatureFlag('color_analysis_enabled', 'user-2')
    ).resolves.toBe(false)
    expect(findValue).toHaveBeenCalledWith('color_analysis_enabled')
  })

  it('falls back to registry defaults when neither source resolves', async () => {
    const { service } = createService({
      remoteValue: undefined,
      fallbackValue: null,
    })

    await expect(
      service.getFeatureFlag('weather_alerts_enabled', 'user-3')
    ).resolves.toBe(true)
  })

  it('syncs all known flags into Postgres fallback storage', async () => {
    const remoteValues = new Map<string, unknown>([
      ['premium_themes_enabled', true],
      ['community_feed_enabled', false],
      ['color_analysis_enabled', undefined],
      ['weather_alerts_enabled', true],
    ])

    const cachedValues = new Map<string, boolean | null>([
      ['premium_themes_enabled', null],
      ['community_feed_enabled', null],
      ['color_analysis_enabled', false],
      ['weather_alerts_enabled', null],
    ])

    const findValue = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(cachedValues.get(key) ?? null))
    const upsertMany = vi.fn().mockResolvedValue(undefined)
    const getFeatureFlagValue = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(remoteValues.get(key)))

    const repository = {
      findValue,
      upsertMany,
    } as unknown as FeatureFlagsRepository

    const posthog = {
      getFeatureFlagValue,
    } as unknown as PostHogService

    const service = new FeatureFlagsService(repository, posthog)

    await expect(service.syncFlags()).resolves.toEqual({ synced: 4, fallbackCount: 0 })
    expect(upsertMany).toHaveBeenCalledWith([
      { key: 'premium_themes_enabled', value: true },
      { key: 'community_feed_enabled', value: false },
      { key: 'color_analysis_enabled', value: false },
      { key: 'weather_alerts_enabled', value: true },
    ])
  })

  it('uses registry defaults only when both PostHog and fallback storage are empty', async () => {
    const remoteValues = new Map<string, unknown>(
      FEATURE_FLAG_KEYS.map((key) => [key, undefined] as const)
    )

    const findValue = vi.fn().mockResolvedValue(null)
    const upsertMany = vi.fn().mockResolvedValue(undefined)
    const getFeatureFlagValue = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(remoteValues.get(key)))

    const repository = {
      findValue,
      upsertMany,
    } as unknown as FeatureFlagsRepository

    const posthog = {
      getFeatureFlagValue,
    } as unknown as PostHogService

    const service = new FeatureFlagsService(repository, posthog)

    await expect(service.syncFlags()).resolves.toEqual({ synced: 4, fallbackCount: 4 })
    expect(upsertMany).toHaveBeenCalledWith([
      { key: 'premium_themes_enabled', value: false },
      { key: 'community_feed_enabled', value: false },
      { key: 'color_analysis_enabled', value: true },
      { key: 'weather_alerts_enabled', value: true },
    ])
  })
})
