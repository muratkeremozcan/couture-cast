export const AGE_GATE_MESSAGES = {
  underage: 'You must be 13 or older',
  guardianRequired: 'Guardian consent required',
} as const

/**
 * Whether a 13 to 15 year old needs a guardian's approval before the account works.
 * `off`: every 13+ account is active at creation (owner ruling, 2026-11-16).
 * `required_13_15`: a 13 to 15 year old is `pending_guardian_consent` until a guardian approves.
 *
 * The one value that turns guardian consent back on. Before flipping it, the guardian endpoints
 * need the caller checks the 2026-11-15 teen-path review asked for (B-1 in
 * _bmad-output/test-artifacts/story-6-17/teen-path-findings.md): the API refuses every guardian
 * consent endpoint while this is `off`.
 */
export type GuardianConsentPolicy = 'off' | 'required_13_15'
export const GUARDIAN_CONSENT_POLICY: GuardianConsentPolicy = 'off'

export function guardianConsentRequiredFor(
  age: number,
  policy: GuardianConsentPolicy = GUARDIAN_CONSENT_POLICY
) {
  return policy === 'required_13_15' && age >= 13 && age < 16
}

export const INVALID_BIRTHDATE_MESSAGE = 'Enter your birthdate as YYYY-MM-DD' as const

export type AgeGateAccountStatus =
  | 'blocked_underage'
  | 'active'
  | 'pending_guardian_consent'

export interface AgeGateResult {
  age: number
  allowed: boolean
  requiresGuardian: boolean
  accountStatus: AgeGateAccountStatus
  message: (typeof AGE_GATE_MESSAGES)[keyof typeof AGE_GATE_MESSAGES] | null
}

export type BirthdateAgeGateEvaluation =
  | {
      kind: 'empty'
      gate: null
      message: null
    }
  | {
      kind: 'invalid'
      gate: null
      message: typeof INVALID_BIRTHDATE_MESSAGE
    }
  | {
      kind: 'valid'
      gate: AgeGateResult
      message: AgeGateResult['message']
    }

function parseBirthdateParts(input: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(input)
  if (!match?.groups) {
    throw new Error('Birthdate must use YYYY-MM-DD format')
  }

  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
  }
}

export function parseBirthdateInput(input: string): Date {
  const trimmed = input.trim()
  const { year, month, day } = parseBirthdateParts(trimmed)

  const date = new Date(`${trimmed}T12:00:00.000Z`)
  const isCalendarDate =
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day

  if (!isCalendarDate) {
    throw new Error('Birthdate must be a valid date')
  }

  return date
}

export function calculateAge(birthdate: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - birthdate.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - birthdate.getUTCMonth()

  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birthdate.getUTCDate())) {
    age -= 1
  }

  return age
}

export function evaluateAgeGate(
  birthdate: Date,
  today = new Date(),
  policy: GuardianConsentPolicy = GUARDIAN_CONSENT_POLICY
): AgeGateResult {
  const age = calculateAge(birthdate, today)

  if (age < 13) {
    return {
      age,
      allowed: false,
      requiresGuardian: false,
      accountStatus: 'blocked_underage',
      message: AGE_GATE_MESSAGES.underage,
    }
  }

  if (guardianConsentRequiredFor(age, policy)) {
    return {
      age,
      allowed: true,
      requiresGuardian: true,
      accountStatus: 'pending_guardian_consent',
      message: AGE_GATE_MESSAGES.guardianRequired,
    }
  }

  return {
    age,
    allowed: true,
    requiresGuardian: false,
    accountStatus: 'active',
    message: null,
  }
}

export function evaluateBirthdateInput(
  input: string,
  today = new Date(),
  policy: GuardianConsentPolicy = GUARDIAN_CONSENT_POLICY
): BirthdateAgeGateEvaluation {
  if (!input.trim()) {
    return {
      kind: 'empty',
      gate: null,
      message: null,
    }
  }

  try {
    const gate = evaluateAgeGate(parseBirthdateInput(input), today, policy)
    return {
      kind: 'valid',
      gate,
      message: gate.message,
    }
  } catch {
    return {
      kind: 'invalid',
      gate: null,
      message: INVALID_BIRTHDATE_MESSAGE,
    }
  }
}
