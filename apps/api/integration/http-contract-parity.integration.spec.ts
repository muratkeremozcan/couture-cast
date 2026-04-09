import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
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
import { ApiHealthController } from '../src/controllers/api-health.controller'
import { HealthController } from '../src/controllers/health.controller'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import { EventsController } from '../src/modules/events/events.controller'
import { EventsRepository } from '../src/modules/events/events.repository'
import { EventsService } from '../src/modules/events/events.service'
import { UserController } from '../src/modules/user/user.controller'
import { UserService } from '../src/modules/user/user.service'

const { prismaEventFindManyMock, prismaUserFindUniqueMock } = vi.hoisted(() => ({
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
        RequestAuthGuard,
        {
          provide: PrismaClient,
          useValue: prisma,
        },
      ],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
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
    expect(body.queues.length).toBeGreaterThan(0)
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
    prismaUserFindUniqueMock.mockResolvedValue({
      id: 'teen-4',
      email: 'teen4@example.com',
      profile: {
        display_name: 'Taylor Brooks',
        birthdate: new Date('2009-03-04T00:00:00.000Z'),
      },
      teen_roles: [
        {
          guardian_id: 'guardian-2',
          status: 'granted',
          consent_granted_at: new Date('2026-03-04T10:00:00.000Z'),
        },
      ],
      guardian_roles: [],
    })

    const response = await request(getHttpServer())
      .get('/api/v1/user/profile')
      .set(createHeaders('teen-4', 'teen'))

    expect(response.status).toBe(200)
    const body = userProfileResponseSchema.parse(response.body)
    expect(body.user.id).toBe('teen-4')
    expect(body.linkedGuardians).toHaveLength(1)
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
