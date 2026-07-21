// Story 2.2 Task 3 step 2 owner: integration-test controller endpoints and validation boundaries
import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
} from '../../contracts/http.js'
import type { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import type { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { ComfortController } from './comfort.controller.js'
import { ComfortService } from './comfort.service.js'
import { RitualService } from './ritual.service.js'
import { PrismaClient } from '@prisma/client'

describe('ComfortController', () => {
  let app: INestApplication | undefined
  let prismaMock: PrismaClient
  let ritualServiceMock: RitualService

  let findUniqueMock: ReturnType<typeof vi.fn>
  let upsertMock: ReturnType<typeof vi.fn>
  let invalidateUserCacheMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    findUniqueMock = vi.fn()
    upsertMock = vi.fn()
    invalidateUserCacheMock = vi.fn()

    prismaMock = {
      comfortPreferences: {
        findUnique: findUniqueMock,
        upsert: upsertMock,
      },
    } as unknown as PrismaClient

    ritualServiceMock = {
      invalidateUserCache: invalidateUserCacheMock,
    } as unknown as RitualService

    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService

    const accessTokenIdentityService = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'valid-token'
          ? Promise.resolve({ userId: 'user-123', role: 'guardian' as const })
          : Promise.reject(new Error('Invalid token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ComfortController],
      providers: [
        ComfortService,
        {
          provide: PrismaClient,
          useValue: prismaMock,
        },
        {
          provide: RitualService,
          useValue: ritualServiceMock,
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(
        new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
      )
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (app) {
      await app.close()
      app = undefined
    }
  })

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  describe('GET /api/v1/personalization/comfort', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await request(getHttpServer()).get(
        '/api/v1/personalization/comfort'
      )
      expect(response.status).toBe(401)
    })

    it('returns 200 with default comfort preferences when none exist in DB', async () => {
      findUniqueMock.mockResolvedValue(null)

      const response = await request(getHttpServer())
        .get('/api/v1/personalization/comfort')
        .set('Authorization', 'Bearer valid-token')

      expect(response.status).toBe(200)
      const body = comfortPreferencesResponseSchema.parse(response.body)
      expect(body.data).toEqual({
        runsColdWarm: 'neutral',
        windTolerance: 'medium',
        precipPreparedness: 'medium',
      })
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
      })
    })

    it('returns 200 with existing DB preferences', async () => {
      findUniqueMock.mockResolvedValue({
        id: 'pref-1',
        user_id: 'user-123',
        runs_cold_warm: 'cold',
        wind_tolerance: 'low',
        precip_preparedness: 'high',
      })

      const response = await request(getHttpServer())
        .get('/api/v1/personalization/comfort')
        .set('Authorization', 'Bearer valid-token')

      expect(response.status).toBe(200)
      const body = comfortPreferencesResponseSchema.parse(response.body)
      expect(body.data).toEqual({
        runsColdWarm: 'cold',
        windTolerance: 'low',
        precipPreparedness: 'high',
      })
    })
  })

  describe('PUT /api/v1/personalization/comfort', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await request(getHttpServer())
        .put('/api/v1/personalization/comfort')
        .send({
          runsColdWarm: 'warm',
          windTolerance: 'high',
          precipPreparedness: 'low',
        })
      expect(response.status).toBe(401)
    })

    it('returns 400 when payload is invalid/malformed', async () => {
      const response = await request(getHttpServer())
        .put('/api/v1/personalization/comfort')
        .set('Authorization', 'Bearer valid-token')
        .send({
          runsColdWarm: 'super-cold', // Invalid enum
          windTolerance: 'high',
        }) // Missing precipPreparedness

      expect(response.status).toBe(400)
    })

    it('returns 200 after successfully updating preferences and invalidating cache', async () => {
      upsertMock.mockResolvedValue({
        id: 'pref-1',
        user_id: 'user-123',
        runs_cold_warm: 'warm',
        wind_tolerance: 'high',
        precip_preparedness: 'low',
      })

      const response = await request(getHttpServer())
        .put('/api/v1/personalization/comfort')
        .set('Authorization', 'Bearer valid-token')
        .send({
          runsColdWarm: 'warm',
          windTolerance: 'high',
          precipPreparedness: 'low',
        })

      expect(response.status).toBe(200)
      const body = updateComfortPreferencesResponseSchema.parse(response.body)
      expect(body.data).toEqual({
        runsColdWarm: 'warm',
        windTolerance: 'high',
        precipPreparedness: 'low',
      })
      expect(upsertMock).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: {
          runs_cold_warm: 'warm',
          wind_tolerance: 'high',
          precip_preparedness: 'low',
        },
        create: {
          user_id: 'user-123',
          runs_cold_warm: 'warm',
          wind_tolerance: 'high',
          precip_preparedness: 'low',
        },
      })
      expect(invalidateUserCacheMock).toHaveBeenCalledWith('user-123')
    })
  })
})
