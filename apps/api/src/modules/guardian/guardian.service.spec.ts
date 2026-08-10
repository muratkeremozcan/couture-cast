import { createHmac } from 'node:crypto'
import { ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import type { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import type { UserSessionService } from '../auth/user-session.service'
import { buildGuardianInvitationEmailTemplate, GuardianService } from './guardian.service'

type StoredUser = {
  id: string
  email: string
  profile: {
    user_id: string
    preferences: Record<string, unknown> | null
    birthdate?: Date | null
  } | null
}

type StoredInvitation = {
  id: string
  teen_id: string
  guardian_email: string
  consent_level: 'read_only' | 'full_access'
  expires_at: Date
  accepted_at: Date | null
  accepted_guardian_id: string | null
  created_at: Date
  updated_at: Date
}

type StoredConsent = {
  id?: string
  guardian_id: string
  teen_id: string
  consent_level: 'read_only' | 'full_access'
  consent_granted_at: Date
  revoked_at: Date | null
  ip_address: string | null
  revoked_ip_address: string | null
  status: 'granted' | 'revoked'
}

type StoredAuditLog = {
  user_id: string
  event_type: string
  event_data: Record<string, unknown> | null
  timestamp: Date
  ip_address: string | null
}

type GuardianInvitationEmailEventPayload = {
  to: string
  template: {
    templateId: string
    subject: string
    text: string
    html: string
  }
}

type AnalyticsCapturePayload = {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

class InMemoryGuardianPrisma {
  users = new Map<string, StoredUser>()
  invitations = new Map<string, StoredInvitation>()
  consents = new Map<string, StoredConsent>()
  auditLogs: StoredAuditLog[] = []
  eventEnvelopes: { channel: string; user_id?: string | null; payload: unknown }[] = []

  private buildTeenRoles(teenId: string, includeGuardian = false) {
    return [...this.consents.values()]
      .filter(
        (candidate) =>
          candidate.teen_id === teenId &&
          candidate.status === 'granted' &&
          candidate.revoked_at === null
      )
      .map((consent) => {
        if (!includeGuardian) {
          return { ...consent }
        }

        return {
          ...consent,
          guardian: this.users.get(consent.guardian_id) ?? null,
        }
      })
  }

  private hydrateUser(
    user: StoredUser,
    include?: {
      profile?: boolean
      teen_roles?: {
        include?: {
          guardian?: boolean
        }
      }
    }
  ) {
    const nextUser: Record<string, unknown> = {
      ...user,
      profile: user.profile ? { ...user.profile } : null,
    }

    if (include?.teen_roles) {
      nextUser.teen_roles = this.buildTeenRoles(
        user.id,
        include.teen_roles.include?.guardian === true
      )
    }

    return nextUser
  }

  user = {
    findUnique: vi.fn(
      ({
        where,
        include,
      }: {
        where: { id?: string; email?: string }
        include?: {
          profile?: boolean
          teen_roles?: {
            include?: {
              guardian?: boolean
            }
          }
        }
      }) => {
        if (where.id) {
          const user = this.users.get(where.id)
          return Promise.resolve(user ? this.hydrateUser(user, include) : null)
        }

        if (where.email) {
          const user = [...this.users.values()].find(
            (candidate) => candidate.email.toLowerCase() === where.email?.toLowerCase()
          )
          return Promise.resolve(user ? this.hydrateUser(user, include) : null)
        }

        return Promise.resolve(null)
      }
    ),
    findMany: vi.fn(
      ({
        where,
        include,
      }: {
        where?: {
          profile?: {
            is?: {
              birthdate?: {
                not?: null
                lte?: Date
              }
            }
          }
        }
        include?: {
          profile?: boolean
          teen_roles?: {
            include?: {
              guardian?: boolean
            }
          }
        }
      }) => {
        const birthdateLte = where?.profile?.is?.birthdate?.lte
        const users = [...this.users.values()].filter((user) => {
          if (!(birthdateLte instanceof Date)) {
            return true
          }

          const birthdate = user.profile?.birthdate
          return (
            birthdate instanceof Date && birthdate.getTime() <= birthdateLte.getTime()
          )
        })

        return Promise.resolve(users.map((user) => this.hydrateUser(user, include)))
      }
    ),
    create: vi.fn(({ data }: { data: { email: string } }) => {
      const id = `guardian-created-${this.users.size + 1}`
      const user: StoredUser = {
        id,
        email: data.email,
        profile: null,
      }
      this.users.set(id, user)
      return Promise.resolve(user)
    }),
  }

  guardianInvitation = {
    create: vi.fn(
      ({
        data,
      }: {
        data: {
          teen_id: string
          guardian_email: string
          consent_level: 'read_only' | 'full_access'
          expires_at: Date
        }
      }) => {
        const id = `invitation-${this.invitations.size + 1}`
        const record: StoredInvitation = {
          id,
          teen_id: data.teen_id,
          guardian_email: data.guardian_email,
          consent_level: data.consent_level,
          expires_at: data.expires_at,
          accepted_at: null,
          accepted_guardian_id: null,
          created_at: new Date(),
          updated_at: new Date(),
        }
        this.invitations.set(id, record)
        return Promise.resolve(record)
      }
    ),
    findUnique: vi.fn(({ where }: { where: { id: string } }) => {
      const invitation = this.invitations.get(where.id)
      if (!invitation) {
        return Promise.resolve(null)
      }

      const teen = this.users.get(invitation.teen_id)
      if (!teen) {
        return Promise.resolve(null)
      }

      return Promise.resolve({
        ...invitation,
        teen,
      })
    }),
    update: vi.fn(
      ({
        where,
        data,
      }: {
        where: { id: string }
        data: { accepted_at: Date; accepted_guardian_id: string }
      }) => {
        const existing = this.invitations.get(where.id)
        if (!existing) {
          throw new Error('Invitation not found')
        }

        const updated = {
          ...existing,
          accepted_at: data.accepted_at,
          accepted_guardian_id: data.accepted_guardian_id,
          updated_at: new Date(),
        }
        this.invitations.set(where.id, updated)
        return Promise.resolve(updated)
      }
    ),
  }

  guardianConsent = {
    findFirst: vi.fn(
      ({
        where,
      }: {
        where: {
          guardian_id: string
          teen_id: string
          status: 'granted'
          revoked_at: null
        }
      }) => {
        const consent = [...this.consents.values()].find(
          (candidate) =>
            candidate.guardian_id === where.guardian_id &&
            candidate.teen_id === where.teen_id &&
            candidate.status === where.status &&
            candidate.revoked_at === where.revoked_at
        )

        if (!consent) {
          return Promise.resolve(null)
        }

        const teen = this.users.get(consent.teen_id)
        const guardian = this.users.get(consent.guardian_id)
        if (!teen || !guardian) {
          return Promise.resolve(null)
        }

        return Promise.resolve({
          ...consent,
          teen,
          guardian,
        })
      }
    ),
    upsert: vi.fn(
      ({
        where,
        update,
        create,
      }: {
        where: { guardian_id_teen_id: { guardian_id: string; teen_id: string } }
        update: StoredConsent
        create: StoredConsent
      }) => {
        const key = `${where.guardian_id_teen_id.guardian_id}:${where.guardian_id_teen_id.teen_id}`
        const next = this.consents.has(key) ? update : create
        this.consents.set(key, next)
        return Promise.resolve(next)
      }
    ),
    update: vi.fn(
      ({
        where,
        data,
      }: {
        where: { guardian_id_teen_id: { guardian_id: string; teen_id: string } }
        data: {
          revoked_at: Date
          status: 'revoked'
          revoked_ip_address: string | null
        }
      }) => {
        const key = `${where.guardian_id_teen_id.guardian_id}:${where.guardian_id_teen_id.teen_id}`
        const existing = this.consents.get(key)
        if (!existing) {
          throw new Error('Consent not found')
        }

        const updated = {
          ...existing,
          revoked_at: data.revoked_at,
          status: data.status,
          revoked_ip_address: data.revoked_ip_address,
        }
        this.consents.set(key, updated)
        return Promise.resolve(updated)
      }
    ),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: {
          teen_id: string
          status: 'granted'
          revoked_at: null
        }
        data: {
          revoked_at: Date
          revoked_ip_address: string | null
          status: 'revoked'
        }
      }) => {
        let count = 0
        for (const [key, consent] of this.consents.entries()) {
          if (
            consent.teen_id === where.teen_id &&
            consent.status === where.status &&
            consent.revoked_at === where.revoked_at
          ) {
            this.consents.set(key, {
              ...consent,
              revoked_at: data.revoked_at,
              revoked_ip_address: data.revoked_ip_address,
              status: data.status,
            })
            count += 1
          }
        }

        return Promise.resolve({ count })
      }
    ),
    count: vi.fn(
      ({
        where,
      }: {
        where: {
          teen_id: string
          status: 'granted'
          revoked_at: null
        }
      }) =>
        Promise.resolve(
          [...this.consents.values()].filter(
            (candidate) =>
              candidate.teen_id === where.teen_id &&
              candidate.status === where.status &&
              candidate.revoked_at === where.revoked_at
          ).length
        )
    ),
  }

  userProfile = {
    update: vi.fn(
      ({
        where,
        data,
      }: {
        where: { user_id: string }
        data: { preferences: Record<string, unknown> }
      }) => {
        const user = this.users.get(where.user_id)
        if (!user || !user.profile) {
          throw new Error('User profile not found')
        }

        user.profile = {
          ...user.profile,
          preferences: data.preferences,
        }
        this.users.set(user.id, user)
        return Promise.resolve(user.profile)
      }
    ),
  }

  eventEnvelope = {
    create: vi.fn(
      ({ data }: { data: { channel: string; user_id?: string; payload: unknown } }) => {
        this.eventEnvelopes.push(data)
        return Promise.resolve(data)
      }
    ),
    createMany: vi.fn(
      ({ data }: { data: { channel: string; user_id?: string; payload: unknown }[] }) => {
        this.eventEnvelopes.push(...data)
        return Promise.resolve({ count: data.length })
      }
    ),
  }

  auditLog = {
    create: vi.fn(
      ({
        data,
      }: {
        data: {
          user_id: string
          event_type: string
          event_data: Record<string, unknown> | null
          timestamp: Date
          ip_address: string | null
        }
      }) => {
        this.auditLogs.push(data)
        return Promise.resolve(data)
      }
    ),
  }

  garmentItem = {
    updateMany: vi
      .fn<
        (args: {
          where: { user_id: string; retention_status: 'active' }
          data: {
            retention_status: 'deletion_pending'
            retention_trigger: 'guardian_consent_revoked'
            deletion_requested_at: Date
          }
        }) => Promise<{ count: number }>
      >()
      .mockResolvedValue({ count: 0 }),
  }

  $transaction = vi.fn(
    async <T>(
      callback: (tx: InMemoryGuardianPrisma) => Promise<T>,
      options?: unknown
    ) => {
      void options
      return callback(this)
    }
  )
}

const createService = (prisma = new InMemoryGuardianPrisma()) => {
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

const INVITE_SECRET = 'test-guardian-secret'
const DEVELOPMENT_INVITATION_SECRET = 'guardian-invite-development-secret'

const pendingCompliancePreferences = () => ({
  compliance: {
    accountStatus: 'pending_guardian_consent',
    guardianConsentRequired: true,
  },
})

const activeCompliancePreferences = () => ({
  compliance: {
    accountStatus: 'active',
    guardianConsentRequired: false,
  },
})

type SeedUserOptions = {
  id: string
  email: string
  preferences?: Record<string, unknown> | null
  birthdate?: Date | null
  withProfile?: boolean
}

const seedUser = (prisma: InMemoryGuardianPrisma, options: SeedUserOptions) => {
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

type SeedInvitationOptions = {
  id?: string
  teenId: string
  guardianEmail: string
  consentLevel?: 'read_only' | 'full_access'
  expiresAt?: Date
  acceptedAt?: Date | null
}

const seedInvitation = (
  prisma: InMemoryGuardianPrisma,
  options: SeedInvitationOptions
) => {
  const id = options.id ?? 'invitation-seeded'
  prisma.invitations.set(id, {
    id,
    teen_id: options.teenId,
    guardian_email: options.guardianEmail,
    consent_level: options.consentLevel ?? 'read_only',
    expires_at: options.expiresAt ?? new Date(Date.now() + 60_000),
    accepted_at: options.acceptedAt ?? null,
    accepted_guardian_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  })

  return id
}

/** Signs an arbitrary token body so malformed/forged tokens can be exercised. */
const signTokenBody = (rawBody: string, secret = INVITE_SECRET) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url'
  )
  const body = Buffer.from(rawBody).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')

  return `${header}.${body}.${signature}`
}

const signInvitationToken = (payload: Record<string, unknown>, secret = INVITE_SECRET) =>
  signTokenBody(JSON.stringify(payload), secret)

const buildInvitationTokenPayload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'invitation-seeded',
  teenId: 'teen-seeded',
  guardianEmail: 'guardian.seeded@example.com',
  consentLevel: 'read_only',
  type: 'guardian_invitation',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor((Date.now() + 60_000) / 1000),
  ...overrides,
})

const seedRevocableConsent = (
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

const buildPrismaKnownRequestError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
    meta,
  })

describe('GuardianService', () => {
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

  it('creates guardian invitations for teens awaiting consent and queues an email event', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-pending',
      email: 'teen.pending@example.com',
      age: 14,
    })
    const { prisma, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const result = await service.inviteGuardian(
      teen.id,
      'Guardian.Pending@Example.com',
      'full_access'
    )

    expect(result.teenId).toBe(teen.id)
    expect(result.guardianEmail).toBe('guardian.pending@example.com')
    expect(result.consentLevel).toBe('full_access')
    expect(result.invitationLink).toContain('/guardian/accept?token=')
    expect(prisma.invitations.size).toBe(1)
    expect(prisma.eventEnvelopes).toHaveLength(1)
    expect(prisma.eventEnvelopes[0]?.channel).toBe('email.guardian-invitation')
    const invitationEmailPayload = prisma.eventEnvelopes[0]
      ?.payload as GuardianInvitationEmailEventPayload
    expect(invitationEmailPayload.to).toBe('guardian.pending@example.com')
    expect(invitationEmailPayload.template.templateId).toBe('guardian-consent-invitation')
    expect(invitationEmailPayload.template.subject).toBe(
      'CoutureCast guardian consent invitation'
    )
    expect(invitationEmailPayload.template.text).toContain(result.invitationLink)
    expect(invitationEmailPayload.template.html).toContain(result.invitationLink)
  })

  it('rejects guardian invitations for teens that are not awaiting guardian consent', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-active',
      email: 'teen.active@example.com',
      age: 16,
    })
    const { prisma, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })

    await expect(
      service.inviteGuardian(teen.id, 'guardian@example.com', 'read_only')
    ).rejects.toThrow(/awaiting consent/)
  })

  it('accepts invitations, links or creates the guardian account, and records consent', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-consent',
      email: 'teen.consent@example.com',
      age: 14,
    })
    const { prisma, capture, markTeenAccessGranted, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const invite = await service.inviteGuardian(
      teen.id,
      'guardian.accept@example.com',
      'full_access'
    )
    const token = new URL(invite.invitationLink).searchParams.get('token')
    if (!token) {
      throw new Error('Expected invite link to contain a token')
    }

    const accepted = await service.acceptInvitation(token, '203.0.113.44')

    expect(accepted.teenId).toBe(teen.id)
    expect(accepted.teenEmail).toBe(teen.email)
    expect(accepted.guardianEmail).toBe('guardian.accept@example.com')
    expect(accepted.consentLevel).toBe('full_access')

    const consent = [...prisma.consents.values()][0]
    expect(consent).toMatchObject({
      teen_id: teen.id,
      consent_level: 'full_access',
      ip_address: '203.0.113.44',
      revoked_ip_address: null,
      status: 'granted',
    })

    const updatedTeen = prisma.users.get(teen.id)
    const compliance = updatedTeen?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance?.accountStatus).toBe('active')
    expect(compliance?.guardianConsentRequired).toBe(false)

    const invitation = [...prisma.invitations.values()][0]
    expect(invitation?.accepted_at).toBeInstanceOf(Date)
    expect(invitation?.accepted_guardian_id).toBeTruthy()
    expect(prisma.auditLogs).toHaveLength(1)
    expect(prisma.auditLogs[0]).toMatchObject({
      user_id: teen.id,
      event_type: 'consent_granted',
      ip_address: '203.0.113.44',
      event_data: {
        guardian_id: accepted.guardianId,
        teen_id: teen.id,
        consent_level: 'full_access',
        ip_address: '203.0.113.44',
      },
    })
    expect(prisma.eventEnvelopes).toHaveLength(3)
    expect(capture).toHaveBeenCalledOnce()
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('rejects invitations that were already accepted', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-replay',
      email: 'teen.replay@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-replay',
      email: 'guardian.replay@example.com',
    })
    const { prisma, service } = createService()
    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })

    const invite = await service.inviteGuardian(teen.id, guardian.email, 'read_only')
    const token = new URL(invite.invitationLink).searchParams.get('token')
    if (!token) {
      throw new Error('Expected invite link to contain a token')
    }

    await service.acceptInvitation(token, '198.51.100.10')

    await expect(service.acceptInvitation(token, '198.51.100.10')).rejects.toThrow(
      /already been accepted/
    )
  })

  it('revokes the last active guardian consent, queues a notification, and invalidates teen access', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-revoke',
      email: 'teen.revoke@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-revoke',
      email: 'guardian.revoke@example.com',
    })
    const { prisma, capture, invalidateUserSessions, markTeenAccessRevoked, service } =
      createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
            guardianConsentGrantedAt: '2026-04-17T06:00:00.000Z',
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-17T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.revokeConsent(guardian.id, teen.id, '203.0.113.99')

    expect(result).toMatchObject({
      guardianId: guardian.id,
      teenId: teen.id,
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
      notificationQueued: true,
    })

    const revokedConsent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(revokedConsent).toMatchObject({
      status: 'revoked',
      ip_address: '198.51.100.10',
      revoked_ip_address: '203.0.113.99',
    })
    expect(revokedConsent?.revoked_at).toBeInstanceOf(Date)

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
      guardianConsentGrantedAt: null,
    })

    expect(prisma.eventEnvelopes).toHaveLength(1)
    expect(prisma.eventEnvelopes[0]).toMatchObject({
      channel: 'email.guardian-consent-revoked',
      user_id: teen.id,
    })

    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'consent_revoked',
      ip_address: '203.0.113.99',
      event_data: {
        guardian_id: guardian.id,
        teen_id: teen.id,
        consent_level: 'full_access',
      },
    })
    expect(invalidateUserSessions).toHaveBeenCalledWith(teen.id)
    expect(markTeenAccessRevoked).toHaveBeenCalledWith(teen.id)
    expect(prisma.garmentItem.updateMany).toHaveBeenCalledOnce()
    const retentionUpdate = prisma.garmentItem.updateMany.mock.calls[0]?.[0]
    expect(retentionUpdate).toMatchObject({
      where: {
        user_id: teen.id,
        retention_status: 'active',
      },
      data: {
        retention_status: 'deletion_pending',
        retention_trigger: 'guardian_consent_revoked',
      },
    })
    expect(retentionUpdate?.data.deletion_requested_at).toBeInstanceOf(Date)
    expect(capture).toHaveBeenCalledOnce()
    const analyticsEvent = capture.mock.calls[0]?.[0]
    expect(analyticsEvent).toMatchObject({
      distinctId: guardian.id,
      event: 'guardian_consent_revoked',
    })
    expect(analyticsEvent?.properties).toMatchObject({
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
    })
  })

  it('keeps teen access active when another guardian consent remains', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-multi',
      email: 'teen.multi@example.com',
      age: 14,
    })
    const revokingGuardian = createGuardianProfileFixture({
      id: 'guardian-a',
      email: 'guardian.a@example.com',
    })
    const remainingGuardian = createGuardianProfileFixture({
      id: 'guardian-b',
      email: 'guardian.b@example.com',
    })
    const { prisma, invalidateUserSessions, markTeenAccessGranted, service } =
      createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })
    prisma.users.set(revokingGuardian.id, {
      id: revokingGuardian.id,
      email: revokingGuardian.email,
      profile: null,
    })
    prisma.users.set(remainingGuardian.id, {
      id: remainingGuardian.id,
      email: remainingGuardian.email,
      profile: null,
    })
    prisma.consents.set(`${revokingGuardian.id}:${teen.id}`, {
      guardian_id: revokingGuardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      consent_granted_at: new Date('2026-04-17T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })
    prisma.consents.set(`${remainingGuardian.id}:${teen.id}`, {
      guardian_id: remainingGuardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-18T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.11',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.revokeConsent(
      revokingGuardian.id,
      teen.id,
      '203.0.113.100'
    )

    expect(result).toMatchObject({
      remainingActiveGuardians: 1,
      sessionInvalidated: false,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    expect(compliance?.guardianConsentRevokedAt).toBeUndefined()
    expect(invalidateUserSessions).not.toHaveBeenCalled()
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('retries revokeConsent when the serializable transaction hits a write conflict', async () => {
    const teen = createTeenProfileFixture({
      id: 'teen-retry',
      email: 'teen.retry@example.com',
      age: 14,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-retry',
      email: 'guardian.retry@example.com',
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      consent_granted_at: new Date('2026-04-18T06:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.15',
      revoked_ip_address: null,
      status: 'granted',
    })

    const originalTransaction = prisma.$transaction
    let attempts = 0
    prisma.$transaction = vi.fn(async (callback, options) => {
      attempts += 1
      expect(options).toMatchObject({
        isolationLevel: 'Serializable',
      })

      if (attempts === 1) {
        throw Object.assign(new Error('serialization failure'), { code: 'P2034' })
      }

      return originalTransaction(callback, options)
    })

    await expect(
      service.revokeConsent(guardian.id, teen.id, '203.0.113.101')
    ).resolves.toMatchObject({
      guardianId: guardian.id,
      teenId: teen.id,
      remainingActiveGuardians: 0,
    })

    expect(attempts).toBe(2)
  })

  it('rejects guardian invitations once the teen has reached adulthood', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T03:00:00.000Z'))

    const teen = createTeenProfileFixture({
      id: 'teen-adult',
      email: 'teen.adult@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    await expect(
      service.inviteGuardian(teen.id, 'guardian.adult@example.com', 'read_only')
    ).rejects.toThrow(/no longer required for adult accounts/)
  })

  it('emancipates pending teens on their eighteenth birthday and grants access', async () => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-birthday',
      email: 'teen.birthday@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const { markTeenAccessGranted, prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
      guardianConsentAgedOutAt: today.toISOString(),
    })
    expect(prisma.eventEnvelopes[0]).toMatchObject({
      channel: 'email.guardian-consent-aged-out',
      user_id: teen.id,
    })
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'guardian_consent_aged_out',
      event_data: {
        teen_id: teen.id,
        revoked_guardian_access: true,
        revoked_guardian_count: 0,
      },
    })
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('retries emancipation when the serializable transaction hits a write conflict', async () => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-emancipation-retry',
      email: 'teen.emancipation.retry@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })

    const originalTransaction = prisma.$transaction
    let attempts = 0
    prisma.$transaction = vi.fn(async (callback, options) => {
      attempts += 1
      expect(options).toMatchObject({
        isolationLevel: 'Serializable',
      })

      if (attempts === 1) {
        throw Object.assign(new Error('serialization failure'), { code: 'P2034' })
      }

      return originalTransaction(callback, options)
    })

    await expect(service.emancipateEligibleTeens(today)).resolves.toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    expect(attempts).toBe(2)
  })

  it('revokes active guardian links by default when a teen ages out of consent', async () => {
    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-emancipated',
      email: 'teen.emancipated@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-emancipated',
      email: 'guardian.emancipated@example.com',
    })
    const { markTeenAccessGranted, prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
            guardianConsentGrantedAt: '2026-04-15T03:00:00.000Z',
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-15T03:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.10',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 1,
      notificationsQueued: 1,
    })

    const consent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(consent).toMatchObject({
      status: 'revoked',
      revoked_at: today,
      revoked_ip_address: null,
    })

    const compliance = prisma.users.get(teen.id)?.profile?.preferences?.compliance as
      | Record<string, unknown>
      | undefined
    expect(compliance).toMatchObject({
      accountStatus: 'active',
      guardianConsentRequired: false,
      guardianConsentAgedOutAt: today.toISOString(),
      guardianConsentRevokedAt: today.toISOString(),
    })
    const revokedAuditLog = prisma.auditLogs.find(
      (entry) => entry.user_id === teen.id && entry.event_type === 'consent_revoked'
    )
    expect(revokedAuditLog).toBeDefined()
    if (!revokedAuditLog?.event_data) {
      throw new Error('Expected consent_revoked audit log with event data')
    }
    expect(revokedAuditLog.event_data).toMatchObject({
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'full_access',
    })

    const agedOutAuditLog = prisma.auditLogs.find(
      (entry) =>
        entry.user_id === teen.id && entry.event_type === 'guardian_consent_aged_out'
    )
    expect(agedOutAuditLog).toBeDefined()
    if (!agedOutAuditLog?.event_data) {
      throw new Error('Expected guardian_consent_aged_out audit log with event data')
    }
    expect(agedOutAuditLog.event_data).toMatchObject({
      teen_id: teen.id,
      revoked_guardian_access: true,
      revoked_guardian_count: 1,
    })
    expect(markTeenAccessGranted).toHaveBeenCalledWith(teen.id)
  })

  it('can keep guardian links after emancipation when the config disables auto-revocation', async () => {
    process.env.GUARDIAN_EMANCIPATION_REVOKE_CONSENTS = 'false'

    const today = new Date('2026-04-22T03:00:00.000Z')
    const teen = createTeenProfileFixture({
      id: 'teen-configurable',
      email: 'teen.configurable@example.com',
      age: 18,
      birthdate: new Date('2008-04-22T12:00:00.000Z'),
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-configurable',
      email: 'guardian.configurable@example.com',
    })
    const { prisma, service } = createService()

    prisma.users.set(teen.id, {
      id: teen.id,
      email: teen.email,
      profile: {
        user_id: teen.id,
        birthdate: teen.birthdate,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
        },
      },
    })
    prisma.users.set(guardian.id, {
      id: guardian.id,
      email: guardian.email,
      profile: null,
    })
    prisma.consents.set(`${guardian.id}:${teen.id}`, {
      guardian_id: guardian.id,
      teen_id: teen.id,
      consent_level: 'read_only',
      consent_granted_at: new Date('2026-04-12T03:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.20',
      revoked_ip_address: null,
      status: 'granted',
    })

    const result = await service.emancipateEligibleTeens(today)

    expect(result).toEqual({
      processed: 1,
      teenIds: [teen.id],
      revokedConsentCount: 0,
      notificationsQueued: 1,
    })

    const consent = prisma.consents.get(`${guardian.id}:${teen.id}`)
    expect(consent).toMatchObject({
      status: 'granted',
      revoked_at: null,
    })
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      user_id: teen.id,
      event_type: 'guardian_consent_aged_out',
      event_data: {
        teen_id: teen.id,
        active_guardian_count: 1,
        revoked_guardian_access: false,
        revoked_guardian_count: 0,
      },
    })
  })

  describe('guardian invitation email template', () => {
    it('escapes HTML metacharacters so account emails cannot inject markup', () => {
      // The invitation email is sent to an address the teen supplies, so every
      // interpolated value is attacker-influenced and must be escaped.
      const template = buildGuardianInvitationEmailTemplate({
        teenEmail: '"><script>alert(1)</script>&teen@example.com',
        guardianEmail: `o${String.fromCharCode(39)}brien@example.com`,
        consentLevel: 'full_access',
        invitationLink: 'https://app.test/guardian/accept?token=a&b=c',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
      })

      expect(template.html).not.toContain('<script>')
      expect(template.html).toContain('&lt;script&gt;')
      expect(template.html).toContain('&quot;')
      expect(template.html).toContain('&#39;')
      expect(template.html).toContain('token=a&amp;b=c')
      expect(template.html).toContain('full access')
      // The text part is never rendered as HTML, so it stays verbatim.
      expect(template.text).toContain('<script>')
      expect(template.text).toContain('https://app.test/guardian/accept?token=a&b=c')
    })
  })

  describe('invitation link base URL resolution', () => {
    const inviteAndReadLink = async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-base-url', email: 'teen.baseurl@example.com' })

      const result = await service.inviteGuardian(
        'teen-base-url',
        'guardian.baseurl@example.com',
        'read_only'
      )

      return result.invitationLink
    }

    it('falls back to NEXT_PUBLIC_APP_URL when the guardian base URL is unset', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://next.couturecast.test')
      vi.stubEnv('APP_URL', 'https://ignored.couturecast.test')

      await expect(inviteAndReadLink()).resolves.toContain(
        'https://next.couturecast.test/guardian/accept?token='
      )
    })

    it('falls back to APP_URL when no web-specific base URL is configured', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
      vi.stubEnv('APP_URL', 'https://app-url.couturecast.test/')

      // Trailing slashes are normalised away so the link never doubles up.
      await expect(inviteAndReadLink()).resolves.toContain(
        'https://app-url.couturecast.test/guardian/accept?token='
      )
    })

    it('falls back to localhost when nothing is configured', async () => {
      vi.stubEnv('GUARDIAN_INVITE_WEB_BASE_URL', undefined)
      vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
      vi.stubEnv('APP_URL', undefined)

      await expect(inviteAndReadLink()).resolves.toContain(
        'http://localhost:3000/guardian/accept?token='
      )
    })
  })

  describe('invitation signing secret resolution', () => {
    const issueTokenAndReadSignature = async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-secret', email: 'teen.secret@example.com' })

      const result = await service.inviteGuardian(
        'teen-secret',
        'guardian.secret@example.com',
        'read_only'
      )
      const token = new URL(result.invitationLink).searchParams.get('token') ?? ''
      const [header, body, signature] = token.split('.')

      return { header, body, signature }
    }

    const expectSignedWith = (
      parts: { header?: string; body?: string; signature?: string },
      secret: string
    ) => {
      const expected = createHmac('sha256', secret)
        .update(`${parts.header}.${parts.body}`)
        .digest('base64url')
      expect(parts.signature).toBe(expected)
    }

    it('falls back to the development secret inside the test environment', async () => {
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('treats a whitespace-only configured secret as unset', async () => {
      // A blank env var must not be accepted as a signing key.
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', '   ')

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('allows the development secret outside tests only behind an explicit opt-in', async () => {
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('ALLOW_DEV_GUARDIAN_SECRET', 'true')

      expectSignedWith(await issueTokenAndReadSignature(), DEVELOPMENT_INVITATION_SECRET)
    })

    it('refuses to sign invitations when no secret is configured in production', async () => {
      // Failing closed here is what stops production issuing forgeable tokens.
      vi.stubEnv('GUARDIAN_INVITE_JWT_SECRET', undefined)
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('ALLOW_DEV_GUARDIAN_SECRET', undefined)

      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-no-secret', email: 'teen.nosecret@example.com' })

      await expect(
        service.inviteGuardian('teen-no-secret', 'guardian.nosecret@example.com')
      ).rejects.toThrow(/GUARDIAN_INVITE_JWT_SECRET is required/)
      // No invitation row may be created when the token cannot be signed.
      expect(prisma.invitations.size).toBe(0)
    })
  })

  describe('inviteGuardian refusals', () => {
    it('rejects invitations for an unknown teen account', async () => {
      const { prisma, service } = createService()

      await expect(
        service.inviteGuardian('teen-missing', 'guardian.missing@example.com')
      ).rejects.toThrow(/Teen account not found/)
      expect(prisma.invitations.size).toBe(0)
    })

    it('rejects a guardian email that matches the teen account email', async () => {
      // Self-consent would let a minor approve their own wardrobe access.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-self', email: 'teen.self@example.com' })

      await expect(
        service.inviteGuardian('teen-self', 'Teen.Self@Example.com')
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.invitations.size).toBe(0)
    })

    it('rejects invitations when the profile carries no compliance block at all', async () => {
      // Missing compliance state must fail closed rather than read as "active".
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-prefs',
        email: 'teen.noprefs@example.com',
        preferences: null,
      })

      await expect(
        service.inviteGuardian('teen-no-prefs', 'guardian.noprefs@example.com')
      ).rejects.toThrow(/awaiting consent/)
    })

    it('rejects invitations when compliance state is not an object', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-bad-prefs',
        email: 'teen.badprefs@example.com',
        preferences: { compliance: 'pending_guardian_consent' },
      })

      await expect(
        service.inviteGuardian('teen-bad-prefs', 'guardian.badprefs@example.com')
      ).rejects.toThrow(/awaiting consent/)
    })
  })

  describe('acceptInvitation token verification', () => {
    const acceptWith = (token: string) => {
      const { service } = createService()
      return service.acceptInvitation(token)
    }

    it('rejects a token that is not three dot-separated segments', async () => {
      await expect(acceptWith('not-a-real-token')).rejects.toThrow(/malformed/)
    })

    it('rejects a token whose signature length has been tampered with', async () => {
      const token = `${signInvitationToken(buildInvitationTokenPayload())}extra`

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a token signed with a different secret', async () => {
      // Same signature length, different bytes: this is the timing-safe compare path.
      const token = signInvitationToken(
        buildInvitationTokenPayload(),
        'attacker-controlled-secret'
      )

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a correctly signed token whose payload is not JSON', async () => {
      const token = signTokenBody('this-is-not-json')

      await expect(acceptWith(token)).rejects.toThrow(/malformed/)
    })

    it('rejects a correctly signed token whose payload fails the schema', async () => {
      const token = signInvitationToken({
        ...buildInvitationTokenPayload(),
        type: 'password_reset',
      })

      await expect(acceptWith(token)).rejects.toThrow(/invalid/)
    })

    it('rejects a token whose expiry has already passed', async () => {
      const token = signInvitationToken(
        buildInvitationTokenPayload({
          exp: Math.floor((Date.now() - 60_000) / 1000),
        })
      )

      await expect(acceptWith(token)).rejects.toThrow(/expired/)
    })
  })

  describe('acceptInvitation refusals', () => {
    it('rejects a token that references an invitation which no longer exists', async () => {
      const { service } = createService()
      const token = signInvitationToken(
        buildInvitationTokenPayload({ sub: 'invitation-deleted' })
      )

      await expect(service.acceptInvitation(token)).rejects.toThrow(
        /Guardian invitation not found/
      )
    })

    it('rejects an invitation whose stored expiry has lapsed even if the token has not', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
        expiresAt: new Date(Date.now() - 1_000),
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/Guardian invitation has expired/)
      expect(prisma.consents.size).toBe(0)
    })

    it.each([
      { field: 'teenId', overrides: { teenId: 'teen-other' } },
      {
        field: 'guardianEmail',
        overrides: { guardianEmail: 'someone.else@example.com' },
      },
      { field: 'consentLevel', overrides: { consentLevel: 'full_access' } },
    ])(
      'rejects a token whose $field disagrees with the stored invitation',
      async ({ overrides }) => {
        // A token must never be able to upgrade or retarget the stored invitation.
        const { prisma, service } = createService()
        seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
        seedUser(prisma, { id: 'teen-other', email: 'teen.other@example.com' })
        seedInvitation(prisma, {
          teenId: 'teen-seeded',
          guardianEmail: 'guardian.seeded@example.com',
          consentLevel: 'read_only',
        })

        await expect(
          service.acceptInvitation(
            signInvitationToken(buildInvitationTokenPayload(overrides))
          )
        ).rejects.toThrow(/Guardian invitation token is invalid/)
        expect(prisma.consents.size).toBe(0)
      }
    )

    it('rejects an invitation whose guardian email equals the teen email', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'guardian.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.consents.size).toBe(0)
    })

    it('rejects an invitation when the guardian address resolves to the teen account', async () => {
      // Defence in depth: the address differs but the account behind it is the teen.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'teen-seeded',
        email: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/must differ from the teen account email/)
      expect(prisma.consents.size).toBe(0)
    })

    it('rejects acceptance once the teen has reached the age of majority', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        birthdate: new Date('2000-01-01T00:00:00.000Z'),
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await expect(
        service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))
      ).rejects.toThrow(/no longer required for adult accounts/)
      expect(prisma.consents.size).toBe(0)
    })
  })

  describe('acceptInvitation edge paths', () => {
    it('records consent for a teen that has no profile row yet', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        withProfile: false,
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      const accepted = await service.acceptInvitation(
        signInvitationToken(buildInvitationTokenPayload())
      )

      expect(accepted.teenId).toBe('teen-seeded')
      expect(prisma.consents.size).toBe(1)
      // Nothing to update when there is no profile, so no write is attempted.
      expect(prisma.userProfile.update).not.toHaveBeenCalled()
      expect(prisma.auditLogs.at(-1)?.event_type).toBe('consent_granted')
    })

    it('stores a null IP rather than an empty string when the address is blank', async () => {
      // Audit records are immutable, so a blank forwarded-for must not be persisted.
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-seeded', email: 'teen.seeded@example.com' })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(
        signInvitationToken(buildInvitationTokenPayload()),
        '   '
      )

      expect(prisma.auditLogs.at(-1)).toMatchObject({
        event_type: 'consent_granted',
        ip_address: null,
        event_data: { ip_address: null },
      })
      expect([...prisma.consents.values()][0]?.ip_address).toBeNull()
    })

    it('rebuilds compliance state when the teen profile has no preferences', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        preferences: null,
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))

      expect(prisma.users.get('teen-seeded')?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
          guardianConsentRevokedAt: null,
        },
      })
    })

    it('replaces a non-object compliance block instead of spreading it', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-seeded',
        email: 'teen.seeded@example.com',
        preferences: { theme: 'dark', compliance: 'corrupt' },
      })
      seedInvitation(prisma, {
        teenId: 'teen-seeded',
        guardianEmail: 'guardian.seeded@example.com',
      })

      await service.acceptInvitation(signInvitationToken(buildInvitationTokenPayload()))

      const preferences = prisma.users.get('teen-seeded')?.profile?.preferences
      expect(preferences).toMatchObject({
        theme: 'dark',
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      })
    })
  })

  describe('revokeConsent refusals and edge paths', () => {
    it('refuses to revoke when there is no active consent to revoke', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, { id: 'teen-none', email: 'teen.none@example.com' })

      await expect(
        service.revokeConsent('guardian-none', 'teen-none', '203.0.113.5')
      ).rejects.toThrow(/Active guardian consent not found/)
      expect(prisma.auditLogs).toHaveLength(0)
      expect(prisma.eventEnvelopes).toHaveLength(0)
    })

    it('stores a null revoking IP when no address is supplied', async () => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma)

      await service.revokeConsent(guardianId, teenId)

      expect(
        prisma.consents.get(`${guardianId}:${teenId}`)?.revoked_ip_address
      ).toBeNull()
      expect(prisma.auditLogs.at(-1)).toMatchObject({
        event_type: 'consent_revoked',
        ip_address: null,
      })
    })

    it('rebuilds compliance state on revocation when preferences are absent', async () => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma, null)

      await service.revokeConsent(guardianId, teenId, '203.0.113.6')

      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'pending_guardian_consent',
          guardianConsentRequired: true,
          guardianConsentGrantedAt: null,
        },
      })
    })
  })

  describe('serializable transaction retry classification', () => {
    const runRevokeWithFailure = (error: unknown, failures: number) => {
      const { prisma, service } = createService()
      const { guardianId, teenId } = seedRevocableConsent(prisma)
      const originalTransaction = prisma.$transaction
      let attempts = 0

      prisma.$transaction = vi.fn(async (callback, options) => {
        attempts += 1
        if (attempts <= failures) {
          throw error
        }

        return originalTransaction(callback, options)
      })

      const promise = service.revokeConsent(guardianId, teenId, '203.0.113.7')

      return { attempts: () => attempts, promise }
    }

    it.each([
      {
        name: 'a Prisma P2034 write conflict',
        error: buildPrismaKnownRequestError('P2034'),
      },
      {
        name: 'a Prisma error whose meta.code is SQLSTATE 40001',
        error: buildPrismaKnownRequestError('P2010', { code: '40001' }),
      },
      {
        name: 'a Prisma error whose meta.sqlstate is 40001',
        error: buildPrismaKnownRequestError('P2010', { sqlstate: '40001' }),
      },
      {
        name: 'a plain object carrying meta.code 40001',
        error: { meta: { code: '40001' } },
      },
      {
        name: 'a plain object carrying meta.sqlstate 40001',
        error: { meta: { sqlstate: '40001' } },
      },
      {
        name: 'a bare Error whose message embeds SQLSTATE 40001',
        error: new Error('could not serialize access (40001)'),
      },
    ])('retries revocation after $name', async ({ error }) => {
      const { attempts, promise } = runRevokeWithFailure(error, 1)

      await expect(promise).resolves.toMatchObject({ sessionInvalidated: true })
      expect(attempts()).toBe(2)
    })

    it.each([
      {
        name: 'an unrelated Prisma error code',
        error: buildPrismaKnownRequestError('P2025'),
      },
      {
        name: 'a Prisma error whose meta holds no recognisable code',
        error: buildPrismaKnownRequestError('P2010', { hint: 'nope' }),
      },
      { name: 'a plain object with an empty meta', error: { meta: {} } },
      { name: 'an object with no code, meta, or message', error: {} },
      { name: 'an object whose message is not a string', error: { message: 42 } },
      { name: 'a thrown string', error: 'connection reset by peer' },
    ])('rethrows immediately after $name', async ({ error }) => {
      const { attempts, promise } = runRevokeWithFailure(error, 1)

      await expect(promise).rejects.toBeDefined()
      expect(attempts()).toBe(1)
    })

    it('gives up after exhausting the retry budget', async () => {
      const { attempts, promise } = runRevokeWithFailure(
        buildPrismaKnownRequestError('P2034'),
        3
      )

      await expect(promise).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
      expect(attempts()).toBe(3)
    })

    it('rethrows a non-retryable failure raised during emancipation', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-emancipate-error',
        email: 'teen.emancipate.error@example.com',
        birthdate: new Date('2008-04-22T12:00:00.000Z'),
      })
      prisma.$transaction = vi.fn(() => {
        throw buildPrismaKnownRequestError('P2025')
      })

      await expect(
        service.emancipateEligibleTeens(new Date('2026-04-22T03:00:00.000Z'))
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    })
  })

  describe('emancipateEligibleTeens skip conditions', () => {
    const TODAY = new Date('2026-04-22T03:00:00.000Z')
    const ADULT_BIRTHDATE = new Date('2008-04-22T12:00:00.000Z')

    it('skips candidates whose profile row is missing', async () => {
      const { prisma, service } = createService()
      prisma.user.findMany.mockResolvedValueOnce([
        { id: 'teen-no-profile', email: 'teen.noprofile@example.com', profile: null },
      ])

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toEqual({
        processed: 0,
        teenIds: [],
        revokedConsentCount: 0,
        notificationsQueued: 0,
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('skips teens that were already aged out so the cron stays idempotent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-already-aged-out',
        email: 'teen.agedout@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: {
          compliance: {
            accountStatus: 'active',
            guardianConsentAgedOutAt: '2026-04-21T00:00:00.000Z',
          },
        },
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 0,
        notificationsQueued: 0,
      })
      expect(prisma.auditLogs).toHaveLength(0)
    })

    it('treats a blank aged-out marker as not yet aged out', async () => {
      // A whitespace-only timestamp is corrupt state, not a completed emancipation.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-blank-marker',
        email: 'teen.blank@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentAgedOutAt: '   ',
          },
        },
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
        teenIds: ['teen-blank-marker'],
      })
    })

    it('skips adults that neither require guardian consent nor have an active link', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-unmanaged',
        email: 'teen.unmanaged@example.com',
        birthdate: ADULT_BIRTHDATE,
        preferences: activeCompliancePreferences(),
      })

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 0,
      })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('emancipates an adult whose only signal is an active guardian link', async () => {
      const { prisma, service } = createService()
      const { teenId } = seedRevocableConsent(prisma, null)
      const teen = prisma.users.get(teenId)
      if (teen?.profile) {
        teen.profile.birthdate = ADULT_BIRTHDATE
      }

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
        revokedConsentCount: 1,
      })
      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: {
          accountStatus: 'active',
          guardianConsentRequired: false,
          guardianConsentAgedOutAt: TODAY.toISOString(),
          guardianConsentRevokedAt: TODAY.toISOString(),
        },
      })
    })

    it('replaces a non-object compliance block during emancipation', async () => {
      const { prisma, service } = createService()
      const { teenId } = seedRevocableConsent(prisma, { compliance: ['corrupt'] })
      const teen = prisma.users.get(teenId)
      if (teen?.profile) {
        teen.profile.birthdate = ADULT_BIRTHDATE
      }

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toMatchObject({
        processed: 1,
      })
      expect(prisma.users.get(teenId)?.profile?.preferences).toMatchObject({
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      })
    })

    it.each([
      {
        name: 'the teen row disappeared before the transaction opened',
        reread: null,
      },
      {
        name: 'the teen profile was deleted before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: null,
          teen_roles: [],
        },
      },
      {
        name: 'the birthdate was corrected to a minor before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2012-04-22T12:00:00.000Z'),
            preferences: {
              compliance: { accountStatus: 'pending_guardian_consent' },
            },
          },
          teen_roles: [],
        },
      },
      {
        name: 'a concurrent run already aged the teen out',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2008-04-22T12:00:00.000Z'),
            preferences: {
              compliance: { guardianConsentAgedOutAt: '2026-04-22T02:00:00.000Z' },
            },
          },
          teen_roles: [],
        },
      },
      {
        name: 'the last guardian link was revoked before the transaction opened',
        reread: {
          id: 'teen-race',
          email: 'teen.race@example.com',
          profile: {
            user_id: 'teen-race',
            birthdate: new Date('2008-04-22T12:00:00.000Z'),
            preferences: { compliance: { accountStatus: 'active' } },
          },
          teen_roles: [],
        },
      },
    ])('takes no action when $name', async ({ reread }) => {
      // The candidate scan is not transactional, so the in-transaction re-check is
      // the only thing preventing a duplicated or wrongly-issued emancipation.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-race',
        email: 'teen.race@example.com',
        birthdate: ADULT_BIRTHDATE,
      })
      prisma.user.findUnique.mockResolvedValueOnce(reread)

      await expect(service.emancipateEligibleTeens(TODAY)).resolves.toEqual({
        processed: 0,
        teenIds: [],
        revokedConsentCount: 0,
        notificationsQueued: 0,
      })
      expect(prisma.auditLogs).toHaveLength(0)
      expect(prisma.eventEnvelopes).toHaveLength(0)
    })
  })

  describe('assertWardrobeUploadAllowed', () => {
    const AGE_REFERENCE_DATE = new Date('2026-04-22T03:00:00.000Z')

    const birthdateForAge = (age: number) =>
      new Date(
        Date.UTC(
          AGE_REFERENCE_DATE.getUTCFullYear() - age,
          AGE_REFERENCE_DATE.getUTCMonth(),
          AGE_REFERENCE_DATE.getUTCDate() - 1
        )
      )

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(AGE_REFERENCE_DATE)
    })

    it.each([undefined, 'adult', 'guardian'])(
      'does not gate uploads for the %s role',
      async (role) => {
        const { prisma, service } = createService()

        await expect(
          service.assertWardrobeUploadAllowed('user-1', role)
        ).resolves.toBeUndefined()
        // Non-teen roles must not even touch the consent tables.
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
      }
    )

    it('denies uploads when the teen account does not exist', async () => {
      const { service } = createService()

      await expect(service.assertWardrobeUploadAllowed('ghost', 'teen')).rejects.toThrow(
        ForbiddenException
      )
    })

    it('denies uploads when the teen has no profile row', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-profile',
        email: 'teen.noprofile@example.com',
        withProfile: false,
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-no-profile', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it('denies uploads when the profile carries no birthdate', async () => {
      // Without a birthdate the age gate cannot be evaluated, so it must fail closed.
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-no-birthdate',
        email: 'teen.nobirthdate@example.com',
        preferences: activeCompliancePreferences(),
        birthdate: null,
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-no-birthdate', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it.each(['pending_guardian_consent', 'suspended', undefined])(
      'denies uploads while the account status is %s',
      async (accountStatus) => {
        const { prisma, service } = createService()
        seedUser(prisma, {
          id: 'teen-inactive',
          email: 'teen.inactive@example.com',
          birthdate: birthdateForAge(14),
          preferences: { compliance: { accountStatus } },
        })

        await expect(
          service.assertWardrobeUploadAllowed('teen-inactive', 'teen')
        ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      }
    )

    it('denies uploads for under-13 accounts even with an active guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-under-13',
        email: 'teen.under13@example.com',
        birthdate: birthdateForAge(12),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-x:teen-under-13', {
        guardian_id: 'guardian-x',
        teen_id: 'teen-under-13',
        consent_level: 'full_access',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: null,
        ip_address: null,
        revoked_ip_address: null,
        status: 'granted',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-under-13', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it.each([13, 15])(
      'denies uploads for a %s-year-old with no active guardian consent',
      async (age) => {
        const { prisma, service } = createService()
        seedUser(prisma, {
          id: 'teen-unconsented',
          email: 'teen.unconsented@example.com',
          birthdate: birthdateForAge(age),
          preferences: activeCompliancePreferences(),
        })

        await expect(
          service.assertWardrobeUploadAllowed('teen-unconsented', 'teen')
        ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
      }
    )

    it('denies uploads for a 13-15 year old whose only consent has been revoked', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-revoked',
        email: 'teen.revoked@example.com',
        birthdate: birthdateForAge(14),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-y:teen-revoked', {
        guardian_id: 'guardian-y',
        teen_id: 'teen-revoked',
        consent_level: 'full_access',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: new Date('2026-03-01T00:00:00.000Z'),
        ip_address: null,
        revoked_ip_address: null,
        status: 'revoked',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-revoked', 'teen')
      ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
    })

    it('allows uploads for a 13-15 year old with an active guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-consented',
        email: 'teen.consented@example.com',
        birthdate: birthdateForAge(14),
        preferences: activeCompliancePreferences(),
      })
      prisma.consents.set('guardian-z:teen-consented', {
        guardian_id: 'guardian-z',
        teen_id: 'teen-consented',
        consent_level: 'read_only',
        consent_granted_at: new Date('2026-01-01T00:00:00.000Z'),
        revoked_at: null,
        ip_address: null,
        revoked_ip_address: null,
        status: 'granted',
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-consented', 'teen')
      ).resolves.toBeUndefined()
    })

    it('allows uploads at 16 and over without any guardian consent', async () => {
      const { prisma, service } = createService()
      seedUser(prisma, {
        id: 'teen-16',
        email: 'teen.16@example.com',
        birthdate: birthdateForAge(16),
        preferences: activeCompliancePreferences(),
      })

      await expect(
        service.assertWardrobeUploadAllowed('teen-16', 'teen')
      ).resolves.toBeUndefined()
    })
  })
})
