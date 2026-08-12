// Learning path Step 19: Scenario outfit generator.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-19-scenario-outfit-generator
// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrackedEntityIds, resetTrackedEntities } from '../src/factories/registry.js'
import {
  buildRitualCreateInput,
  createRitual,
  RITUAL_SCENARIOS,
} from '../src/factories/ritual.factory.js'

describe('ritual factory', () => {
  it('creates a ritual fixture with the reasoning badges the UI renders', () => {
    // The badge shape is a Story 2.3 contract: the ritual card reads key, label
    // and bullets, so a fixture missing any of them hides a real regression.
    const ritual = createRitual({ id: 'ritual-1', userId: 'user-1' })

    expect(RITUAL_SCENARIOS).toContain(ritual.scenario)
    expect(ritual.garmentIds).toHaveLength(3)
    expect(ritual.reasoningBadges[0]).toMatchObject({
      key: expect.any(String) as string,
      label: expect.any(String) as string,
    })
    expect(ritual.reasoningBadges.every((badge) => badge.bullets.length > 0)).toBe(true)
  })

  it('connects the owner and omits the forecast segment when there is none', () => {
    // Seeded rituals have no forecast segment; passing `connect: { id: null }`
    // would make Prisma reject the whole seed run.
    const input = buildRitualCreateInput(
      createRitual({ id: 'ritual-1', userId: 'user-1', forecastSegmentId: null })
    )

    expect(input).toMatchObject({
      id: 'ritual-1',
      user: { connect: { id: 'user-1' } },
    })
    expect(input.forecast_segment).toBe(undefined)
  })

  it('connects the forecast segment when the fixture names one', () => {
    const input = buildRitualCreateInput(
      createRitual({ id: 'ritual-2', userId: 'user-1', forecastSegmentId: 'segment-9' })
    )

    expect(input.forecast_segment).toEqual({ connect: { id: 'segment-9' } })
  })

  describe('persistence', () => {
    afterEach(() => {
      resetTrackedEntities()
    })

    it('persists a ritual and registers it for cleanup', async () => {
      const create =
        vi.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>()
      create.mockResolvedValue({ id: 'ritual-persisted' })
      const prisma = { outfitRecommendation: { create } } as unknown as PrismaClient

      const persisted = await createRitual(
        { id: 'ritual-persisted', userId: 'user-1' },
        { persist: true, prisma }
      )

      expect(persisted).toEqual({ id: 'ritual-persisted' })
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        data: { id: 'ritual-persisted' },
      })
      expect(getTrackedEntityIds('rituals')).toEqual(['ritual-persisted'])
    })
  })
})
