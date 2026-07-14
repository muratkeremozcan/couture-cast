import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
} from '@couture/api-client/contracts/http'

import type { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import { LocationPreferencesController } from '../src/modules/location-preferences/location-preferences.controller'
import {
  PrismaLocationPreferencesRepository,
  type CreateSavedLocationCommand,
  type LocationPreferencesRepository,
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type SavedLocationRecord,
  type UpdateSavedLocationCommand,
} from '../src/modules/location-preferences/location-preferences.repository'
import { LocationPreferencesService } from '../src/modules/location-preferences/location-preferences.service'

const primaryUserHeaders = {
  authorization: 'Bearer location-token',
}

const foreignUserHeaders = {
  authorization: 'Bearer foreign-location-token',
}

function createLocationRequestAuthGuard(identities: Record<string, string>) {
  const guardianConsentStateService = {
    canTeenAccess: vi.fn().mockResolvedValue(true),
  } as unknown as GuardianConsentStateService
  const accessTokenIdentityService = {
    resolveIdentity: vi.fn((token: string) => {
      const userId = identities[token]
      return userId
        ? Promise.resolve({ userId, role: 'guardian' as const })
        : Promise.reject(new Error('Unknown test access token'))
    }),
  } as unknown as AccessTokenIdentityService

  return {
    guardianConsentStateService,
    guard: new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService),
  }
}

class InMemoryLocationPreferencesRepository implements LocationPreferencesRepository {
  private readonly locations: SavedLocationRecord[] = []

  create(
    userId: string,
    command: CreateSavedLocationCommand
  ): Promise<SavedLocationRecord> {
    const userLocations = this.locations.filter((location) => location.user_id === userId)
    if (userLocations.some((location) => location.location_key === command.locationKey)) {
      return Promise.reject(new SavedLocationDuplicateError())
    }
    if (userLocations.length >= 3) {
      return Promise.reject(new SavedLocationLimitExceededError())
    }

    const now = new Date('2026-07-09T12:00:00.000Z')
    const location: SavedLocationRecord = {
      id: `location-${this.locations.length + 1}`,
      user_id: userId,
      label: command.label,
      location_key: command.locationKey,
      latitude: command.latitude,
      longitude: command.longitude,
      timezone: command.timezone,
      city: command.city ?? null,
      region: command.region ?? null,
      country: command.country ?? null,
      is_primary: userLocations.length === 0,
      sort_order: userLocations.length,
      created_at: now,
      updated_at: now,
    }

    this.locations.push(location)

    return Promise.resolve(location)
  }

  delete(userId: string, locationId: string): Promise<SavedLocationRecord | null> {
    const index = this.locations.findIndex(
      (location) => location.user_id === userId && location.id === locationId
    )

    if (index === -1) {
      return Promise.resolve(null)
    }

    const [deleted] = this.locations.splice(index, 1)
    if (!deleted) {
      return Promise.resolve(null)
    }

    if (deleted.is_primary) {
      const nextPrimary = this.locations
        .filter((location) => location.user_id === userId)
        .sort(
          (left, right) =>
            left.sort_order - right.sort_order ||
            left.created_at.getTime() - right.created_at.getTime() ||
            left.id.localeCompare(right.id)
        )[0]

      if (nextPrimary) {
        nextPrimary.is_primary = true
      }
    }

    return Promise.resolve(deleted)
  }

  findByIdForUser(
    userId: string,
    locationId: string
  ): Promise<SavedLocationRecord | null> {
    return Promise.resolve(
      this.locations.find(
        (location) => location.user_id === userId && location.id === locationId
      ) ?? null
    )
  }

  findByLocationKeyForUser(
    userId: string,
    locationKey: string
  ): Promise<SavedLocationRecord | null> {
    return Promise.resolve(
      this.locations.find(
        (location) => location.user_id === userId && location.location_key === locationKey
      ) ?? null
    )
  }

  findManyByUserId(userId: string): Promise<SavedLocationRecord[]> {
    return Promise.resolve(
      this.locations
        .filter((location) => location.user_id === userId)
        .sort(
          (left, right) =>
            left.sort_order - right.sort_order ||
            left.created_at.getTime() - right.created_at.getTime() ||
            left.id.localeCompare(right.id)
        )
    )
  }

  async setPrimary(
    userId: string,
    locationId: string
  ): Promise<SavedLocationRecord | null> {
    const location = await this.findByIdForUser(userId, locationId)
    if (!location) {
      return null
    }

    for (const savedLocation of this.locations) {
      if (savedLocation.user_id === userId) {
        savedLocation.is_primary = savedLocation.id === locationId
      }
    }

    return location
  }

  async update(
    userId: string,
    locationId: string,
    command: UpdateSavedLocationCommand
  ): Promise<SavedLocationRecord | null> {
    const location = await this.findByIdForUser(userId, locationId)
    if (!location) {
      return null
    }

    if (command.label !== undefined) {
      location.label = command.label
    }
    if (command.locationKey !== undefined) {
      location.location_key = command.locationKey
    }
    if (command.latitude !== undefined) {
      location.latitude = command.latitude
    }
    if (command.longitude !== undefined) {
      location.longitude = command.longitude
    }
    if (command.timezone !== undefined) {
      location.timezone = command.timezone
    }
    if (command.city !== undefined) {
      location.city = command.city
    }
    if (command.region !== undefined) {
      location.region = command.region
    }
    if (command.country !== undefined) {
      location.country = command.country
    }
    if (command.sortOrder !== undefined) {
      location.sort_order = command.sortOrder
    }

    return location
  }
}

function createLocationInput(label: string, locationKey: string) {
  return {
    label,
    locationKey,
    latitude: 41.8781,
    longitude: -87.6298,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'IL',
    country: 'US',
  }
}

describe('Location preferences API integration', () => {
  let app: INestApplication | undefined

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    const auth = createLocationRequestAuthGuard({
      'foreign-location-token': 'user-2',
      'location-token': 'user-1',
    })

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LocationPreferencesController],
      providers: [
        {
          provide: PrismaLocationPreferencesRepository,
          useClass: InMemoryLocationPreferencesRepository,
        },
        LocationPreferencesService,
        {
          provide: GuardianConsentStateService,
          useValue: auth.guardianConsentStateService,
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(auth.guard)
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

  it('enforces max-three, duplicate keys, ownership, and primary promotion over HTTP', async () => {
    const firstResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryUserHeaders)
      .send(createLocationInput('Home', 'chicago-il'))

    expect(firstResponse.status).toBe(201)
    const firstLocation = createSavedLocationResponseSchema.parse(firstResponse.body).data
    expect(firstLocation.locationKey).toBe('chicago-il')
    expect(firstLocation.isPrimary).toBe(true)

    for (const [label, key] of [
      ['Office', 'office'],
      ['Gym', 'gym'],
    ] as const) {
      const response = await request(getHttpServer())
        .post('/api/v1/locations')
        .set(primaryUserHeaders)
        .send(createLocationInput(label, key))

      expect(response.status).toBe(201)
    }

    const duplicateResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryUserHeaders)
      .send(createLocationInput('Duplicate', 'office'))

    expect(duplicateResponse.status).toBe(400)

    const fourthResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryUserHeaders)
      .send(createLocationInput('Airport', 'airport'))

    expect(fourthResponse.status).toBe(400)

    const foreignPrimaryResponse = await request(getHttpServer())
      .post(`/api/v1/locations/${firstLocation.id}/primary`)
      .set(foreignUserHeaders)

    expect(foreignPrimaryResponse.status).toBe(404)

    const primaryResponse = await request(getHttpServer())
      .post('/api/v1/locations/location-2/primary')
      .set(primaryUserHeaders)

    expect(primaryResponse.status).toBe(200)

    const deletePrimaryResponse = await request(getHttpServer())
      .delete('/api/v1/locations/location-2')
      .set(primaryUserHeaders)

    expect(deletePrimaryResponse.status).toBe(200)

    const listResponse = await request(getHttpServer())
      .get('/api/v1/locations')
      .set(primaryUserHeaders)

    expect(listResponse.status).toBe(200)
    const locations = listSavedLocationsResponseSchema.parse(listResponse.body).data
    expect(locations).toHaveLength(2)
    expect(locations[0]?.isPrimary).toBe(true)
    expect(locations[0]?.id).toBe(firstLocation.id)
  })
})

const describeRealDatabase =
  process.env.LOCATION_PREFERENCES_REAL_DB_INTEGRATION === 'true'
    ? describe
    : describe.skip

describeRealDatabase('Location preferences API Prisma integration', () => {
  let app: INestApplication | undefined
  let prisma: PrismaClient | undefined
  let primaryUserId: string
  let foreignUserId: string

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    prisma = new PrismaClient()
    primaryUserId = `real-location-user-${randomUUID()}`
    foreignUserId = `real-location-foreign-${randomUUID()}`
    const auth = createLocationRequestAuthGuard({
      'real-location-foreign-token': foreignUserId,
      'real-location-token': primaryUserId,
    })

    await prisma.user.createMany({
      data: [
        {
          id: primaryUserId,
          email: `${primaryUserId}@example.com`,
        },
        {
          id: foreignUserId,
          email: `${foreignUserId}@example.com`,
        },
      ],
    })

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LocationPreferencesController],
      providers: [
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        PrismaLocationPreferencesRepository,
        LocationPreferencesService,
        {
          provide: GuardianConsentStateService,
          useValue: auth.guardianConsentStateService,
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(auth.guard)
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

    if (prisma) {
      await prisma.savedLocation.deleteMany({
        where: { user_id: { in: [primaryUserId, foreignUserId] } },
      })
      await prisma.user.deleteMany({
        where: { id: { in: [primaryUserId, foreignUserId] } },
      })
      await prisma.$disconnect()
      prisma = undefined
    }
  })

  it('enforces real database limits, uniqueness, ownership, and primary promotion over HTTP', async () => {
    const primaryHeaders = {
      authorization: 'Bearer real-location-token',
    }
    const foreignHeaders = {
      authorization: 'Bearer real-location-foreign-token',
    }

    const firstResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryHeaders)
      .send(createLocationInput('Home', 'chicago-il'))

    expect(firstResponse.status).toBe(201)
    const firstLocation = createSavedLocationResponseSchema.parse(firstResponse.body).data
    expect(firstLocation.locationKey).toBe('chicago-il')
    expect(firstLocation.isPrimary).toBe(true)

    const whitespaceTimezoneResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryHeaders)
      .send({
        ...createLocationInput('Blank zone', 'blank-zone'),
        timezone: '   ',
      })

    expect(whitespaceTimezoneResponse.status).toBe(400)

    const partialIdentityResponse = await request(getHttpServer())
      .patch(`/api/v1/locations/${firstLocation.id}`)
      .set(primaryHeaders)
      .send({ locationKey: 'new-york-ny' })

    expect(partialIdentityResponse.status).toBe(400)

    const patchPrimaryResponse = await request(getHttpServer())
      .patch(`/api/v1/locations/${firstLocation.id}`)
      .set(primaryHeaders)
      .send({ isPrimary: true })

    expect(patchPrimaryResponse.status).toBe(400)

    for (const [label, key] of [
      ['Office', 'office'],
      ['Gym', 'gym'],
    ] as const) {
      const response = await request(getHttpServer())
        .post('/api/v1/locations')
        .set(primaryHeaders)
        .send(createLocationInput(label, key))

      expect(response.status).toBe(201)
    }

    const duplicateResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryHeaders)
      .send(createLocationInput('Duplicate', 'office'))

    expect(duplicateResponse.status).toBe(400)

    const fourthResponse = await request(getHttpServer())
      .post('/api/v1/locations')
      .set(primaryHeaders)
      .send(createLocationInput('Airport', 'airport'))

    expect(fourthResponse.status).toBe(400)

    const foreignPrimaryResponse = await request(getHttpServer())
      .post(`/api/v1/locations/${firstLocation.id}/primary`)
      .set(foreignHeaders)

    expect(foreignPrimaryResponse.status).toBe(404)

    const listResponse = await request(getHttpServer())
      .get('/api/v1/locations')
      .set(primaryHeaders)

    expect(listResponse.status).toBe(200)
    const locations = listSavedLocationsResponseSchema.parse(listResponse.body).data
    const officeLocation = locations.find((location) => location.locationKey === 'office')
    if (!officeLocation) {
      throw new Error('Expected office saved location to exist')
    }

    const primaryResponse = await request(getHttpServer())
      .post(`/api/v1/locations/${officeLocation.id}/primary`)
      .set(primaryHeaders)

    expect(primaryResponse.status).toBe(200)

    const deletePrimaryResponse = await request(getHttpServer())
      .delete(`/api/v1/locations/${officeLocation.id}`)
      .set(primaryHeaders)

    expect(deletePrimaryResponse.status).toBe(200)

    const promotedListResponse = await request(getHttpServer())
      .get('/api/v1/locations')
      .set(primaryHeaders)

    expect(promotedListResponse.status).toBe(200)
    const promotedLocations = listSavedLocationsResponseSchema.parse(
      promotedListResponse.body
    ).data
    expect(promotedLocations).toHaveLength(2)
    expect(promotedLocations[0]?.id).toBe(firstLocation.id)
    expect(promotedLocations[0]?.isPrimary).toBe(true)
  })
})
