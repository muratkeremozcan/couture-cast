// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { vi } from 'vitest'

export type StoredUser = {
  id: string
  email: string
  profile: {
    user_id: string
    preferences: Record<string, unknown> | null
    birthdate?: Date | null
  } | null
}

export type StoredInvitation = {
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

export type StoredConsent = {
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

export type StoredAuditLog = {
  user_id: string
  event_type: string
  event_data: Record<string, unknown> | null
  timestamp: Date
  ip_address: string | null
}

export type GuardianInvitationEmailEventPayload = {
  to: string
  template: {
    templateId: string
    subject: string
    text: string
    html: string
  }
}

export type AnalyticsCapturePayload = {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

export class InMemoryGuardianPrisma {
  $executeRaw = vi.fn().mockResolvedValue(1)
  $queryRaw = vi.fn().mockResolvedValue([])
  communityComment = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
  communityReaction = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
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

  /**
   * Story 6.1 HIGH-1: revocation now hides the member's community content in the
   * same transaction, so the in-memory client has to answer for this table too.
   */
  lookbookPost = {
    updateMany: vi
      .fn<
        (args: {
          where: { user_id: string; status: { in: string[] } }
          data: { status: 'consent_suspended' }
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
