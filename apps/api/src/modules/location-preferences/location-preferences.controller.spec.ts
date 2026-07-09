import 'reflect-metadata'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
  setPrimarySavedLocationResponseSchema,
  updateSavedLocationResponseSchema,
} from '@couture/api-client/contracts/http'

import { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../auth/security.guards'
import { LocationPreferencesController } from './location-preferences.controller'
import { LocationPreferencesService } from './location-preferences.service'

const authHeaders = {
  authorization: 'Bearer location-token',
  'x-user-id': 'user-1',
  'x-user-role': 'user',
}

const savedLocation = {
  id: 'location-1',
  label: 'Home',
  locationKey: 'chicago-il',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'IL',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-07-09T12:00:00.000Z',
  updatedAt: '2026-07-09T12:00:00.000Z',
}

describe('LocationPreferencesController', () => {
  let app: INestApplication | undefined
  const service = {
    createLocation: vi.fn().mockResolvedValue(savedLocation),
    deleteLocation: vi.fn().mockResolvedValue({ deleted: true }),
    listLocations: vi.fn().mockResolvedValue([savedLocation]),
    setPrimary: vi.fn().mockResolvedValue(savedLocation),
    updateLocation: vi.fn().mockResolvedValue({ ...savedLocation, label: 'Office' }),
  }

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    vi.spyOn(RequestAuthGuard.prototype, 'canActivate').mockImplementation((context) => {
      const requestContext = context.switchToHttp().getRequest<{
        auth?: { token: string; userId: string; role: 'user' }
        headers: Record<string, string | string[] | undefined>
      }>()
      const authorization = requestContext.headers.authorization
      const userId = requestContext.headers['x-user-id']
      const role = requestContext.headers['x-user-role']

      if (
        typeof authorization !== 'string' ||
        !authorization.startsWith('Bearer ') ||
        typeof userId !== 'string' ||
        userId.trim().length === 0 ||
        role !== 'user'
      ) {
        throw new UnauthorizedException('Missing or invalid authentication headers')
      }

      requestContext.auth = {
        token: authorization.slice('Bearer '.length).trim(),
        userId,
        role,
      }

      return Promise.resolve(true)
    })

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LocationPreferencesController],
      providers: [
        {
          provide: LocationPreferencesService,
          useValue: service,
        },
        {
          provide: GuardianConsentStateService,
          useValue: {
            canTeenAccess: vi.fn().mockResolvedValue(true),
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
    service.createLocation.mockClear()
    service.deleteLocation.mockClear()
    service.listLocations.mockClear()
    service.setPrimary.mockClear()
    service.updateLocation.mockClear()

    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('requires auth and lists saved locations for the authenticated user', async () => {
    const unauthorizedResponse = await request(getHttpServer()).get('/api/v1/locations')

    expect(unauthorizedResponse.status).toBe(401)

    const response = await request(getHttpServer())
      .get('/api/v1/locations')
      .set(authHeaders)

    expect(response.status).toBe(200)
    expect(listSavedLocationsResponseSchema.parse(response.body)).toEqual({
      data: [savedLocation],
    })
    expect(service.listLocations).toHaveBeenCalledWith('user-1')
  })

  it('creates, updates, and sets primary without accepting client ownership', async () => {
    const createResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(authHeaders)
      .send({
        userId: 'malicious-user',
        label: 'Home',
        locationKey: 'chicago-il',
        latitude: 41.8781,
        longitude: -87.6298,
        timezone: 'America/Chicago',
      })

    expect(createResponse.status).toBe(400)

    const validCreateResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(authHeaders)
      .send({
        label: 'Home',
        locationKey: 'chicago-il',
        latitude: 41.8781,
        longitude: -87.6298,
        timezone: 'America/Chicago',
        city: 'Chicago',
        region: 'IL',
        country: 'US',
      })

    expect(validCreateResponse.status).toBe(201)
    expect(createSavedLocationResponseSchema.parse(validCreateResponse.body)).toEqual({
      data: savedLocation,
    })
    expect(service.createLocation).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ locationKey: 'chicago-il' })
    )

    const patchResponse = await request(getHttpServer())
      .patch('/api/v1/locations/location-1')
      .set(authHeaders)
      .send({
        label: 'Office',
      })

    expect(patchResponse.status).toBe(200)
    expect(updateSavedLocationResponseSchema.parse(patchResponse.body)).toEqual({
      data: { ...savedLocation, label: 'Office' },
    })
    expect(service.updateLocation).toHaveBeenCalledWith(
      'user-1',
      'location-1',
      expect.objectContaining({ label: 'Office' })
    )

    const primaryResponse = await request(getHttpServer())
      .post('/api/v1/locations/location-1/primary')
      .set(authHeaders)

    expect(primaryResponse.status).toBe(200)
    expect(setPrimarySavedLocationResponseSchema.parse(primaryResponse.body)).toEqual({
      data: savedLocation,
    })
    expect(service.setPrimary).toHaveBeenCalledWith('user-1', 'location-1')
  })
})
