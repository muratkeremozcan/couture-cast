// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  savedLookListResponseSchema,
  savedLookResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { like, pactEventHeaders, string, type CreateClient } from './shared'

export const SAVED_LOOK_OWNER_ID = 'guardian-1'
export const SAVED_LOOK_ID = 'saved-look-pact-1'
export const SAVED_LOOK_GARMENT_ID = 'garment-pact-1'
export const SAVED_LOOK_IDEMPOTENCY_KEY = '72000000-0000-4000-8000-000000000001'
export const SAVED_LOOK_ETAG_0 = `"saved-look:${SAVED_LOOK_ID}:0"`
const SAVED_LOOK_TIMESTAMP = '2026-11-22T01:00:00.000Z'

function savedLookStylePiecePayload() {
  return {
    source: 'style_piece' as const,
    lookId: 'look-01',
    weather: 'warm-rainy',
    anchorGarmentId: SAVED_LOOK_GARMENT_ID,
    anchorSnapshot: {
      garmentId: SAVED_LOOK_GARMENT_ID,
      category: 'top' as const,
      comfortRange: 'mild' as const,
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top' as const,
        kind: 'garment' as const,
        itemId: SAVED_LOOK_GARMENT_ID,
      },
      {
        slotIndex: 1,
        category: 'bottom' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:bottom-1',
      },
      {
        slotIndex: 2,
        category: 'shoes' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:loafers',
      },
    ],
    swaps: { shoes: 'sample:g:loafers' },
  }
}

function savedLookContractBody(
  overrides: {
    availabilityStatus?: 'ready' | 'missing_garment' | 'needs_review'
    missingGarmentIds?: string[]
    needsReviewReasons?: ('category_changed' | 'comfort_range_changed')[]
    missingFirstSlot?: boolean
  } = {}
) {
  const availabilityStatus = overrides.availabilityStatus ?? 'ready'
  const missingFirstSlot = overrides.missingFirstSlot ?? false
  return {
    id: string(SAVED_LOOK_ID),
    ownerUserId: string(SAVED_LOOK_OWNER_ID),
    source: 'style_piece',
    lookId: string('look-01'),
    weather: string('warm-rainy'),
    title: null,
    anchorGarmentId: string(SAVED_LOOK_GARMENT_ID),
    anchorSnapshot: {
      garmentId: string(SAVED_LOOK_GARMENT_ID),
      category: 'top',
      comfortRange: 'mild',
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: string(SAVED_LOOK_GARMENT_ID),
        label: null,
        missing: missingFirstSlot,
        imageAccess: null,
      },
      {
        slotIndex: 1,
        category: 'bottom',
        kind: 'catalog',
        itemId: string('sample:g:bottom-1'),
        label: null,
        missing: false,
        imageAccess: null,
      },
      {
        slotIndex: 2,
        category: 'shoes',
        kind: 'catalog',
        itemId: string('sample:g:loafers'),
        label: null,
        missing: false,
        imageAccess: null,
      },
    ],
    swaps: like({ shoes: 'sample:g:loafers' }),
    collection: null,
    comfort: null,
    availabilityStatus,
    missingGarmentIds: overrides.missingGarmentIds ?? [],
    needsReviewReasons: overrides.needsReviewReasons ?? [],
    revision: 0,
    createdAt: string(SAVED_LOOK_TIMESTAMP),
    updatedAt: string(SAVED_LOOK_TIMESTAMP),
  }
}

export async function verifyCreateSavedLookInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const payload = savedLookStylePiecePayload()
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Member owns ready anchor garment for saved look creation',
        params: { userId: SAVED_LOOK_OWNER_ID, garmentId: SAVED_LOOK_GARMENT_ID },
      })
    )
    .uponReceiving('a request to save a Style this piece look to the account')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/saved-looks',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SAVED_LOOK_IDEMPOTENCY_KEY,
        },
        body: payload,
      })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: {
          'Cache-Control': 'private, no-store',
          ETag: string(SAVED_LOOK_ETAG_0),
        },
        body: {
          data: savedLookContractBody(),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSavedLooksPost({
        idempotencyKey: SAVED_LOOK_IDEMPOTENCY_KEY,
        createSavedLookInput: payload,
      })
      const parsed = savedLookResponseSchema.parse(response)
      expect(parsed.data.id).toBe(SAVED_LOOK_ID)
      expect(parsed.data.availabilityStatus).toBe('ready')
    })
}

export async function verifySavedLookIdempotentReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const payload = savedLookStylePiecePayload()
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Saved look already exists for idempotency key',
        params: {
          userId: SAVED_LOOK_OWNER_ID,
          savedLookId: SAVED_LOOK_ID,
          idempotencyKey: SAVED_LOOK_IDEMPOTENCY_KEY,
        },
      })
    )
    .uponReceiving('a retried request to save a look with the same Idempotency-Key')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/saved-looks',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SAVED_LOOK_IDEMPOTENCY_KEY,
        },
        body: payload,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: {
          'Cache-Control': 'private, no-store',
          ETag: string(SAVED_LOOK_ETAG_0),
        },
        body: {
          data: savedLookContractBody(),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSavedLooksPost({
        idempotencyKey: SAVED_LOOK_IDEMPOTENCY_KEY,
        createSavedLookInput: payload,
      })
      expect(savedLookResponseSchema.parse(response).data.id).toBe(SAVED_LOOK_ID)
    })
}

export async function verifyListSavedLooksInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Member has account saved looks',
        params: { userId: SAVED_LOOK_OWNER_ID, savedLookId: SAVED_LOOK_ID },
      })
    )
    .uponReceiving('a request to list account saved looks')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/saved-looks',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: {
          'Cache-Control': 'private, no-store',
        },
        body: {
          data: [savedLookContractBody()],
          total: 1,
          limit: 50,
          offset: 0,
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSavedLooksGet()
      const parsed = savedLookListResponseSchema.parse(response)
      expect(parsed.total).toBe(1)
      expect(parsed.data[0]?.id).toBe(SAVED_LOOK_ID)
    })
}

export async function verifyDeleteSavedLookInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Member has account saved looks',
        params: { userId: SAVED_LOOK_OWNER_ID, savedLookId: SAVED_LOOK_ID },
      })
    )
    .uponReceiving('a request to remove a saved look with matching If-Match revision')
    .withRequest('DELETE', `/api/v1/wardrobe/saved-looks/${SAVED_LOOK_ID}`, (builder) => {
      builder.headers({
        ...pactEventHeaders,
        'If-Match': SAVED_LOOK_ETAG_0,
      })
    })
    .willRespondWith(204, (builder) => {
      builder.headers({
        'Cache-Control': 'private, no-store',
      })
    })
    .executeTest(async (mockServer: V3MockServer) => {
      await createClient(mockServer).apiV1WardrobeSavedLooksSavedLookIdDelete({
        savedLookId: SAVED_LOOK_ID,
        ifMatch: SAVED_LOOK_ETAG_0,
      })
    })
}
