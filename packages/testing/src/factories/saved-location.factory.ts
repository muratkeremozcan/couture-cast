import type { Prisma, PrismaClient, SavedLocation } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export interface SavedLocationFixture {
  id: string
  userId: string
  label: string
  locationKey: string
  latitude: number
  longitude: number
  timezone: string
  city: string | null
  region: string | null
  country: string | null
  isPrimary: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type SavedLocationFactoryOverrides = Partial<SavedLocationFixture>

type PersistSavedLocationPrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedSavedLocationOptions {
  persist: true
  prisma: PersistSavedLocationPrismaClient
}

export type PersistedSavedLocationFixture = SavedLocation

const mergeSavedLocationFixture = createFactory<SavedLocationFixture>(
  buildDefaultSavedLocationFixture
)

function slugifyLocation(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function buildDefaultSavedLocationFixture(): SavedLocationFixture {
  const city = faker.location.city()
  const region = faker.location.state({ abbreviated: true })
  const now = new Date()

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    label: city,
    locationKey: slugifyLocation(`${city}-${region}`),
    latitude: Number(faker.location.latitude({ min: -90, max: 90 }).toFixed(3)),
    longitude: Number(faker.location.longitude({ min: -180, max: 180 }).toFixed(3)),
    timezone: 'UTC',
    city,
    region,
    country: 'US',
    isPrimary: false,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function composeSavedLocationFixture(
  overrides: SavedLocationFactoryOverrides = {}
): SavedLocationFixture {
  return mergeSavedLocationFixture(overrides)
}

export function buildSavedLocationCreateInput(
  fixture: SavedLocationFixture
): Prisma.SavedLocationUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    label: fixture.label,
    location_key: fixture.locationKey,
    latitude: fixture.latitude,
    longitude: fixture.longitude,
    timezone: fixture.timezone,
    city: fixture.city,
    region: fixture.region,
    country: fixture.country,
    is_primary: fixture.isPrimary,
    sort_order: fixture.sortOrder,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistSavedLocation(
  prisma: PersistSavedLocationPrismaClient,
  fixture: SavedLocationFixture
): Promise<PersistedSavedLocationFixture> {
  const savedLocation = await prisma.savedLocation.create({
    data: buildSavedLocationCreateInput(fixture),
  })

  registerCreatedEntity('savedLocations', savedLocation.id)

  return savedLocation
}

function maybePersistSavedLocation(
  fixture: SavedLocationFixture,
  options?: CreatePersistedSavedLocationOptions
): SavedLocationFixture | Promise<PersistedSavedLocationFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistSavedLocation(options.prisma, fixture)
}

export function createSavedLocation(
  overrides?: SavedLocationFactoryOverrides
): SavedLocationFixture
export function createSavedLocation(
  overrides: SavedLocationFactoryOverrides | undefined,
  options: CreatePersistedSavedLocationOptions
): Promise<PersistedSavedLocationFixture>
export function createSavedLocation(
  overrides: SavedLocationFactoryOverrides = {},
  options?: CreatePersistedSavedLocationOptions
): SavedLocationFixture | Promise<PersistedSavedLocationFixture> {
  return maybePersistSavedLocation(composeSavedLocationFixture(overrides), options)
}
