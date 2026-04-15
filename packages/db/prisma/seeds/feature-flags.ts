import type { PrismaClient } from '@prisma/client'
import * as sharedFlags from '../../../config/src/flags.ts'
import type { FeatureFlagKey, FeatureFlagStoredValue } from '../../../config/src/flags.ts'

import { unwrapCjsNamespace } from './interop.js'

export type SeededFeatureFlag = {
  key: string
  value: FeatureFlagStoredValue
}

export type SeededProfileFeatureFlag = {
  key: string
  enabled: boolean
}

const { FEATURE_FLAG_KEYS, getDefaultFeatureFlagValue } = unwrapCjsNamespace(sharedFlags)

const canonicalFlagOverrides: Record<FeatureFlagKey, FeatureFlagStoredValue> = {
  premium_themes_enabled: true,
  community_feed_enabled: false,
  color_analysis_enabled: getDefaultFeatureFlagValue('color_analysis_enabled'),
  weather_alerts_enabled: getDefaultFeatureFlagValue('weather_alerts_enabled'),
}

const supplementalFeatureFlags: SeededFeatureFlag[] = [
  {
    key: 'guardian_audit_beta',
    value: { enabled: true, audience: ['guardian'], rolloutPercentage: 100 },
  },
  {
    key: 'ritual_share_beta',
    value: { enabled: false, audience: ['teen'], rolloutPercentage: 0 },
  },
  {
    key: 'lookbook_import_beta',
    value: { enabled: true, audience: ['teen', 'guardian'], rolloutPercentage: 25 },
  },
  {
    key: 'widget_quick_swap_beta',
    value: { enabled: false, audience: ['guardian'], rolloutPercentage: 10 },
  },
]

export const SEEDED_FEATURE_FLAGS: SeededFeatureFlag[] = [
  ...FEATURE_FLAG_KEYS.map<SeededFeatureFlag>((key) => ({
    key,
    value: canonicalFlagOverrides[key],
  })),
  ...supplementalFeatureFlags,
]

function resolveProfileFlagEnabled(value: FeatureFlagStoredValue): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if ('enabled' in value) {
      return value.enabled === true
    }
  }

  return false
}

export const SEEDED_PROFILE_FEATURE_FLAGS: SeededProfileFeatureFlag[] =
  SEEDED_FEATURE_FLAGS.map(({ key, value }) => ({
    key,
    enabled: resolveProfileFlagEnabled(value),
  }))

export async function seedFeatureFlags(
  prisma: PrismaClient
): Promise<SeededFeatureFlag[]> {
  await Promise.all(
    SEEDED_FEATURE_FLAGS.map((flag) =>
      prisma.featureFlag.upsert({
        where: { key: flag.key },
        update: { value: flag.value },
        create: { key: flag.key, value: flag.value },
      })
    )
  )

  return SEEDED_FEATURE_FLAGS
}
