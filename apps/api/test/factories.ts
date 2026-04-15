import {
  createGuardianUser,
  createTeenUser,
  type UserFixture,
  type UserVariantOverrides,
} from '@couture/testing'

export { resetCleanupRegistry } from '@couture/testing/cleanup'

type LinkedGuardianRole = {
  guardian_id: string
  status: string
  consent_granted_at: Date | null
}

type LinkedTeenRole = {
  teen_id: string
  status: string
  consent_granted_at: Date | null
}

type LinkedGuardianResponse = {
  guardianId: string
  status: string
  consentGrantedAt: string | null
}

type LinkedTeenResponse = {
  teenId: string
  status: string
  consentGrantedAt: string | null
}

export function createTeenProfileFixture(
  overrides: UserVariantOverrides = {}
): UserFixture {
  return createTeenUser({
    id: 'teen-4',
    email: 'teen4@example.com',
    displayName: 'Taylor Brooks',
    age: 16,
    birthdate: new Date('2009-03-04T00:00:00.000Z'),
    ...overrides,
  })
}

export function createGuardianProfileFixture(
  overrides: UserVariantOverrides = {}
): UserFixture {
  return createGuardianUser({
    id: 'guardian-7',
    email: 'guardian7@example.com',
    displayName: 'Alex Rivera',
    age: 39,
    birthdate: new Date('1987-03-04T00:00:00.000Z'),
    ...overrides,
  })
}

export function buildLinkedGuardianRole(
  guardian: UserFixture,
  consentGrantedAt = new Date('2026-03-04T10:00:00.000Z')
): LinkedGuardianRole {
  return {
    guardian_id: guardian.id,
    status: 'granted',
    consent_granted_at: consentGrantedAt,
  }
}

export function buildLinkedGuardianResponse(
  guardian: UserFixture,
  consentGrantedAt = new Date('2026-03-04T10:00:00.000Z')
): LinkedGuardianResponse {
  return {
    guardianId: guardian.id,
    status: 'granted',
    consentGrantedAt: consentGrantedAt.toISOString(),
  }
}

export function buildPrismaUserProfileFixture(
  user: UserFixture,
  teenRoles: LinkedGuardianRole[] = [],
  guardianRoles: LinkedTeenRole[] = []
) {
  return {
    id: user.id,
    email: user.email,
    profile: {
      display_name: user.displayName,
      birthdate: user.birthdate,
    },
    teen_roles: teenRoles,
    guardian_roles: guardianRoles,
  }
}

export function buildUserProfileResponse(
  user: UserFixture,
  linkedGuardians: LinkedGuardianResponse[] = [],
  linkedTeens: LinkedTeenResponse[] = []
) {
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      birthdate: user.birthdate.toISOString(),
      role: user.role,
    },
    linkedGuardians,
    linkedTeens,
  }
}
