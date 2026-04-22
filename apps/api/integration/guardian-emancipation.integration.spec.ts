import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import {
  ForbiddenException,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import {
  forbiddenHttpErrorSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../test/factories.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import { UserController } from '../src/modules/user/user.controller'
import { UserService } from '../src/modules/user/user.service'
import { GuardianService } from '../src/modules/guardian/guardian.service'

type RequestRole = 'guardian' | 'teen' | 'moderator' | 'admin'

type StoredUser = {
  id: string
  email: string
  profile: {
    user_id: string
    birthdate: Date
    display_name?: string | null
    preferences: Record<string, unknown> | null
  } | null
}

type StoredConsent = {
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

class InMemoryGuardianIntegrationPrisma {
  users = new Map<string, StoredUser>()
  consents = new Map<string, StoredConsent>()
  auditLogs: StoredAuditLog[] = []
  eventEnvelopes: { channel: string; user_id?: string | null; payload: unknown }[] = []

  private buildTeenRoles(teenId: string) {
    return [...this.consents.values()]
      .filter((consent) => consent.teen_id === teenId)
      .map((consent) => ({ ...consent }))
  }

  private buildGuardianRoles(guardianId: string) {
    return [...this.consents.values()]
      .filter((consent) => consent.guardian_id === guardianId)
      .map((consent) => ({ ...consent }))
  }

  private hydrateUserForIncludes(user: StoredUser) {
    return {
      ...user,
      profile: user.profile ? { ...user.profile } : null,
      teen_roles: this.buildTeenRoles(user.id),
      guardian_roles: this.buildGuardianRoles(user.id),
    }
  }

  user = {
    findUnique: vi.fn(({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) {
        const user = this.users.get(where.id)
        return Promise.resolve(user ? this.hydrateUserForIncludes(user) : null)
      }

      if (where.email) {
        const user = [...this.users.values()].find(
          (candidate) => candidate.email.toLowerCase() === where.email?.toLowerCase()
        )
        return Promise.resolve(user ? this.hydrateUserForIncludes(user) : null)
      }

      return Promise.resolve(null)
    }),
    findMany: vi.fn(
      ({
        where,
      }: {
        where?: {
          profile?: {
            is?: {
              birthdate?: {
                lte?: Date
              }
            }
          }
        }
      }) => {
        const birthdateLte = where?.profile?.is?.birthdate?.lte
        const users = [...this.users.values()].filter((user) => {
          if (!(birthdateLte instanceof Date)) {
            return true
          }

          return (
            user.profile?.birthdate instanceof Date &&
            user.profile.birthdate.getTime() <= birthdateLte.getTime()
          )
        })

        return Promise.resolve(users.map((user) => this.hydrateUserForIncludes(user)))
      }
    ),
  }

  guardianConsent = {
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

        const updated = {
          ...user,
          profile: {
            ...user.profile,
            preferences: data.preferences,
          },
        }
        this.users.set(user.id, updated)

        return Promise.resolve(updated.profile)
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
      callback: (tx: InMemoryGuardianIntegrationPrisma) => Promise<T>,
      options?: unknown
    ) => {
      void options
      return callback(this)
    }
  )
}

describe('Guardian emancipation sweep (integration)', () => {
  let app: INestApplication | undefined
  let prisma: InMemoryGuardianIntegrationPrisma
  let guardianService: GuardianService
  let guardianConsentStateService: GuardianConsentStateService

  const createHeaders = (userId: string, role: RequestRole) => ({
    authorization: 'Bearer test-token',
    'x-user-id': userId,
    'x-user-role': role,
  })

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    prisma = new InMemoryGuardianIntegrationPrisma()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        GuardianConsentStateService,
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        {
          provide: RequestAuthGuard,
          useFactory: (guardianConsentStateService: GuardianConsentStateService) =>
            new RequestAuthGuard(guardianConsentStateService),
          inject: [GuardianConsentStateService],
        },
      ],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()

    guardianConsentStateService = moduleFixture.get(GuardianConsentStateService)
    vi.spyOn(RequestAuthGuard.prototype, 'canActivate').mockImplementation(
      async (context) => {
        const request = context.switchToHttp().getRequest<{
          auth?: { token: string; userId: string; role: RequestRole }
          headers: Record<string, string | string[] | undefined>
        }>()
        const authorization = request.headers.authorization
        const userId = request.headers['x-user-id']
        const role = request.headers['x-user-role']

        if (
          typeof authorization !== 'string' ||
          !authorization.startsWith('Bearer ') ||
          typeof userId !== 'string' ||
          userId.trim().length === 0 ||
          typeof role !== 'string' ||
          !['guardian', 'teen', 'moderator', 'admin'].includes(role)
        ) {
          throw new UnauthorizedException('Missing or invalid authentication headers')
        }

        request.auth = {
          token: authorization.slice('Bearer '.length).trim(),
          userId,
          role: role as RequestRole,
        }

        if (
          role === 'teen' &&
          !(await guardianConsentStateService.canTeenAccess(userId))
        ) {
          throw new ForbiddenException('Guardian consent required before continuing')
        }

        return true
      }
    )

    guardianService = new GuardianService(
      { capture: vi.fn() } as never,
      prisma as unknown as PrismaClient,
      guardianConsentStateService,
      { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    if (app) {
      await app.close()
      app = undefined
    }

    resetCleanupRegistry()
  })

  it('restores adult teen access and revokes guardian linkage through the Nest guard/controller boundary', async () => {
    const now = new Date('2026-04-22T03:00:00.000Z')
    const adultBirthdate = new Date('2008-04-22T12:00:00.000Z')

    const pendingTeen = createTeenProfileFixture({
      id: 'teen-pending-emancipation',
      email: 'teen.pending.emancipation@example.com',
      age: 18,
      birthdate: adultBirthdate,
    })
    const consentedTeen = createTeenProfileFixture({
      id: 'teen-consented-emancipation',
      email: 'teen.consented.emancipation@example.com',
      age: 18,
      birthdate: adultBirthdate,
    })
    const guardian = createGuardianProfileFixture({
      id: 'guardian-emancipation',
      email: 'guardian.emancipation@example.com',
    })

    prisma.users.set(pendingTeen.id, {
      id: pendingTeen.id,
      email: pendingTeen.email,
      profile: {
        user_id: pendingTeen.id,
        birthdate: pendingTeen.birthdate,
        display_name: pendingTeen.displayName,
        preferences: {
          compliance: {
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
        },
      },
    })
    prisma.users.set(consentedTeen.id, {
      id: consentedTeen.id,
      email: consentedTeen.email,
      profile: {
        user_id: consentedTeen.id,
        birthdate: consentedTeen.birthdate,
        display_name: consentedTeen.displayName,
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
      profile: {
        user_id: guardian.id,
        birthdate: guardian.birthdate,
        display_name: guardian.displayName,
        preferences: null,
      },
    })
    prisma.consents.set(`${guardian.id}:${consentedTeen.id}`, {
      guardian_id: guardian.id,
      teen_id: consentedTeen.id,
      consent_level: 'full_access',
      consent_granted_at: new Date('2026-04-15T03:00:00.000Z'),
      revoked_at: null,
      ip_address: '198.51.100.20',
      revoked_ip_address: null,
      status: 'granted',
    })

    const pendingTeenBeforeSweep = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders(pendingTeen.id, 'teen'))

    expect(pendingTeenBeforeSweep.status).toBe(403)
    forbiddenHttpErrorSchema.parse(pendingTeenBeforeSweep.body)

    const sweepResult = await guardianService.emancipateEligibleTeens(now)
    expect(sweepResult).toEqual({
      processed: 2,
      teenIds: [pendingTeen.id, consentedTeen.id],
      revokedConsentCount: 1,
      notificationsQueued: 2,
    })

    const pendingTeenAfterSweep = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders(pendingTeen.id, 'teen'))

    expect(pendingTeenAfterSweep.status).toBe(200)
    const pendingTeenBody = userProfileResponseSchema.parse(pendingTeenAfterSweep.body)
    expect(pendingTeenBody.user.id).toBe(pendingTeen.id)

    const consentedTeenAfterSweep = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders(consentedTeen.id, 'teen'))

    expect(consentedTeenAfterSweep.status).toBe(200)
    const consentedTeenBody = userProfileResponseSchema.parse(
      consentedTeenAfterSweep.body
    )
    expect(consentedTeenBody.linkedGuardians).toContainEqual(
      expect.objectContaining({
        guardianId: guardian.id,
        status: 'revoked',
      })
    )

    expect(prisma.eventEnvelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'email.guardian-consent-aged-out',
          user_id: pendingTeen.id,
        }),
        expect.objectContaining({
          channel: 'email.guardian-consent-aged-out',
          user_id: consentedTeen.id,
        }),
      ])
    )

    expect(prisma.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: pendingTeen.id,
          event_type: 'guardian_consent_aged_out',
        }),
        expect.objectContaining({
          user_id: consentedTeen.id,
          event_type: 'guardian_consent_aged_out',
        }),
        expect.objectContaining({
          user_id: consentedTeen.id,
          event_type: 'consent_revoked',
        }),
      ])
    )
  })
})
