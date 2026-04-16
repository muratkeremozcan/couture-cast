export const AGE_GATE_MESSAGES = {
  underage: 'You must be 13 or older',
  guardianRequired: 'Guardian consent required',
} as const

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

export function parseBirthdateInput(input: string): Date {
  const trimmed = input.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Birthdate must use YYYY-MM-DD format')
  }

  const date = new Date(`${trimmed}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
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
