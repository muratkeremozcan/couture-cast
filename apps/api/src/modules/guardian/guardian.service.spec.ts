import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import { GuardianService } from './guardian.service'

type StoredUser = {
  id: string
  email: string
  profile: {
    user_id: string
    preferences: Record<string, unknown> | null
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
  guardian_id: string
  teen_id: string
  consent_level: 'read_only' | 'full_access'
  consent_granted_at: Date
  revoked_at: Date | null
  ip_address: string | null
  status: 'granted'
}

class InMemoryGuardianPrisma {
  users = new Map<string, StoredUser>()
  invitations = new Map<string, StoredInvitation>()
  consents = new Map<string, StoredConsent>()
  eventEnvelopes: { channel: string; user_id?: string | null; payload: unknown }[] = []

  user = {
    findUnique: vi.fn(({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) {
        return this.users.get(where.id) ?? null
      }

      if (where.email) {
        return (
          [...this.users.values()].find(
            (user) => user.email.toLowerCase() === where.email?.toLowerCase()
          ) ?? null
        )
      }

      return null
    }),
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

  $transaction = vi.fn(async <T>(callback: (tx: InMemoryGuardianPrisma) => Promise<T>) =>
    callback(this)
  )
}

const createService = (prisma = new InMemoryGuardianPrisma()) => {
  const capture = vi.fn()
  const analyticsClient = { capture } as unknown as AnalyticsClient

  return {
    prisma,
    capture,
    service: new GuardianService(analyticsClient, prisma as unknown as PrismaClient),
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
    const { prisma, capture, service } = createService()
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
    expect(prisma.eventEnvelopes).toHaveLength(3)
    expect(capture).toHaveBeenCalledOnce()
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
})
