import { describe, expect, it } from 'vitest'
import { PreconditionFailedException } from '@nestjs/common'
import {
  formatOnboardingETag,
  parseOnboardingIfMatchHeader,
} from './wardrobe-onboarding.service.js'

describe('formatOnboardingETag / parseOnboardingIfMatchHeader', () => {
  it('4.4-UNIT-01 formats and round-trips a strong entity tag', () => {
    const tag = formatOnboardingETag('user-1', 3)
    expect(tag).toBe('"onboarding:user-1:3"')
    expect(parseOnboardingIfMatchHeader(tag, 'user-1')).toBe(3)
  })

  it('4.4-UNIT-01 treats "*" as matching any current revision', () => {
    expect(parseOnboardingIfMatchHeader('*', 'user-1')).toBeNull()
  })

  it('4.4-UNIT-01 throws 428 PRECONDITION_REQUIRED when the header is missing or blank', () => {
    expect(() => parseOnboardingIfMatchHeader(undefined, 'user-1')).toThrowError(
      'PRECONDITION_REQUIRED'
    )
    expect(() => parseOnboardingIfMatchHeader('   ', 'user-1')).toThrowError(
      'PRECONDITION_REQUIRED'
    )
  })

  it('4.4-UNIT-01 rejects a weak validator', () => {
    expect(() =>
      parseOnboardingIfMatchHeader('W/"onboarding:user-1:1"', 'user-1')
    ).toThrowError(PreconditionFailedException)
  })

  it('4.4-UNIT-01 rejects an entity tag naming a different user', () => {
    expect(() =>
      parseOnboardingIfMatchHeader('"onboarding:someone-else:1"', 'user-1')
    ).toThrowError(PreconditionFailedException)
  })

  it('4.4-UNIT-01 rejects a malformed tag body', () => {
    expect(() => parseOnboardingIfMatchHeader('"garbage"', 'user-1')).toThrowError(
      PreconditionFailedException
    )
  })

  it('4.4-UNIT-01 accepts the first matching candidate in a comma-separated list', () => {
    expect(
      parseOnboardingIfMatchHeader(
        '"onboarding:someone-else:9", "onboarding:user-1:2"',
        'user-1'
      )
    ).toBe(2)
  })
})
