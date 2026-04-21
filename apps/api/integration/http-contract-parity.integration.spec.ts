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
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollResponseSchema,
  notFoundHttpErrorSchema,
  queueHealthResponseSchema,
  unauthorizedHttpErrorSchema,
  userProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  DEFAULT_CONSENT_GRANTED_AT,
  buildLinkedGuardianResponse,
  buildLinkedGuardianRole,
  buildPrismaUserProfileFixture,
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../test/factories.js'
import { queueConfigs } from '../src/config/queues'
import { ApiHealthController } from '../src/controllers/api-health.controller'
import { HealthController } from '../src/controllers/health.controller'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import { EventsController } from '../src/modules/events/events.controller'
import { EventsRepository } from '../src/modules/events/events.repository'
import { EventsService } from '../src/modules/events/events.service'
import { UserController } from '../src/modules/user/user.controller'
import { UserService } from '../src/modules/user/user.service'

const { guardianCanTeenAccessMock, prismaEventFindManyMock, prismaUserFindUniqueMock } =
  vi.hoisted(() => ({
    guardianCanTeenAccessMock: vi.fn(),
    prismaEventFindManyMock: vi.fn(),
    prismaUserFindUniqueMock: vi.fn(),
  }))

type RequestRole = 'guardian' | 'teen' | 'moderator' | 'admin'

describe('HTTP contract parity (integration)', () => {
  let app: INestApplication | undefined

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

        if (role === 'teen' && !(await guardianCanTeenAccessMock(userId))) {
          throw new ForbiddenException('Guardian consent required before continuing')
        }

        return true
      }
    )
    guardianCanTeenAccessMock.mockReset()
    guardianCanTeenAccessMock.mockResolvedValue(true)
    prismaEventFindManyMock.mockReset()
    prismaUserFindUniqueMock.mockReset()
    const prisma = {
      eventEnvelope: {
        create: vi.fn(),
        findMany: prismaEventFindManyMock,
      },
      user: {
        findUnique: prismaUserFindUniqueMock,
      },
    } as unknown as PrismaClient

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        ApiHealthController,
        HealthController,
        EventsController,
        UserController,
      ],
      providers: [
        EventsRepository,
        EventsService,
        UserService,
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        {
          provide: GuardianConsentStateService,
          useValue: {
            canTeenAccess: guardianCanTeenAccessMock,
          },
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
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    if (app) {
      await app.close()
      app = undefined
    }

    resetCleanupRegistry()
  })

  it('validates the API health route against the shared health schema', async () => {
    const response = await request(getHttpServer()).get('/api/health')

    expect(response.status).toBe(200)
    const body = apiHealthResponseSchema.parse(response.body)
    expect(body.service).toBe('couturecast-api')
    expect(body.status).toBe('ok')
  })

  it('validates the queue health route against the shared health schema', async () => {
    const response = await request(getHttpServer()).get('/api/v1/health/queues')

    expect(response.status).toBe(200)
    const body = queueHealthResponseSchema.parse(response.body)
    expect(body.status).toBe('ok')
    expect(body.queues).toEqual(queueConfigs.map((queue) => queue.name))
  })

  it('validates the poll route against the shared events schema', async () => {
    prismaEventFindManyMock.mockResolvedValue([
      {
        id: 'evt-1',
        channel: 'alerts',
        payload: { severity: 'warning' },
        user_id: 'guardian-1',
        created_at: new Date('2026-03-04T10:00:00.000Z'),
      },
    ])

    const response = await request(getHttpServer()).get('/api/v1/events/poll')

    expect(response.status).toBe(200)
    const body = eventsPollResponseSchema.parse(response.body)
    expect(body.events).toHaveLength(1)
    expect(body.nextSince).toBe('2026-03-04T10:00:00.000Z')
  })

  it('validates invalid poll cursors against the shared graceful-error schema', async () => {
    const response = await request(getHttpServer()).get(
      '/api/v1/events/poll?since=not-a-date'
    )

    expect(response.status).toBe(200)
    const body = eventsPollInvalidSinceResponseSchema.parse(response.body)
    expect(body.error).toBe('Invalid since timestamp')
    expect(prismaEventFindManyMock).not.toHaveBeenCalled()
  })

  it('validates unauthorized profile requests against the shared error schema', async () => {
    const response = await request(getHttpServer()).get('/api/v1/user/profile')

    expect(response.status).toBe(401)
    unauthorizedHttpErrorSchema.parse(response.body)
  })

  it('validates the authenticated profile route against the shared user schema', async () => {
    const teen = createTeenProfileFixture()
    const guardian = createGuardianProfileFixture({
      id: 'guardian-2',
      email: 'guardian2@example.com',
      displayName: 'Jordan Casey',
    })
    prismaUserFindUniqueMock.mockResolvedValue(
      buildPrismaUserProfileFixture(
        teen,
        [buildLinkedGuardianRole(guardian, DEFAULT_CONSENT_GRANTED_AT)],
        []
      )
    )

    const response = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders(teen.id, 'teen'))

    expect(response.status).toBe(200)
    const body = userProfileResponseSchema.parse(response.body)
    expect(body.user.id).toBe(teen.id)
    expect(body.linkedGuardians).toHaveLength(1)
    expect(body.linkedGuardians[0]).toEqual(
      buildLinkedGuardianResponse(guardian, DEFAULT_CONSENT_GRANTED_AT)
    )
  })

  it('validates missing profiles against the shared not-found schema', async () => {
    prismaUserFindUniqueMock.mockResolvedValue(null)

    const response = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders('missing-user', 'guardian'))

    expect(response.status).toBe(404)
    notFoundHttpErrorSchema.parse(response.body)
  })
})
