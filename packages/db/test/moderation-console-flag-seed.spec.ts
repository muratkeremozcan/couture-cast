// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: the dev seed turns the moderator console on, the registry keeps it off.
// Production never runs the seed, so the registry default is the production value.
import { describe, expect, it } from 'vitest'
import { getDefaultFeatureFlagValue } from '../../config/src/flags.ts'
import { SEEDED_FEATURE_FLAGS } from '../prisma/seeds/feature-flags.js'

describe('6.10-SEED-001 moderation_console_enabled', () => {
  it('is seeded true for local and test environments', () => {
    expect(
      SEEDED_FEATURE_FLAGS.find((flag) => flag.key === 'moderation_console_enabled')
    ).toEqual({
      key: 'moderation_console_enabled',
      value: true,
    })
  })

  it('stays false in the registry, which is what production resolves', () => {
    expect(getDefaultFeatureFlagValue('moderation_console_enabled')).toBe(false)
  })
})

describe('U-D-FLAG: moderation_decisions_enabled', () => {
  it('is seeded true for local and test environments', () => {
    expect(
      SEEDED_FEATURE_FLAGS.find((flag) => flag.key === 'moderation_decisions_enabled')
    ).toEqual({
      key: 'moderation_decisions_enabled',
      value: true,
    })
  })

  it('stays false in the registry, which is what production resolves', () => {
    expect(getDefaultFeatureFlagValue('moderation_decisions_enabled')).toBe(false)
  })
})
