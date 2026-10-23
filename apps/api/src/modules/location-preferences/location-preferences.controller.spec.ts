import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSavedLocationFromSearchResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchResponseSchema,
  tooManyRequestsHttpErrorSchema,
  createSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
  setPrimarySavedLocationResponseSchema,
  updateSavedLocationResponseSchema,
} from '@couture/api-client/contracts/http'

import type { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../auth/security.guards'
import { LocationSearchRateLimitException } from './location-capture.errors'
import { LocationCaptureService } from './location-capture.service'
import { LocationPreferencesController } from './location-preferences.controller'
import { LocationPreferencesService } from './location-preferences.service'

const authHeaders = {
  authorization: 'Bearer location-token',
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

  const captureService = {
    search: vi.fn().mockResolvedValue([
      {
        city: 'Chicago',
        region: 'Illinois',
        country: 'US',
        latitude: 41.878,
        longitude: -87.63,
        displayLabel: 'Chicago, Illinois, United States',
        candidateToken: 'payload.signature',
      },
    ]),
    saveFromSearch: vi.fn().mockResolvedValue(savedLocation),
  }

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService
    const accessTokenIdentityService = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'location-token'
          ? Promise.resolve({ userId: 'user-1', role: 'guardian' as const })
          : Promise.reject(new Error('Unknown test access token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LocationPreferencesController],
      providers: [
        {
          provide: LocationPreferencesService,
          useValue: service,
        },
        {
          provide: LocationCaptureService,
          useValue: captureService,
        },
        {
          provide: GuardianConsentStateService,
          useValue: guardianConsentStateService,
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
    service.createLocation.mockClear()
    service.deleteLocation.mockClear()
    service.listLocations.mockClear()
    service.setPrimary.mockClear()
    service.updateLocation.mockClear()
    captureService.search.mockClear()
    captureService.saveFromSearch.mockClear()

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

  it('1.2b-API-01 searches with the validated query, locale and platform', async () => {
    const response = await request(getHttpServer())
      .get('/api/v1/locations/search')
      .query({ q: ' Chicago ', locale: 'fr-FR' })
      .set({ ...authHeaders, 'x-couture-platform': 'web' })

    expect(response.status).toBe(200)
    expect(locationSearchResponseSchema.parse(response.body).data).toHaveLength(1)
    expect(captureService.search).toHaveBeenCalledWith(
      'user-1',
      'Chicago',
      'fr-FR',
      'web'
    )
  })

  it.each([
    [{ q: 'C' }],
    [{ q: 'x'.repeat(81) }],
    [{}],
    [{ q: 'Chicago', locale: 'xx-XX' }],
    [{ q: 'Chicago', extra: '1' }],
  ])('1.2b-API-02 refuses %j with a typed 400 and no service call', async (query) => {
    const response = await request(getHttpServer())
      .get('/api/v1/locations/search')
      .query(query)
      .set({ ...authHeaders, 'x-couture-platform': 'web' })

    expect(response.status).toBe(400)
    expect(locationRequestErrorResponseSchema.parse(response.body).code).toBe(
      'invalid_request'
    )
    expect(captureService.search).not.toHaveBeenCalled()
  })

  it('1.2b-API-03 requires auth and the platform header on both new routes', async () => {
    expect(
      (await request(getHttpServer()).get('/api/v1/locations/search').query({ q: 'Ch' }))
        .status
    ).toBe(401)
    const missingPlatform = await request(getHttpServer())
      .post('/api/v1/locations/from-search')
      .set(authHeaders)
      .send({ candidateToken: 'payload.signature', label: 'Home' })

    expect(missingPlatform.status).toBe(400)
    expect(captureService.saveFromSearch).not.toHaveBeenCalled()
  })

  it('1.2b-API-04 sets Retry-After on the shared 429 body', async () => {
    captureService.search.mockRejectedValueOnce(new LocationSearchRateLimitException(17))

    const response = await request(getHttpServer())
      .get('/api/v1/locations/search')
      .query({ q: 'Chicago' })
      .set({ ...authHeaders, 'x-couture-platform': 'mobile' })

    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBe('17')
    expect(tooManyRequestsHttpErrorSchema.parse(response.body).statusCode).toBe(429)
  })

  it('1.2b-API-05 saves from search for the caller and refuses client-held fields', async () => {
    const response = await request(getHttpServer())
      .post('/api/v1/locations/from-search')
      .set({ ...authHeaders, 'x-couture-platform': 'mobile' })
      .send({ candidateToken: 'payload.signature', label: 'Home' })

    expect(response.status).toBe(201)
    expect(createSavedLocationFromSearchResponseSchema.parse(response.body).data).toEqual(
      savedLocation
    )
    expect(captureService.saveFromSearch).toHaveBeenCalledWith(
      'user-1',
      'payload.signature',
      'Home',
      'mobile'
    )

    for (const extra of [
      { latitude: 1 },
      { timezone: 'UTC' },
      { country: 'US' },
      { userId: 'other' },
    ]) {
      const refused = await request(getHttpServer())
        .post('/api/v1/locations/from-search')
        .set({ ...authHeaders, 'x-couture-platform': 'web' })
        .send({ candidateToken: 'payload.signature', label: 'Home', ...extra })
      expect(refused.status).toBe(400)
    }
    expect(captureService.saveFromSearch).toHaveBeenCalledTimes(1)
  })
})
