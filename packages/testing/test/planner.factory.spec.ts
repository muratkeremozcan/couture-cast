// Story 5.5: premium 7-day outfit planner.
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  buildPlannerDayPlanCreateInput,
  createPlannerDayPlan,
  persistPlannerDayPlan,
} from '../src/factories/planner.factory.js'

/**
 * Persistence is asserted against a stubbed Prisma client: these are unit
 * tests of the camelCase-to-snake_case mapping and the cleanup registration;
 * whether the columns and constraints actually exist is the schema suite's
 * job in `packages/db/test/planner-schema.spec.ts`.
 */

type CreateStub = { create: ReturnType<typeof vi.fn> }

function stubPrisma(): { prisma: PrismaClient; plannerDayPlan: CreateStub } {
  const plannerDayPlan: CreateStub = {
    create: vi.fn(({ data }: { data: { id: string } }) => Promise.resolve(data)),
  }

  return {
    prisma: { plannerDayPlan } as unknown as PrismaClient,
    plannerDayPlan,
  }
}

describe('planner factories', () => {
  afterEach(() => {
    resetTrackedEntities()
  })

  describe('PlannerDayPlan', () => {
    it('5.5-FACTORY-01 defaults to a generated, unreshuffled plan at version 1', () => {
      const plan = createPlannerDayPlan()

      expect(plan.source).toBe('generated')
      expect(plan.version).toBe(1)
      expect(plan.reshuffleCount).toBe(0)
    })

    it('5.5-FACTORY-02 requires an explicit locationId with no default synth', () => {
      // Unlike userId, locationId has no meaningful random default: it must
      // reference a real SavedLocation row owned by the same user, or the
      // composite FK rejects it. The factory still emits SOME id by default
      // (so an override-free call does not throw) but every fixture graph
      // test must override it explicitly to a persisted location.
      const plan = createPlannerDayPlan({ locationId: 'location-owned-by-user' })
      expect(plan.locationId).toBe('location-owned-by-user')
    })

    it('5.5-FACTORY-03 maps to snake_case columns and registers for cleanup', async () => {
      const { prisma, plannerDayPlan } = stubPrisma()

      await persistPlannerDayPlan(
        prisma,
        createPlannerDayPlan({
          id: 'plan-1',
          userId: 'user-1',
          locationId: 'location-1',
          planDate: new Date('2026-07-16T00:00:00.000Z'),
          locale: 'fr-FR',
          dependencyFingerprint: 'fp-1',
          planPayload: { days: [] },
          source: 'reshuffled',
          version: 2,
          reshuffleCount: 1,
          generatedAt: new Date('2026-07-16T06:00:00.000Z'),
        })
      )

      expect(plannerDayPlan.create).toHaveBeenCalledWith({
        data: {
          id: 'plan-1',
          user_id: 'user-1',
          location_id: 'location-1',
          plan_date: new Date('2026-07-16T00:00:00.000Z'),
          locale: 'fr-FR',
          dependency_fingerprint: 'fp-1',
          plan_payload: { days: [] },
          source: 'reshuffled',
          version: 2,
          reshuffle_count: 1,
          generated_at: new Date('2026-07-16T06:00:00.000Z'),
        },
      })
      expect(getTrackedEntityIds('plannerDayPlans')).toEqual(['plan-1'])
    })

    it('5.5-FACTORY-04 buildPlannerDayPlanCreateInput matches persistPlannerDayPlan mapping', () => {
      const fixture = createPlannerDayPlan({ id: 'plan-2', userId: 'user-2' })
      const input = buildPlannerDayPlanCreateInput(fixture)

      expect(input).toMatchObject({
        id: 'plan-2',
        user_id: 'user-2',
        location_id: fixture.locationId,
        locale: fixture.locale,
        dependency_fingerprint: fixture.dependencyFingerprint,
        source: fixture.source,
        version: fixture.version,
        reshuffle_count: fixture.reshuffleCount,
      })
    })
  })
})
