import type { OutfitRecommendation, Prisma, PrismaClient } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export const RITUAL_SCENARIOS = ['morning', 'midday', 'evening'] as const

export type RitualScenario = (typeof RITUAL_SCENARIOS)[number]

export interface RitualReasoningBadge {
  label: string
}

export interface RitualFixture {
  id: string
  userId: string
  forecastSegmentId: string | null
  scenario: RitualScenario
  garmentIds: string[]
  reasoningBadges: RitualReasoningBadge[]
  createdAt: Date
  updatedAt: Date
}

export interface RitualFactoryOverrides
  extends Partial<Omit<RitualFixture, 'garmentIds' | 'reasoningBadges'>> {
  garmentIds?: string[]
  reasoningBadges?: RitualReasoningBadge[]
}

type PersistRitualPrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedRitualOptions {
  persist: true
  prisma: PersistRitualPrismaClient
}

export type PersistedRitualFixture = OutfitRecommendation

const mergeRitualFixture = createFactory<RitualFixture>(buildDefaultRitualFixture)

function buildDefaultGarmentIds(): string[] {
  return Array.from({ length: 3 }, () => faker.string.uuid())
}

function buildDefaultReasoningBadges(): RitualReasoningBadge[] {
  return [{ label: 'weather-aware' }, { label: 'layered' }]
}

function buildDefaultRitualFixture(): RitualFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    forecastSegmentId: null,
    scenario: faker.helpers.arrayElement(RITUAL_SCENARIOS),
    garmentIds: buildDefaultGarmentIds(),
    reasoningBadges: buildDefaultReasoningBadges(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function composeRitualFixture(overrides: RitualFactoryOverrides = {}): RitualFixture {
  const defaults = buildDefaultRitualFixture()

  return mergeRitualFixture({
    ...defaults,
    ...overrides,
    garmentIds: overrides.garmentIds ?? defaults.garmentIds,
    reasoningBadges: overrides.reasoningBadges ?? defaults.reasoningBadges,
  })
}

export function buildRitualCreateInput(
  fixture: RitualFixture
): Prisma.OutfitRecommendationCreateInput {
  return {
    id: fixture.id,
    scenario: fixture.scenario,
    garment_ids: fixture.garmentIds as Prisma.InputJsonArray,
    reasoning_badges: fixture.reasoningBadges as unknown as Prisma.InputJsonArray,
    user: {
      connect: {
        id: fixture.userId,
      },
    },
    forecast_segment: fixture.forecastSegmentId
      ? {
          connect: {
            id: fixture.forecastSegmentId,
          },
        }
      : undefined,
  }
}

export async function persistRitual(
  prisma: PersistRitualPrismaClient,
  fixture: RitualFixture
): Promise<PersistedRitualFixture> {
  const ritual = await prisma.outfitRecommendation.create({
    data: buildRitualCreateInput(fixture),
  })

  registerCreatedEntity('rituals', ritual.id)

  return ritual
}

function maybePersistRitual(
  fixture: RitualFixture,
  options?: CreatePersistedRitualOptions
): RitualFixture | Promise<PersistedRitualFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistRitual(options.prisma, fixture)
}

export function createRitual(overrides?: RitualFactoryOverrides): RitualFixture
export function createRitual(
  overrides: RitualFactoryOverrides | undefined,
  options: CreatePersistedRitualOptions
): Promise<PersistedRitualFixture>
export function createRitual(
  overrides: RitualFactoryOverrides = {},
  options?: CreatePersistedRitualOptions
): RitualFixture | Promise<PersistedRitualFixture> {
  return maybePersistRitual(composeRitualFixture(overrides), options)
}
