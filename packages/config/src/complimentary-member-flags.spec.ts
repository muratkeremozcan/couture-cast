import { describe, expect, it } from 'vitest'
import {
  COMPLIMENTARY_MEMBER_FLAGS,
  FEATURE_FLAG_KEYS,
  getDefaultFeatureFlagValue,
  isComplimentaryMemberFlag,
} from './flags'

// Story 6.14 TEA, U-FLAG-LIST-EXACT and U-FLAG-DEFAULT (D3, D4). The list is pinned by
// value: purchasing, affiliate revenue and every operator flag must never open for a
// complimentary member, and a test that derives its expectations from the constant
// cannot notice one being added (seeded defect S-9).
describe('complimentary member flags', () => {
  it('U-FLAG-LIST-EXACT: the six D4 flags, in order, and nothing else', () => {
    expect([...COMPLIMENTARY_MEMBER_FLAGS]).toEqual([
      'premium_themes_enabled',
      'color_analysis_enabled',
      'premium_planner_enabled',
      'community_read_enabled',
      'community_write_enabled',
      'share_card_native_share_enabled',
    ])
    for (const key of [
      'commerce_subscription_enabled',
      'commerce_affiliate_enabled',
      'moderation_console_enabled',
      'moderation_decisions_enabled',
      'moderation_sla_monitoring_enabled',
      'moderation_history_enabled',
      'weather_alerts_enabled',
      'complimentary_access_enabled',
    ] as const)
      expect({ key, listed: isComplimentaryMemberFlag(key) }).toEqual({
        key,
        listed: false,
      })
  })

  it('U-FLAG-DEFAULT: the kill switch defaults true, and it and weather alerts are the only true defaults', () => {
    expect(getDefaultFeatureFlagValue('complimentary_access_enabled')).toBe(true)
    expect(
      FEATURE_FLAG_KEYS.filter((key) => getDefaultFeatureFlagValue(key) === true).sort()
    ).toEqual(['complimentary_access_enabled', 'weather_alerts_enabled'])
  })
})
