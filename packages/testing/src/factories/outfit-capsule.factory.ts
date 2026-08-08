import type {
  CapsuleOccasion,
  OutfitCapsule,
  OutfitCapsuleGarment,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export const CAPSULE_OCCASIONS = [
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
] as const

export interface OutfitCapsuleGarmentFixture {
  id: string
  userId: string
  capsuleId: string
  garmentId: string
  garmentOrder: number
  createdAt: Date
}

export interface OutfitCapsuleFixture {
  id: string
  userId: string
  name: string
  description: string | null
  occasions: CapsuleOccasion[]
  isFavorite: boolean
  revision: number
  idempotencyKey: string | null
  idempotencyPayloadHash: string | null
  createdAt: Date
  updatedAt: Date
  garments: OutfitCapsuleGarmentFixture[]
}

export interface OutfitCapsuleFactoryOverrides
  extends Partial<Omit<OutfitCapsuleFixture, 'garments'>> {
  garments?: OutfitCapsuleGarmentFixture[]
  garmentIds?: string[]
}

type PersistOutfitCapsulePrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedOutfitCapsuleOptions {
  persist: true
  prisma: PersistOutfitCapsulePrismaClient
}

export type PersistedOutfitCapsuleFixture = OutfitCapsule & {
  garment_joins: OutfitCapsuleGarment[]
}

const mergeOutfitCapsuleFixture = createFactory<OutfitCapsuleFixture>(
  buildDefaultOutfitCapsuleFixture
)

function buildDefaultOutfitCapsuleFixture(): OutfitCapsuleFixture {
  const id = faker.string.uuid()
  const userId = faker.string.uuid()
  const garmentIds = [faker.string.uuid(), faker.string.uuid()]

  return {
    id,
    userId,
    name: 'Default Capsule',
    description: 'Test outfit capsule',
    occasions: ['casual'],
    isFavorite: false,
    revision: 0,
    idempotencyKey: null,
    idempotencyPayloadHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    garments: garmentIds.map((garmentId, index) => ({
      id: faker.string.uuid(),
      userId,
      capsuleId: id,
      garmentId,
      garmentOrder: index,
      createdAt: new Date(),
    })),
  }
}

function composeOutfitCapsuleFixture(
  overrides: OutfitCapsuleFactoryOverrides = {}
): OutfitCapsuleFixture {
  const base = mergeOutfitCapsuleFixture(overrides)
  if (overrides.garmentIds) {
    base.garments = overrides.garmentIds.map((garmentId, index) => ({
      id: faker.string.uuid(),
      userId: base.userId,
      capsuleId: base.id,
      garmentId,
      garmentOrder: index,
      createdAt: new Date(),
    }))
  }
  return base
}

export async function persistOutfitCapsule(
  prisma: PersistOutfitCapsulePrismaClient,
  fixture: OutfitCapsuleFixture
): Promise<PersistedOutfitCapsuleFixture> {
  const capsule = await prisma.outfitCapsule.create({
    data: {
      id: fixture.id,
      user_id: fixture.userId,
      name: fixture.name,
      description: fixture.description,
      occasions: fixture.occasions,
      is_favorite: fixture.isFavorite,
      revision: fixture.revision,
      idempotency_key: fixture.idempotencyKey,
      idempotency_payload_hash: fixture.idempotencyPayloadHash,
      garment_joins: {
        create: fixture.garments.map((g) => ({
          id: g.id,
          user_id: g.userId,
          garment_id: g.garmentId,
          garment_order: g.garmentOrder,
        })),
      },
    },
    include: {
      garment_joins: true,
    },
  })

  registerCreatedEntity('outfitCapsules', capsule.id)
  for (const join of capsule.garment_joins) {
    registerCreatedEntity('outfitCapsuleGarments', join.id)
  }

  return capsule
}

function maybePersistOutfitCapsule(
  fixture: OutfitCapsuleFixture,
  options?: CreatePersistedOutfitCapsuleOptions
): OutfitCapsuleFixture | Promise<PersistedOutfitCapsuleFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistOutfitCapsule(options.prisma, fixture)
}

export function createOutfitCapsule(
  overrides?: OutfitCapsuleFactoryOverrides
): OutfitCapsuleFixture
export function createOutfitCapsule(
  overrides: OutfitCapsuleFactoryOverrides | undefined,
  options: CreatePersistedOutfitCapsuleOptions
): Promise<PersistedOutfitCapsuleFixture>
export function createOutfitCapsule(
  overrides: OutfitCapsuleFactoryOverrides = {},
  options?: CreatePersistedOutfitCapsuleOptions
): OutfitCapsuleFixture | Promise<PersistedOutfitCapsuleFixture> {
  return maybePersistOutfitCapsule(composeOutfitCapsuleFixture(overrides), options)
}
