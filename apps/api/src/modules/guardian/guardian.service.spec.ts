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
import { GuardianService } from './guardian.service'

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

describe('GuardianService', () => {
  beforeEach(() => {
    process.env.GUARDIAN_INVITE_JWT_SECRET = 'test-guardian-secret'
    process.env.GUARDIAN_INVITE_WEB_BASE_URL = 'https://app.couturecast.test'
  })

  afterEach(() => {
    delete process.env.GUARDIAN_INVITE_JWT_SECRET
    delete process.env.GUARDIAN_INVITE_WEB_BASE_URL
    delete process.env.GUARDIAN_EMANCIPATION_REVOKE_CONSENTS
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
})
