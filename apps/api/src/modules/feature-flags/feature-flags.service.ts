import { Injectable } from '@nestjs/common'
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_SYNC_DISTINCT_ID,
  coerceFeatureFlagValue,
  getDefaultFeatureFlagValue,
  getFeatureFlag as resolveFeatureFlag,
  type FeatureFlagKey,
  type FeatureFlagRecord,
  type FeatureFlagValue,
} from '@couture/config'
import { createBaseLogger } from '../../logger/pino.config'

import { FeatureFlagsRepository } from './feature-flags.repository'
import {
  InjectRemoteFeatureFlagProvider,
  type RemoteFeatureFlagProvider,
} from './remote-feature-flag-provider'

export type FeatureFlagSyncResult = {
  synced: number
  fallbackCount: number
}

/** Story 0.7 Task 8 coordinator file: policy layer for the full feature-flag flow.
 * Why this service exists:
 * - Controllers should not know rollout policy details.
 * - This file is where we make the evaluation order explicit and reusable.
 * Alternatives:
 * - Query PostHog directly inside handlers.
 * - Run sync in the background only and let requests read the database blindly.
 * Flow refs:
 * - S0.7/T8/1-3: request-time reads validate the key, ask PostHog, then fall back safely.
 * - S0.7/T8/2-4: sync reads the remote value, preserves cache semantics, and writes the refreshed fallback record.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = createBaseLogger().child({ feature: 'feature-flags' })

  constructor(
    private readonly repository: FeatureFlagsRepository,
    @InjectRemoteFeatureFlagProvider()
    private readonly remoteProvider: RemoteFeatureFlagProvider
  ) {}

  async getFeatureFlag<K extends FeatureFlagKey>(
    flagKey: K,
    userId: string
  ): Promise<FeatureFlagValue<K>> {
    // Flow ref S0.7/T8/1-3: one call path for all request-time reads: validate
    // key, ask PostHog, then fall back safely if needed.
    return resolveFeatureFlag(flagKey, userId, {
      readRemoteFlag: async (key, subjectId) =>
        this.remoteProvider.getFeatureFlagValue(key, subjectId),
      readFallbackFlag: async (key) => this.repository.findValue(key),
    })
  }

  async syncFlags(): Promise<FeatureFlagSyncResult> {
    // Flow ref S0.7/T8/4: sync the whole canonical flag set so the fallback
    // cache stays aligned with PostHog instead of drifting flag-by-flag.
    const syncedFlags = await Promise.all(
      FEATURE_FLAG_KEYS.map(async (key) => this.resolveFallbackRecord(key))
    )

    await this.repository.upsertMany(syncedFlags.map(({ record }) => record))

    const fallbackCount = syncedFlags.filter(({ usedDefault }) => usedDefault).length
    const result = { synced: syncedFlags.length, fallbackCount }

    this.logger.info(result, 'feature_flags_synced')

    return result
  }

  private async resolveFallbackRecord(
    key: FeatureFlagKey
  ): Promise<{ record: FeatureFlagRecord; usedDefault: boolean }> {
    // Flow ref S0.7/T8/2: ask PostHog with a stable synthetic distinct id. We
    // are not evaluating a user-targeted experience here; we are refreshing the
    // shared fallback cache.
    const remoteValue = await this.remoteProvider.getFeatureFlagValue(
      key,
      FEATURE_FLAG_SYNC_DISTINCT_ID
    )
    const cachedValue = await this.repository.findValue(key)
    const normalizedRemoteValue = coerceFeatureFlagValue(key, remoteValue)
    const normalizedCachedValue =
      cachedValue === null ? undefined : coerceFeatureFlagValue(key, cachedValue)
    // Flow ref S0.7/T8/3: preserve the last known cached value during outages.
    // Only use the code default when the cache is truly empty.
    const value =
      normalizedRemoteValue ?? normalizedCachedValue ?? getDefaultFeatureFlagValue(key)

    return {
      record: { key, value },
      usedDefault:
        normalizedRemoteValue === undefined && normalizedCachedValue === undefined,
    }
  }
}
