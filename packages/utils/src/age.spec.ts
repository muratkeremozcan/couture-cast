import { describe, expect, it } from 'vitest'
import {
  AGE_GATE_MESSAGES,
  calculateAge,
  evaluateAgeGate,
  parseBirthdateInput,
} from './age'

describe('age utilities', () => {
  it('parses HTML date inputs without shifting the calendar date', () => {
    const parsed = parseBirthdateInput('2012-04-03')

    expect(parsed.toISOString()).toBe('2012-04-03T12:00:00.000Z')
  })

  it('calculates age using the current year minus birth year when birthday passed', () => {
    expect(
      calculateAge(
        new Date('2010-03-01T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z')
      )
    ).toBe(16)
  })

  it('subtracts one when the birthday has not occurred yet this year', () => {
    expect(
      calculateAge(
        new Date('2010-09-01T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z')
      )
    ).toBe(15)
  })

  it('blocks signups for users younger than thirteen', () => {
    expect(
      evaluateAgeGate(
        new Date('2014-05-01T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z')
      )
    ).toEqual({
      age: 11,
      allowed: false,
      requiresGuardian: false,
      accountStatus: 'blocked_underage',
      message: AGE_GATE_MESSAGES.underage,
    })
  })

  it('requires guardian consent for users aged thirteen through fifteen', () => {
    expect(
      evaluateAgeGate(
        new Date('2011-04-15T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z')
      )
    ).toEqual({
      age: 15,
      allowed: true,
      requiresGuardian: true,
      accountStatus: 'pending_guardian_consent',
      message: AGE_GATE_MESSAGES.guardianRequired,
    })
  })

  it('allows users aged sixteen and older without guardian consent', () => {
    expect(
      evaluateAgeGate(
        new Date('2010-04-15T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z')
      )
    ).toEqual({
      age: 16,
      allowed: true,
      requiresGuardian: false,
      accountStatus: 'active',
      message: null,
    })
  })
})
