// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { createHmac } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetCleanupRegistry } from '../../../test/factories.js'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import type { GuardianConsentStateService } from '../../modules/auth/guardian-consent-state.service'
import type { UserSessionService } from '../../modules/auth/user-session.service'
import { GuardianService } from '../../modules/guardian/guardian.service'
import {
  type AnalyticsCapturePayload,
  InMemoryGuardianPrisma,
} from './in-memory-guardian-prisma'

export const createService = (prisma = new InMemoryGuardianPrisma()) => {
  const capture = vi.fn<(payload: AnalyticsCapturePayload) => void>()
  const analyticsClient = { capture } as unknown as AnalyticsClient
  const markTeenAccessGranted = vi.fn()
  const markTeenAccessRevoked = vi.fn()
  const invalidateTeenAccess = vi.fn()
  const guardianConsentStateService = {
    canTeenAccess: vi.fn(),
    markTeenAccessGranted,
    markTeenAccessRevoked,
    invalidateTeenAccess,
  } as unknown as GuardianConsentStateService
  const invalidateUserSessions = vi.fn().mockResolvedValue(undefined)
  const userSessionService = {
    invalidateUserSessions,
  } as unknown as UserSessionService

  return {
    prisma,
    capture,
    invalidateUserSessions,
    markTeenAccessGranted,
    markTeenAccessRevoked,
    service: new GuardianService(
      analyticsClient,
      prisma as unknown as PrismaClient,
      guardianConsentStateService,
      userSessionService
    ),
  }
}

export const INVITATION_REFERENCE_TIME = new Date('2026-04-22T03:00:00.000Z')
export const INVITE_SECRET = 'test-guardian-secret'
export const DEVELOPMENT_INVITATION_SECRET = 'guardian-invite-development-secret'

export const pendingCompliancePreferences = () => ({
  compliance: {
    accountStatus: 'pending_guardian_consent',
    guardianConsentRequired: true,
  },
})

export const activeCompliancePreferences = () => ({
  compliance: {
    accountStatus: 'active',
    guardianConsentRequired: false,
  },
})

export type SeedUserOptions = {
  id: string
  email: string
  preferences?: Record<string, unknown> | null
  birthdate?: Date | null
  withProfile?: boolean
}

export const seedUser = (prisma: InMemoryGuardianPrisma, options: SeedUserOptions) => {
  prisma.users.set(options.id, {
    id: options.id,
    email: options.email,
    profile:
      options.withProfile === false
        ? null
        : {
            user_id: options.id,
            birthdate: options.birthdate ?? null,
            preferences:
              options.preferences === undefined
                ? pendingCompliancePreferences()
                : options.preferences,
          },
  })

  return options.id
}

export type SeedInvitationOptions = {
  id?: string
  teenId: string
  guardianEmail: string
  consentLevel?: 'read_only' | 'full_access'
  expiresAt?: Date
  acceptedAt?: Date | null
}

export const seedInvitation = (
  prisma: InMemoryGuardianPrisma,
  options: SeedInvitationOptions
) => {
  const id = options.id ?? 'invitation-seeded'
  prisma.invitations.set(id, {
    id,
    teen_id: options.teenId,
    guardian_email: options.guardianEmail,
    consent_level: options.consentLevel ?? 'read_only',
    expires_at:
      options.expiresAt ?? new Date(INVITATION_REFERENCE_TIME.getTime() + 60_000),
    accepted_at: options.acceptedAt ?? null,
    accepted_guardian_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  })

  return id
}

/** Signs an arbitrary token body so malformed/forged tokens can be exercised. */
export const signTokenBody = (rawBody: string, secret = INVITE_SECRET) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  )
  const body = Buffer.from(rawBody).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')

  return `${header}.${body}.${signature}`
}

export const signInvitationToken = (
  payload: Record<string, unknown>,
  secret = INVITE_SECRET
) => signTokenBody(JSON.stringify(payload), secret)

export const buildInvitationTokenPayload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'invitation-seeded',
  teenId: 'teen-seeded',
  guardianEmail: 'guardian.seeded@example.com',
  consentLevel: 'read_only',
  type: 'guardian_invitation',
  iat: Math.floor(INVITATION_REFERENCE_TIME.getTime() / 1000),
  exp: Math.floor((INVITATION_REFERENCE_TIME.getTime() + 60_000) / 1000),
  ...overrides,
})

export const seedRevocableConsent = (
  prisma: InMemoryGuardianPrisma,
  teenPreferences?: Record<string, unknown> | null
) => {
  const teenId = seedUser(prisma, {
    id: 'teen-revocable',
    email: 'teen.revocable@example.com',
    preferences:
      teenPreferences === undefined ? activeCompliancePreferences() : teenPreferences,
  })
  const guardianId = seedUser(prisma, {
    id: 'guardian-revocable',
    email: 'guardian.revocable@example.com',
    withProfile: false,
  })
  prisma.consents.set(`${guardianId}:${teenId}`, {
    guardian_id: guardianId,
    teen_id: teenId,
    consent_level: 'read_only',
    consent_granted_at: new Date('2026-04-01T00:00:00.000Z'),
    revoked_at: null,
    ip_address: '198.51.100.7',
    revoked_ip_address: null,
    status: 'granted',
  })

  return { teenId, guardianId }
}

export const buildPrismaKnownRequestError = (
  code: string,
  meta?: Record<string, unknown>
) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
    meta,
  })
export const registerGuardianServiceLifecycle = () => {
  beforeEach(() => {
    process.env.GUARDIAN_INVITE_JWT_SECRET = 'test-guardian-secret'
    process.env.GUARDIAN_INVITE_WEB_BASE_URL = 'https://app.couturecast.test'
  })

  afterEach(() => {
    delete process.env.GUARDIAN_INVITE_JWT_SECRET
    delete process.env.GUARDIAN_INVITE_WEB_BASE_URL
    delete process.env.GUARDIAN_EMANCIPATION_REVOKE_CONSENTS
    vi.unstubAllEnvs()
    vi.useRealTimers()
    resetCleanupRegistry()
  })
}
