import type { GarmentItem, Prisma, PrismaClient } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export const WARDROBE_CATEGORIES = [
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory',
] as const

export const WARDROBE_MATERIALS = [
  'cotton',
  'wool',
  'synthetic',
  'denim',
  'leather',
  'linen',
] as const

export const WARDROBE_COMFORT_RANGES = ['cold', 'cool', 'mild', 'warm', 'hot'] as const

export type WardrobeCategory = (typeof WARDROBE_CATEGORIES)[number]
export type WardrobeMaterial = (typeof WARDROBE_MATERIALS)[number]
export type WardrobeComfortRange = (typeof WARDROBE_COMFORT_RANGES)[number]

export interface WardrobeItemFixture {
  id: string
  userId: string
  objectPath?: string
  imageUrl: string
  category: WardrobeCategory
  material: WardrobeMaterial
  comfortRange: WardrobeComfortRange
  colorPalette: string[]
  createdAt: Date
  updatedAt: Date
}

export interface WardrobeItemFactoryOverrides
  extends Partial<Omit<WardrobeItemFixture, 'colorPalette'>> {
  colorPalette?: string[]
}

type PersistWardrobeItemPrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedWardrobeItemOptions {
  persist: true
  prisma: PersistWardrobeItemPrismaClient
}

export type PersistedWardrobeItemFixture = GarmentItem

const mergeWardrobeItemFixture = createFactory<WardrobeItemFixture>(
  buildDefaultWardrobeItemFixture
)

function buildDefaultColorPalette(): string[] {
  return faker.helpers.arrayElements(
    [
      '#111111',
      '#C9A14A',
      '#7E889A',
      '#B1683A',
      '#0D6F62',
      '#F29BA8',
      '#8C5331',
      '#1F4E79',
    ],
    3
  )
}

function buildDefaultWardrobeItemFixture(): WardrobeItemFixture {
  const id = faker.string.uuid()
  const userId = faker.string.uuid()
  return {
    id,
    userId,
    objectPath: `wardrobe/${userId}/${id}.png`,
    imageUrl: faker.image.url(),
    category: faker.helpers.arrayElement(WARDROBE_CATEGORIES),
    material: faker.helpers.arrayElement(WARDROBE_MATERIALS),
    comfortRange: faker.helpers.arrayElement(WARDROBE_COMFORT_RANGES),
    colorPalette: buildDefaultColorPalette(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function composeWardrobeItemFixture(
  overrides: WardrobeItemFactoryOverrides = {}
): WardrobeItemFixture {
  return mergeWardrobeItemFixture(overrides)
}

export function buildWardrobeItemCreateInput(
  fixture: WardrobeItemFixture
): Prisma.GarmentItemCreateInput {
  return {
    id: fixture.id,
    object_path: fixture.objectPath ?? `wardrobe/${fixture.userId}/${fixture.id}.png`,
    image_url: fixture.imageUrl,
    category: fixture.category,
    material: fixture.material,
    comfort_range: fixture.comfortRange,
    color_palette: fixture.colorPalette as Prisma.InputJsonArray,
    upload_status: 'ready',
    retention_status: 'active',
    user: {
      connect: {
        id: fixture.userId,
      },
    },
  }
}

export async function persistWardrobeItem(
  prisma: PersistWardrobeItemPrismaClient,
  fixture: WardrobeItemFixture
): Promise<PersistedWardrobeItemFixture> {
  const wardrobeItem = await prisma.garmentItem.create({
    data: buildWardrobeItemCreateInput(fixture),
  })

  registerCreatedEntity('wardrobeItems', wardrobeItem.id)

  return wardrobeItem
}

function maybePersistWardrobeItem(
  fixture: WardrobeItemFixture,
  options?: CreatePersistedWardrobeItemOptions
): WardrobeItemFixture | Promise<PersistedWardrobeItemFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistWardrobeItem(options.prisma, fixture)
}

export function createWardrobeItem(
  overrides?: WardrobeItemFactoryOverrides
): WardrobeItemFixture
export function createWardrobeItem(
  overrides: WardrobeItemFactoryOverrides | undefined,
  options: CreatePersistedWardrobeItemOptions
): Promise<PersistedWardrobeItemFixture>
export function createWardrobeItem(
  overrides: WardrobeItemFactoryOverrides = {},
  options?: CreatePersistedWardrobeItemOptions
): WardrobeItemFixture | Promise<PersistedWardrobeItemFixture> {
  return maybePersistWardrobeItem(composeWardrobeItemFixture(overrides), options)
}
