import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  decimal,
  isoTimestamp,
  like,
  nullValue,
  pactEventHeaders,
  regex,
  string,
  type CreateClient,
} from './shared'

export async function verifySuggestGarmentTagsInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const garmentId = '00000000-0000-4000-8000-000000000001'

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A garment in awaiting_tags status with tag suggestions exists for user',
        params: { garmentId, userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request to suggest garment smart tags')
    .withRequest(
      'POST',
      `/api/v1/wardrobe/garments/${garmentId}/suggest-tags`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            garmentId: string(garmentId),
            analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
            suggestions: {
              category: {
                value: 'top',
                confidence: decimal(0.85),
                isConfident: true,
              },
              material: {
                value: 'cotton',
                confidence: decimal(0.72),
                isConfident: true,
              },
              comfortRange: {
                value: 'mild',
                confidence: decimal(0.72),
                isConfident: true,
              },
            },
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeGarmentsGarmentIdSuggestTagsPost({
        garmentId,
      })

      expect(suggestGarmentTagsResponseSchema.parse(response)).toBeDefined()
    })
}

type SmartTagErrorInteraction = {
  description: string
  method: 'POST' | 'PATCH'
  path: string
  state: string
  stateParams: { garmentId: string; userId: string }
  requestBody?: Record<string, unknown>
  includeAuthorization?: boolean
  responseStatus: number
  responseBody: Record<string, unknown>
  responseMatcher?: Record<string, unknown>
}

/**
 * Exported (rather than the single grouped-call shape this replaced) so each
 * pacttest file can drive one `it.each(...)` row per interaction instead of
 * looping over a table inside one `it()` -- PactV4's Rust FFI
 * non-deterministically drops an interaction when more than one
 * `addInteraction()...executeTest()` chain is awaited inside one test body.
 * Found by a dedicated bmad-tea test-architecture review of Task 7: this
 * exact pattern had already been fixed for the newer
 * `onboardingErrorInteractions`/`silhouetteGuardianErrorInteractions` tables
 * but not yet applied to this pre-existing (Story 4.2) pair, which is the
 * "worth the same it.each treatment in a follow-up" item that review noted.
 */
export async function verifySmartTagErrorInteraction(
  pact: PactV4,
  interaction: SmartTagErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: interaction.stateParams,
      })
    )
    .uponReceiving(interaction.description)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: interaction.includeAuthorization === false ? {} : pactEventHeaders,
        ...(interaction.requestBody ? { body: interaction.requestBody } : {}),
      })
    )
    .willRespondWith(
      interaction.responseStatus,
      setJsonContent({
        body: interaction.responseMatcher ?? interaction.responseBody,
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: the point is to pin the status and error envelope the
      // clients branch on, not the SDK's error-handling.
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: interaction.method,
        headers: {
          'content-type': 'application/json',
          ...(interaction.includeAuthorization === false ? {} : pactEventHeaders),
        },
        body: interaction.requestBody
          ? JSON.stringify(interaction.requestBody)
          : undefined,
      })
      expect(response.status).toBe(interaction.responseStatus)
      await expect(response.json()).resolves.toEqual(interaction.responseBody)
    })
}

const SMART_TAG_ERROR_GARMENT_ID = '00000000-0000-4000-8000-000000000001'
const SMART_TAG_ERROR_USER_ID = 'guardian-1'
const SMART_TAG_INVALID_GARMENT_ID = 'g'.repeat(129)

export const suggestGarmentTagsErrorInteractions: SmartTagErrorInteraction[] = [
  {
    description: 'a request to suggest tags with an invalid garment id',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_INVALID_GARMENT_ID}/suggest-tags`,
    state: 'A garment in awaiting_tags status with tag suggestions exists for user',
    stateParams: {
      garmentId: SMART_TAG_INVALID_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    responseStatus: 400,
    responseBody: {
      statusCode: 400,
      message:
        'Invalid garment id: garmentId: String must contain at most 128 character(s)',
      error: 'Bad Request',
    },
    responseMatcher: {
      statusCode: 400,
      message: regex(
        /^Invalid garment id: garmentId: String must contain at most 128 character\(s\)$/,
        'Invalid garment id: garmentId: String must contain at most 128 character(s)'
      ),
      error: 'Bad Request',
    },
  },
  {
    description: 'an unauthenticated request to suggest garment tags',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_ERROR_GARMENT_ID}/suggest-tags`,
    state: 'A garment in awaiting_tags status with tag suggestions exists for user',
    stateParams: {
      garmentId: SMART_TAG_ERROR_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    includeAuthorization: false,
    responseStatus: 401,
    responseBody: {
      statusCode: 401,
      message: 'Missing or invalid bearer token',
      error: 'Unauthorized',
    },
  },
  {
    description: 'a request while garment analysis is pending',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_ERROR_GARMENT_ID}/suggest-tags`,
    state: 'Garment analysis is pending for user',
    stateParams: {
      garmentId: SMART_TAG_ERROR_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    responseStatus: 409,
    responseBody: {
      statusCode: 409,
      message: 'GARMENT_ANALYSIS_PENDING',
      error: 'Conflict',
    },
  },
  {
    description: 'a request while garment tag inference is unavailable',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_ERROR_GARMENT_ID}/suggest-tags`,
    state: 'Garment tagging inference is unavailable for user',
    stateParams: {
      garmentId: SMART_TAG_ERROR_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    responseStatus: 503,
    responseBody: {
      statusCode: 503,
      message: 'TAGGING_INFERENCE_UNAVAILABLE',
      error: 'Service Unavailable',
    },
  },
]

export const updateGarmentTagsErrorInteractions: SmartTagErrorInteraction[] = [
  {
    description: 'a forbidden request to update garment tags',
    method: 'PATCH',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_ERROR_GARMENT_ID}/tags`,
    state: 'Wardrobe tagging is forbidden for user',
    stateParams: {
      garmentId: SMART_TAG_ERROR_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    requestBody: { category: 'top', material: 'cotton', comfortRange: 'mild' },
    responseStatus: 403,
    responseBody: {
      statusCode: 403,
      message: 'GUARDIAN_CONSENT_REQUIRED',
      error: 'Forbidden',
    },
  },
  {
    description: 'a request to update tags for a missing garment',
    method: 'PATCH',
    path: `/api/v1/wardrobe/garments/${SMART_TAG_ERROR_GARMENT_ID}/tags`,
    state: 'Garment does not exist for user',
    stateParams: {
      garmentId: SMART_TAG_ERROR_GARMENT_ID,
      userId: SMART_TAG_ERROR_USER_ID,
    },
    requestBody: { category: 'top', material: 'cotton', comfortRange: 'mild' },
    responseStatus: 404,
    responseBody: {
      statusCode: 404,
      message: 'GARMENT_NOT_FOUND',
      error: 'Not Found',
    },
  },
]

export async function verifyUpdateGarmentTagsNullMaterialInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const garmentId = '00000000-0000-4000-8000-000000000001'
  const input = {
    category: 'top' as const,
    material: null,
    comfortRange: 'mild' as const,
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A garment in awaiting_tags status exists for user',
        params: { garmentId, userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request to clear garment material while confirming tags')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/garments/${garmentId}/tags`,
      setJsonContent({ headers: pactEventHeaders, body: input })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            id: string(garmentId),
            status: 'ready',
            category: 'top',
            material: nullValue(),
            comfortRange: 'mild',
            tagsConfirmedAt: isoTimestamp('2026-08-05T12:00:00.000Z'),
            fileSizeBytes: like(1024),
            mimeType: 'image/png',
            retentionStatus: 'active',
            createdAt: isoTimestamp('2026-08-05T10:00:00.000Z'),
            committedAt: isoTimestamp('2026-08-05T10:01:00.000Z'),
            imageAccess: {
              url: string('https://example.com/read.png'),
              expiresAt: isoTimestamp('2026-08-05T12:15:00.000Z'),
            },
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeGarmentsGarmentIdTagsPatch({
        garmentId,
        updateGarmentTagsInput: input,
      })
      expect(updateGarmentTagsResponseSchema.parse(response).data.material).toBeNull()
    })
}

export async function verifyUpdateGarmentTagsInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const garmentId = '00000000-0000-4000-8000-000000000001'
  const input = {
    category: 'top' as const,
    material: 'cotton' as const,
    comfortRange: 'mild' as const,
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A garment in awaiting_tags status exists for user',
        params: { garmentId, userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request to update and confirm garment tags')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/garments/${garmentId}/tags`,
      setJsonContent({
        headers: pactEventHeaders,
        body: input,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            id: string(garmentId),
            status: string('ready'),
            category: string('top'),
            material: string('cotton'),
            comfortRange: string('mild'),
            tagsConfirmedAt: isoTimestamp('2026-08-05T12:00:00.000Z'),
            fileSizeBytes: like(1024),
            mimeType: string('image/png'),
            retentionStatus: string('active'),
            createdAt: isoTimestamp('2026-08-05T10:00:00.000Z'),
            committedAt: isoTimestamp('2026-08-05T10:01:00.000Z'),
            imageAccess: {
              url: string('https://example.com/read.png'),
              expiresAt: isoTimestamp('2026-08-05T12:15:00.000Z'),
            },
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeGarmentsGarmentIdTagsPatch({
        garmentId,
        updateGarmentTagsInput: input,
      })

      expect(updateGarmentTagsResponseSchema.parse(response)).toBeDefined()
    })
}
