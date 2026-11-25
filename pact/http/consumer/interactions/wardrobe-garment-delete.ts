// Story 7.6 test plan 7.6-PACT-001..002: the usage read the delete prompt names, and the garment
// DELETE the Undo window commits. Both web and mobile register them.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { garmentUsageResponseSchema } from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { integer, pactEventHeaders, string, type CreateClient } from './shared'

const usedGarmentId = '00000000-0000-4000-8000-000000000076'
const unusedGarmentId = '00000000-0000-4000-8000-000000000077'

export async function verifyGarmentUsageInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A ready garment held by one saved look and one capsule exists for user',
        params: { garmentId: usedGarmentId, userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request for what deleting a garment affects')
    .withRequest(
      'GET',
      `/api/v1/wardrobe/garments/${usedGarmentId}/usage`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          garmentId: string(usedGarmentId),
          savedLookCount: integer(1),
          capsuleCount: integer(1),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeGarmentsGarmentIdUsageGet({ garmentId: usedGarmentId })
      expect(garmentUsageResponseSchema.parse(response)).toEqual({
        garmentId: usedGarmentId,
        savedLookCount: 1,
        capsuleCount: 1,
      })
    })
}

export async function verifyDeleteGarmentInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A ready garment held by no saved look or capsule exists for user',
        params: { garmentId: unusedGarmentId, userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request to delete a garment')
    .withRequest(
      'DELETE',
      `/api/v1/wardrobe/garments/${unusedGarmentId}`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(204)
    .executeTest(async (mockServer: V3MockServer) => {
      await expect(
        createClient(mockServer).apiV1WardrobeGarmentsGarmentIdDelete({
          garmentId: unusedGarmentId,
        })
      ).resolves.toBeUndefined()
    })
}
