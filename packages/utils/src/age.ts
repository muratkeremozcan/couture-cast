export const AGE_GATE_MESSAGES = {
  underage: 'You must be 13 or older',
  guardianRequired: 'Guardian consent required',
} as const

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

export function evaluateAgeGate(birthdate: Date, today = new Date()): AgeGateResult {
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

  if (age < 16) {
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
  today = new Date()
): BirthdateAgeGateEvaluation {
  if (!input.trim()) {
    return {
      kind: 'empty',
      gate: null,
      message: null,
    }
  }

  try {
    const gate = evaluateAgeGate(parseBirthdateInput(input), today)
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
