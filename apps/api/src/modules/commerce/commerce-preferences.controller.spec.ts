import { Test, type TestingModule } from '@nestjs/testing'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockPrisma, type MockPrisma } from '../../testing/prisma-mock.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { CommercePreferencesController } from './commerce-preferences.controller.js'
import { CommercePreferencesService } from './commerce-preferences.service.js'
import { CommerceRepository } from './commerce.repository.js'

/**
 * These assertions go over real HTTP through a Nest `TestingModule` rather than
 * through a hand-built response double. Story 4.4 shipped a status-code fix
 * whose unit test spied on a mock `res` and stayed green when the controller was
 * reverted; the preference endpoints carry the same class of behaviour (an
 * unchanged PUT must still be a 200 with a body) and get the same treatment.
 */
describe('CommercePreferencesController', () => {
  let app: INestApplication | undefined
  let prisma: MockPrisma

  const authenticatedUserId = 'user-1'

  beforeEach(async () => {
    prisma = createMockPrisma()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CommercePreferencesController],
      providers: [
        CommercePreferencesService,
        CommerceRepository,
        { provide: PrismaClient, useValue: prisma },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => AuthenticatedRequest }
        }) => {
          const req = context.switchToHttp().getRequest()
          if (req.headers.authorization !== 'Bearer commerce-token') {
            throw new UnauthorizedException('Missing or invalid bearer token')
          }
          req.auth = {
            token: 'commerce-token',
            userId: authenticatedUserId,
            role: 'teen',
          }
          return true
        },
      })
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  const server = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  const authorized = (path: string) =>
    request(server()).get(path).set({ authorization: 'Bearer commerce-token' })

  it('rejects an unauthenticated read', async () => {
    const response = await request(server()).get('/api/v1/commerce/preferences')

    expect(response.status).toBe(401)
  })

  it('reads a user with no stored row as enabled', async () => {
    prisma.commercePreference.findUnique.mockResolvedValue(null)

    const response = await authorized('/api/v1/commerce/preferences')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { affiliateCtasEnabled: true } })
  })

  it('reads the stored opted-out value', async () => {
    prisma.commercePreference.findUnique.mockResolvedValue({
      affiliate_ctas_enabled: false,
    })

    const response = await authorized('/api/v1/commerce/preferences')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { affiliateCtasEnabled: false } })
  })

  it('turns the preference off and writes one audit row', async () => {
    prisma.commercePreference.findUnique.mockResolvedValue({
      affiliate_ctas_enabled: true,
    })

    const response = await request(server())
      .put('/api/v1/commerce/preferences')
      .set({ authorization: 'Bearer commerce-token', 'x-forwarded-for': '203.0.113.7' })
      .send({ affiliateCtasEnabled: false })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { affiliateCtasEnabled: false } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        user_id: authenticatedUserId,
        event_type: 'commerce_affiliate_opt_out_changed',
        event_data: { enabled: false },
        ip_address: '203.0.113.7',
      },
    })
  })

  it('returns 200 with the current state and writes no audit row for an unchanged value', async () => {
    prisma.commercePreference.findUnique.mockResolvedValue({
      affiliate_ctas_enabled: false,
    })

    const response = await request(server())
      .put('/api/v1/commerce/preferences')
      .set({ authorization: 'Bearer commerce-token' })
      .send({ affiliateCtasEnabled: false })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: { affiliateCtasEnabled: false } })
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    expect(prisma.commercePreference.upsert).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'a missing field', body: {} },
    { name: 'a non-boolean value', body: { affiliateCtasEnabled: 'yes' } },
    {
      name: 'an unknown extra key',
      body: { affiliateCtasEnabled: true, partnerId: 'x' },
    },
  ])('rejects $name with 400 before touching the database', async ({ body }) => {
    const response = await request(server())
      .put('/api/v1/commerce/preferences')
      .set({ authorization: 'Bearer commerce-token' })
      .send(body)

    expect(response.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
