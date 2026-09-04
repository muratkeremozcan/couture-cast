import type {
  PlannerDayPlan,
  PlannerOutfitSource,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

/**
 * Story 5.5: deterministic fixtures for `PlannerDayPlan`.
 *
 * `locationId` has no default the way `userId` does: it must reference a
 * real `SavedLocation` row owned by the same user, because the composite FK
 * `(location_id, user_id) -> SavedLocation(id, user_id)` rejects a
 * mismatched or non-existent pair. Callers create the location first (via
 * `saved-location.factory.ts`) and pass its id and owner through.
 *
 * `planPayload` defaults to an empty object. `PlannerDayPlan.plan_payload`
 * is untyped `Json` at the schema layer -- the internal strict Zod schema
 * lives in `PlannerService` -- so any JSON-serializable value is a valid
 * fixture; callers exercising service-level parsing pass their own shape.
 */

type PlannerPrismaClient = PrismaClient | Prisma.TransactionClient

export interface PlannerDayPlanFixture {
  id: string
  userId: string
  locationId: string
  planDate: Date
  locale: string
  dependencyFingerprint: string
  planPayload: Prisma.InputJsonValue
  source: PlannerOutfitSource
  version: number
  reshuffleCount: number
  generatedAt: Date
}

export type PlannerDayPlanFactoryOverrides = Partial<PlannerDayPlanFixture>

function buildDefaultPlannerDayPlanFixture(): PlannerDayPlanFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    locationId: faker.string.uuid(),
    planDate: new Date('2026-07-16T00:00:00.000Z'),
    locale: 'en-US',
    dependencyFingerprint: `fingerprint-${faker.string.alphanumeric(16)}`,
    planPayload: {},
    source: 'generated',
    version: 1,
    reshuffleCount: 0,
    generatedAt: new Date('2026-07-16T06:00:00.000Z'),
  }
}

const mergePlannerDayPlanFixture = createFactory<PlannerDayPlanFixture>(
  buildDefaultPlannerDayPlanFixture
)

export function createPlannerDayPlan(
  overrides: PlannerDayPlanFactoryOverrides = {}
): PlannerDayPlanFixture {
  return mergePlannerDayPlanFixture(overrides)
}

export function buildPlannerDayPlanCreateInput(
  fixture: PlannerDayPlanFixture
): Prisma.PlannerDayPlanUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    location_id: fixture.locationId,
    plan_date: fixture.planDate,
    locale: fixture.locale,
    dependency_fingerprint: fixture.dependencyFingerprint,
    plan_payload: fixture.planPayload,
    source: fixture.source,
    version: fixture.version,
    reshuffle_count: fixture.reshuffleCount,
    generated_at: fixture.generatedAt,
  }
}

export async function persistPlannerDayPlan(
  prisma: PlannerPrismaClient,
  fixture: PlannerDayPlanFixture
): Promise<PlannerDayPlan> {
  const plan = await prisma.plannerDayPlan.create({
    data: buildPlannerDayPlanCreateInput(fixture),
  })

  registerCreatedEntity('plannerDayPlans', plan.id)
  return plan
}
