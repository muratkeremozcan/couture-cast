import type {
  Prisma,
  PrismaClient,
  WardrobeOnboardingState,
  WardrobeOnboardingStatus,
  WardrobeOnboardingStep,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export interface WardrobeOnboardingStateFixture {
  id: string
  userId: string
  status: WardrobeOnboardingStatus
  currentStep: WardrobeOnboardingStep
  usedStarterWardrobe: boolean
  garmentsCapturedCount: number
  startedAt: Date | null
  completedAt: Date | null
  revision: number
  createdAt: Date
  updatedAt: Date
}

export type WardrobeOnboardingStateFactoryOverrides =
  Partial<WardrobeOnboardingStateFixture>

type PersistWardrobeOnboardingStatePrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedWardrobeOnboardingStateOptions {
  persist: true
  prisma: PersistWardrobeOnboardingStatePrismaClient
}

export type PersistedWardrobeOnboardingStateFixture = WardrobeOnboardingState

const mergeWardrobeOnboardingStateFixture = createFactory<WardrobeOnboardingStateFixture>(
  buildDefaultWardrobeOnboardingStateFixture
)

function buildDefaultWardrobeOnboardingStateFixture(): WardrobeOnboardingStateFixture {
  const now = new Date()

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    status: 'in_progress',
    currentStep: 'silhouette',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 1,
    startedAt: now,
    completedAt: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export async function persistWardrobeOnboardingState(
  prisma: PersistWardrobeOnboardingStatePrismaClient,
  fixture: WardrobeOnboardingStateFixture
): Promise<PersistedWardrobeOnboardingStateFixture> {
  const state = await prisma.wardrobeOnboardingState.create({
    data: {
      id: fixture.id,
      user_id: fixture.userId,
      status: fixture.status,
      current_step: fixture.currentStep,
      used_starter_wardrobe: fixture.usedStarterWardrobe,
      garments_captured_count: fixture.garmentsCapturedCount,
      started_at: fixture.startedAt,
      completed_at: fixture.completedAt,
      revision: fixture.revision,
    },
  })

  registerCreatedEntity('wardrobeOnboardingStates', state.id)

  return state
}

function maybePersistWardrobeOnboardingState(
  fixture: WardrobeOnboardingStateFixture,
  options?: CreatePersistedWardrobeOnboardingStateOptions
): WardrobeOnboardingStateFixture | Promise<PersistedWardrobeOnboardingStateFixture> {
  if (!options?.persist) {
    return fixture
  }

  return persistWardrobeOnboardingState(options.prisma, fixture)
}

export function createWardrobeOnboardingState(
  overrides?: WardrobeOnboardingStateFactoryOverrides
): WardrobeOnboardingStateFixture
export function createWardrobeOnboardingState(
  overrides: WardrobeOnboardingStateFactoryOverrides | undefined,
  options: CreatePersistedWardrobeOnboardingStateOptions
): Promise<PersistedWardrobeOnboardingStateFixture>
export function createWardrobeOnboardingState(
  overrides: WardrobeOnboardingStateFactoryOverrides = {},
  options?: CreatePersistedWardrobeOnboardingStateOptions
): WardrobeOnboardingStateFixture | Promise<PersistedWardrobeOnboardingStateFixture> {
  return maybePersistWardrobeOnboardingState(
    mergeWardrobeOnboardingStateFixture(overrides),
    options
  )
}
