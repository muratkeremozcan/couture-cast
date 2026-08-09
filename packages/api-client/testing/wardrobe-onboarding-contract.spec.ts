// Story 4.4 Task 7 step 1 owner: prove the onboarding-state Zod schemas parse
// and reject correctly, mirroring wardrobe-contract.spec.ts's structure.
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  generateHttpOpenApiDocument,
  updateWardrobeOnboardingStateInputSchema,
  wardrobeOnboardingStateResponseSchema,
  wardrobeOnboardingStateSchema,
  wardrobeOnboardingStatusEnum,
  wardrobeOnboardingStepEnum,
} from '../src/contracts/http'

function buildOnboardingState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'in_progress',
    currentStep: 'silhouette',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 2,
    startedAt: '2026-08-09T09:00:00.000Z',
    completedAt: null,
    revision: 1,
    ...overrides,
  }
}

function expectIssuePath(schema: z.ZodType, input: unknown, expectedPath: string): void {
  const result = schema.safeParse(input)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      expectedPath
    )
  }
}

describe('Wardrobe Onboarding HTTP Contracts', () => {
  describe('Schema Validation', () => {
    it('validates a real onboarding state and its response envelope', () => {
      const state = buildOnboardingState()
      expect(wardrobeOnboardingStateSchema.parse(state)).toEqual(state)
      expect(
        wardrobeOnboardingStateResponseSchema.parse({ data: state }).data.currentStep
      ).toBe('silhouette')
    })

    it('validates the virtual not_started default shape (decision 3)', () => {
      const state = buildOnboardingState({
        status: 'not_started',
        currentStep: 'permission',
        garmentsCapturedCount: 0,
        startedAt: null,
        revision: 0,
      })
      expect(wardrobeOnboardingStateSchema.parse(state)).toMatchObject({
        status: 'not_started',
        currentStep: 'permission',
        startedAt: null,
        revision: 0,
      })
    })

    it('validates every documented onboarding status and step value', () => {
      for (const status of wardrobeOnboardingStatusEnum.options) {
        expect(
          wardrobeOnboardingStateSchema.safeParse(buildOnboardingState({ status }))
            .success
        ).toBe(true)
      }
      for (const currentStep of wardrobeOnboardingStepEnum.options) {
        expect(
          wardrobeOnboardingStateSchema.safeParse(buildOnboardingState({ currentStep }))
            .success
        ).toBe(true)
      }
    })

    it('validates the step-transition PATCH input, with usedStarterWardrobe optional', () => {
      expect(
        updateWardrobeOnboardingStateInputSchema.parse({ targetStep: 'silhouette' })
      ).toEqual({ targetStep: 'silhouette' })
      expect(
        updateWardrobeOnboardingStateInputSchema.parse({
          targetStep: 'silhouette',
          usedStarterWardrobe: true,
        })
      ).toEqual({ targetStep: 'silhouette', usedStarterWardrobe: true })
    })

    it('validates a completed state carries a non-null completedAt', () => {
      const state = buildOnboardingState({
        status: 'completed',
        currentStep: 'complete',
        completedAt: '2026-08-09T09:20:00.000Z',
      })
      expect(wardrobeOnboardingStateSchema.parse(state).completedAt).toBe(
        '2026-08-09T09:20:00.000Z'
      )
    })
  })

  describe('Security & Boundary Rejection', () => {
    it('rejects an unknown onboarding status or step', () => {
      expectIssuePath(
        wardrobeOnboardingStateSchema,
        buildOnboardingState({ status: 'archived' }),
        'status'
      )
      expectIssuePath(
        wardrobeOnboardingStateSchema,
        buildOnboardingState({ currentStep: 'checkout' }),
        'currentStep'
      )
    })

    it('rejects a negative or fractional garment count', () => {
      expectIssuePath(
        wardrobeOnboardingStateSchema,
        buildOnboardingState({ garmentsCapturedCount: -1 }),
        'garmentsCapturedCount'
      )
      expectIssuePath(
        wardrobeOnboardingStateSchema,
        buildOnboardingState({ garmentsCapturedCount: 1.5 }),
        'garmentsCapturedCount'
      )
    })

    it('rejects a negative revision', () => {
      expectIssuePath(
        wardrobeOnboardingStateSchema,
        buildOnboardingState({ revision: -1 }),
        'revision'
      )
    })

    it('rejects a missing targetStep on the PATCH input', () => {
      expectIssuePath(updateWardrobeOnboardingStateInputSchema, {}, 'targetStep')
    })

    it('rejects client-injected fields on the state and the PATCH input', () => {
      const stateResult = wardrobeOnboardingStateSchema.safeParse(
        buildOnboardingState({ userId: 'client-injected-user-id' })
      )
      expect(stateResult.success).toBe(false)
      if (!stateResult.success) {
        expect(stateResult.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_keys', keys: ['userId'] }),
          ])
        )
      }

      const patchResult = updateWardrobeOnboardingStateInputSchema.safeParse({
        targetStep: 'silhouette',
        userId: 'hacker-user',
      })
      expect(patchResult.success).toBe(false)
      if (!patchResult.success) {
        expect(patchResult.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_keys', keys: ['userId'] }),
          ])
        )
      }
    })
  })

  describe('OpenAPI Registration', () => {
    it('registers the onboarding-state routes with the documented status codes', () => {
      const spec = generateHttpOpenApiDocument()

      const routes = [
        {
          method: 'get',
          path: '/api/v1/wardrobe/onboarding',
          statuses: ['200', '401', '403'],
        },
        {
          method: 'patch',
          path: '/api/v1/wardrobe/onboarding',
          statuses: ['200', '400', '401', '403', '409', '412', '428'],
        },
      ] as const

      for (const route of routes) {
        const operation = spec.paths?.[route.path]?.[route.method]
        expect(
          operation?.security,
          `${route.method.toUpperCase()} ${route.path}`
        ).toEqual([{ bearerAuth: [] }])
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
          [...route.statuses].sort()
        )
      }

      const patchOperation = spec.paths?.['/api/v1/wardrobe/onboarding']?.patch
      expect(patchOperation?.requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateWardrobeOnboardingStateInput' },
          },
        },
      })
      expect(patchOperation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'if-match', in: 'header', required: true }),
        ])
      )
    })
  })
})
