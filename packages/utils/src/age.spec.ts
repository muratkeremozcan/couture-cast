import { describe, expect, it } from 'vitest'
import {
  AGE_GATE_MESSAGES,
  calculateAge,
  evaluateBirthdateInput,
  evaluateAgeGate,
  GUARDIAN_CONSENT_POLICY,
  guardianConsentRequiredFor,
  INVALID_BIRTHDATE_MESSAGE,
  parseBirthdateInput,
} from './age'

describe('age utilities', () => {
  it('parses HTML date inputs without shifting the calendar date', () => {
    const parsed = parseBirthdateInput('2012-04-03')

    expect(parsed.toISOString()).toBe('2012-04-03T12:00:00.000Z')
  })

  it('rejects impossible calendar dates instead of normalizing them', () => {
    expect(() => parseBirthdateInput('2021-02-30')).toThrow(
      'Birthdate must be a valid date'
    )
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

  it('the shipped policy is off: guardian consent is not required (owner ruling 2026-11-16)', () => {
    expect(GUARDIAN_CONSENT_POLICY).toBe('off')
  })

  it.each([13, 14, 15])('under policy off a %i-year-old is active at once', (age) => {
    const today = new Date('2026-04-16T12:00:00.000Z')
    const birthdate = new Date(`${2026 - age}-04-15T12:00:00.000Z`)
    expect(evaluateAgeGate(birthdate, today)).toEqual({
      age,
      allowed: true,
      requiresGuardian: false,
      accountStatus: 'active',
      message: null,
    })
    expect(evaluateBirthdateInput(`${2026 - age}-04-15`, today)).toMatchObject({
      kind: 'valid',
      message: null,
    })
  })

  it('under policy required_13_15 a 13 to 15 year old needs guardian consent', () => {
    expect(
      evaluateAgeGate(
        new Date('2011-04-15T12:00:00.000Z'),
        new Date('2026-04-16T12:00:00.000Z'),
        'required_13_15'
      )
    ).toEqual({
      age: 15,
      allowed: true,
      requiresGuardian: true,
      accountStatus: 'pending_guardian_consent',
      message: AGE_GATE_MESSAGES.guardianRequired,
    })
    expect(
      evaluateBirthdateInput(
        '2011-04-15',
        new Date('2026-04-16T12:00:00.000Z'),
        'required_13_15'
      ).message
    ).toBe(AGE_GATE_MESSAGES.guardianRequired)
  })

  it.each([
    ['off', 12, false],
    ['off', 13, false],
    ['off', 15, false],
    ['off', 16, false],
    ['required_13_15', 12, false],
    ['required_13_15', 13, true],
    ['required_13_15', 15, true],
    ['required_13_15', 16, false],
  ] as const)('guardianConsentRequiredFor(%i) under %s', (policy, age, required) => {
    expect(guardianConsentRequiredFor(age, policy)).toBe(required)
  })

  // TEA sign-off F-5: 12 is the last refused age, the day before the 13th birthday included.
  it.each([
    ['off', '2014-04-17T12:00:00.000Z', 11],
    ['required_13_15', '2014-04-17T12:00:00.000Z', 11],
    ['off', '2013-04-17T12:00:00.000Z', 12],
    ['required_13_15', '2013-04-17T12:00:00.000Z', 12],
  ] as const)(
    'under %s a child born %s (age %i) is refused',
    (policy, birthdate, age) => {
      expect(
        evaluateAgeGate(new Date(birthdate), new Date('2026-04-16T12:00:00.000Z'), policy)
      ).toEqual({
        age,
        allowed: false,
        requiresGuardian: false,
        accountStatus: 'blocked_underage',
        message: AGE_GATE_MESSAGES.underage,
      })
    }
  )

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

  it('returns a shared invalid message for malformed birthdates', () => {
    expect(evaluateBirthdateInput('2026-02-31')).toEqual({
      kind: 'invalid',
      gate: null,
      message: INVALID_BIRTHDATE_MESSAGE,
    })
  })

  it('rejects birthdates that are not in YYYY-MM-DD form', () => {
    // Native date pickers, autofill and paste all bypass the HTML input mask,
    // so the parser has to reject free-form dates on its own.
    expect(() => parseBirthdateInput('04/03/2012')).toThrow(
      'Birthdate must use YYYY-MM-DD format'
    )
    expect(() => parseBirthdateInput('2012-4-3')).toThrow(
      'Birthdate must use YYYY-MM-DD format'
    )
  })

  it('treats blank input as unanswered rather than invalid', () => {
    // The age gate must not paint a validation error before the user has typed.
    const empty = { kind: 'empty', gate: null, message: null }

    expect(evaluateBirthdateInput('')).toEqual(empty)
    expect(evaluateBirthdateInput('   ')).toEqual(empty)
  })

  it('waits for the birthday itself before ageing a user up', () => {
    // The 13 and 16 thresholds are consent boundaries, so the day-of edge has
    // to land exactly on the birthday and not a day early.
    const birthdate = new Date('2010-04-16T12:00:00.000Z')

    expect(calculateAge(birthdate, new Date('2026-04-15T12:00:00.000Z'))).toBe(15)
    expect(calculateAge(birthdate, new Date('2026-04-16T12:00:00.000Z'))).toBe(16)
  })
})
