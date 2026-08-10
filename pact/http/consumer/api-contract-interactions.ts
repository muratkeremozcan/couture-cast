// Step 22 step 5 owner: check Accept-Language header propagation in Pact consumer tests in pact/http/consumer/api-contract-interactions.ts
import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import type { DefaultApi } from '@couture/api-client'
import {
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollResponseSchema,
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
  userPreferencesResponseSchema,
  GARMENT_TAGGING_ANALYSIS_VERSION,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsResponseSchema,
  outfitCapsuleResponseSchema,
  outfitCapsuleListResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  silhouetteProfileResponseSchema,
  createSilhouetteUploadUrlResponseSchema,
  type WardrobeOnboardingStatus,
  type WardrobeOnboardingStep,
  type SilhouetteMode,
  type SilhouettePhotoStatus,
  type SilhouettePhotoFailureReason,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'

const { decimal, eachLike, like, nullValue, regex, string } = MatchersV3

export const pactEventAuth = {
  accessToken: 'pact-event-token',
  userId: 'guardian-1',
  role: 'guardian',
} as const

const pactEventHeaders = {
  Authorization: `Bearer ${pactEventAuth.accessToken}`,
}

/**
 * A second identity for the Story 4.4 guardian-consent-gate and
 * guardian-notification interactions, which need an actor whose `role` is
 * `'teen'` (`WardrobeUploadGuard`/`assertWardrobeUploadAllowed` only ever
 * forbids a `'teen'` actor, decision 7). `provider-helper.ts`'s
 * `accessTokenIdentityService` mock resolves this token to `{ userId:
 * 'teen-1', role: 'teen' }` alongside the existing guardian identity.
 */
export const pactTeenAuth = {
  accessToken: 'pact-teen-token',
  userId: 'teen-1',
  role: 'teen',
} as const

const pactTeenHeaders = {
  Authorization: `Bearer ${pactTeenAuth.accessToken}`,
}

type ContractApiClient = Pick<
  DefaultApi,
  | 'apiHealthGet'
  | 'apiV1EventsPollGet'
  | 'apiV1RitualGet'
  | 'apiV1PersonalizationComfortGet'
  | 'apiV1PersonalizationComfortPut'
  | 'apiV1UserPreferencesPut'
  | 'apiV1WardrobeGarmentsGarmentIdSuggestTagsPost'
  | 'apiV1WardrobeGarmentsGarmentIdTagsPatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesGet'
  | 'apiV1WardrobeOwnerUserIdCapsulesPost'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete'
  | 'apiV1WardrobeOnboardingGet'
  | 'apiV1WardrobeOnboardingPatch'
  | 'apiV1WardrobeSilhouetteGet'
  | 'apiV1WardrobeSilhouettePut'
  | 'apiV1WardrobeSilhouetteMyFormUploadUrlPost'
  | 'apiV1WardrobeSilhouetteMyFormCommitPost'
  | 'apiV1WardrobeSilhouetteMyFormDelete'
>
type CreateClient = (mockServer: V3MockServer) => ContractApiClient

const isoTimestamp = (value: string) =>
  regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)

export async function verifyApiHealthInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .uponReceiving('a request for API health metadata')
    .withRequest('GET', '/api/health')
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          status: 'ok',
          service: 'couturecast-api',
          environment: string('preview'),
          gitSha: string('abc123'),
          gitBranch: string('main'),
          timestamp: isoTimestamp('2026-05-16T12:00:00.000Z'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiHealthGet()

      expect(apiHealthResponseSchema.parse(response)).toMatchObject({
        status: 'ok',
        service: 'couturecast-api',
      })
    })
}

export async function verifyEventsPollInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const since = '2026-05-16T12:00:00.000Z'
  const event = {
    id: 'evt-1',
    channel: 'alerts',
    payload: { severity: 'warning' },
    userId: 'guardian-1',
    createdAt: '2026-05-16T12:01:00.000Z',
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A warning alert event exists after the polling cursor',
        params: { since, event },
      })
    )
    .uponReceiving('a request to poll realtime fallback events')
    .withRequest(
      'GET',
      '/api/v1/events/poll',
      setJsonContent({ headers: pactEventHeaders, query: { since } })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          events: eachLike({
            id: string(event.id),
            channel: string(event.channel),
            payload: like(event.payload),
            userId: string(event.userId),
            createdAt: isoTimestamp(event.createdAt),
          }),
          nextSince: isoTimestamp(event.createdAt),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1EventsPollGet({ since })

      expect(eventsPollResponseSchema.parse(response)).toEqual({
        events: [event],
        nextSince: event.createdAt,
      })
    })
}

export async function verifyInvalidCursorInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .uponReceiving('a request to poll events with an invalid cursor')
    .withRequest(
      'GET',
      '/api/v1/events/poll',
      setJsonContent({
        headers: pactEventHeaders,
        query: { since: 'not-a-date' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          events: like([]),
          nextSince: nullValue(),
          error: string('Invalid since timestamp'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1EventsPollGet({
        since: 'not-a-date',
      })

      expect(eventsPollInvalidSinceResponseSchema.parse(response)).toEqual({
        events: [],
        nextSince: null,
        error: 'Invalid since timestamp',
      })
    })
}

export async function verifyRitualInteraction(pact: PactV4, createClient: CreateClient) {
  const weatherSnapshot = {
    locationKey: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    provider: 'weatherapi',
    providerUpdatedAt: '2026-07-16T12:00:00.000Z',
    fetchedAt: '2026-07-16T12:00:00.000Z',
    current: {
      temperature: 16,
      condition: 'clear',
    },
    hourly: Array.from({ length: 48 }, (_, i) => ({
      forecastAt: new Date(
        new Date('2026-07-16T12:00:00.000Z').getTime() + i * 3600 * 1000
      ).toISOString(),
      temperature: 16,
      feelsLike: 15,
      precipitationProbability: 0.1,
      precipitationAmount: 0.0,
      windSpeed: 5.0,
      windGust: null,
      condition: 'clear',
      providerWeatherCode: '1000',
    })),
    alerts: [],
  }

  // Story 2.3 Task 3 step 1 owner: update consumer contract pact expectations
  const outfitMorning = {
    id: 'rec-morning-1',
    scenario: 'morning',
    garmentIds: ['g-1'],
    reasoningBadges: [
      { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high'] },
    ],
    comfortNotes: 'Chilly morning',
  }
  const outfitMidday = {
    id: 'rec-midday-1',
    scenario: 'midday',
    garmentIds: ['g-2'],
    reasoningBadges: [
      { key: 'light_layers', label: 'Light layers', bullets: ['Mild day'] },
    ],
    comfortNotes: 'Pleasant midday',
  }
  const outfitEvening = {
    id: 'rec-evening-1',
    scenario: 'evening',
    garmentIds: ['g-3'],
    reasoningBadges: [
      { key: 'evening_chill', label: 'Evening chill', bullets: ['Cool evening'] },
    ],
    comfortNotes: 'Cool evening',
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Daily scenario outfit recommendations exist for user',
        params: { userId: 'guardian-1', locationId: 'loc-1' },
      })
    )
    .uponReceiving('a request to get daily scenario outfit recommendations')
    .withRequest(
      'GET',
      '/api/v1/ritual',
      setJsonContent({
        headers: pactEventHeaders,
        query: { locationId: 'loc-1' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            weather: {
              locationKey: string(weatherSnapshot.locationKey),
              latitude: like(weatherSnapshot.latitude),
              longitude: like(weatherSnapshot.longitude),
              timezone: string(weatherSnapshot.timezone),
              provider: string(weatherSnapshot.provider),
              providerUpdatedAt: isoTimestamp(weatherSnapshot.providerUpdatedAt),
              fetchedAt: isoTimestamp(weatherSnapshot.fetchedAt),
              current: like(weatherSnapshot.current),
              hourly: like(weatherSnapshot.hourly),
              alerts: like([]),
            },
            outfits: [like(outfitMorning), like(outfitMidday), like(outfitEvening)],
            badges: eachLike('Wind layer'),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1RitualGet({
        locationId: 'loc-1',
      })

      expect(response.data).toBeDefined()
      expect(response.data.weather.locationKey).toBe('chicago-il')
      expect(response.data.outfits).toHaveLength(3)
      const firstOutfit = response.data.outfits[0]!
      expect(firstOutfit.scenario).toBe('morning')
      expect(firstOutfit.garmentIds).toEqual(['g-1'])
      expect(firstOutfit.reasoningBadges).toEqual([
        { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high'] },
      ])
      expect(firstOutfit.comfortNotes).toBe('Chilly morning')

      const secondOutfit = response.data.outfits[1]!
      expect(secondOutfit.scenario).toBe('midday')
      expect(secondOutfit.garmentIds).toEqual(['g-2'])
      expect(secondOutfit.reasoningBadges).toEqual([
        { key: 'light_layers', label: 'Light layers', bullets: ['Mild day'] },
      ])
      expect(secondOutfit.comfortNotes).toBe('Pleasant midday')

      const thirdOutfit = response.data.outfits[2]!
      expect(thirdOutfit.scenario).toBe('evening')
      expect(thirdOutfit.garmentIds).toEqual(['g-3'])
      expect(thirdOutfit.reasoningBadges).toEqual([
        { key: 'evening_chill', label: 'Evening chill', bullets: ['Cool evening'] },
      ])
      expect(thirdOutfit.comfortNotes).toBe('Cool evening')
    })
}

export async function verifyGetComfortPreferencesInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Comfort preferences exist for user',
        params: { userId: 'guardian-1' },
      })
    )
    .uponReceiving('a request to get comfort preferences')
    .withRequest(
      'GET',
      '/api/v1/personalization/comfort',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            runsColdWarm: string('neutral'),
            windTolerance: string('medium'),
            precipPreparedness: string('medium'),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1PersonalizationComfortGet()

      expect(comfortPreferencesResponseSchema.parse(response)).toEqual({
        data: {
          runsColdWarm: 'neutral',
          windTolerance: 'medium',
          precipPreparedness: 'medium',
        },
      })
    })
}

export async function verifyUpdateComfortPreferencesInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const input = {
    runsColdWarm: 'cold' as const,
    windTolerance: 'low' as const,
    precipPreparedness: 'high' as const,
  }

  await pact
    .addInteraction()
    .uponReceiving('a request to update comfort preferences')
    .withRequest(
      'PUT',
      '/api/v1/personalization/comfort',
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
            runsColdWarm: string('cold'),
            windTolerance: string('low'),
            precipPreparedness: string('high'),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1PersonalizationComfortPut({
        updateComfortPreferencesInput: input,
      })

      expect(updateComfortPreferencesResponseSchema.parse(response)).toEqual({
        data: {
          runsColdWarm: 'cold',
          windTolerance: 'low',
          precipPreparedness: 'high',
        },
      })
    })
}

export async function verifyUpdateUserPreferencesInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const input = { locale: 'tr-TR' as const }

  await pact
    .addInteraction()
    .uponReceiving('a request to persist the selected mobile locale')
    .withRequest(
      'PUT',
      '/api/v1/user/preferences',
      setJsonContent({
        headers: pactEventHeaders,
        body: input,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          success: true,
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1UserPreferencesPut({
        userPreferencesInput: input,
      })

      expect(userPreferencesResponseSchema.parse(response)).toEqual({
        success: true,
      })
    })
}

export async function verifyRitualLocalizationInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const weatherSnapshot = {
    locationKey: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    provider: 'weatherapi',
    providerUpdatedAt: '2026-07-16T12:00:00.000Z',
    fetchedAt: '2026-07-16T12:00:00.000Z',
    current: {
      temperature: 16,
      condition: 'clear',
    },
    hourly: Array.from({ length: 48 }, (_, i) => ({
      forecastAt: new Date(
        new Date('2026-07-16T12:00:00.000Z').getTime() + i * 3600 * 1000
      ).toISOString(),
      temperature: 16,
      feelsLike: 15,
      precipitationProbability: 0.1,
      precipitationAmount: 0.0,
      windSpeed: 5.0,
      windGust: null,
      condition: 'clear',
      providerWeatherCode: '1000',
    })),
    alerts: [],
  }

  const outfitMorningTurkish = {
    id: 'rec-morning-1',
    scenario: 'morning',
    garmentIds: ['g-1'],
    reasoningBadges: [
      {
        key: 'wind_layer',
        label: 'Rüzgarlık',
        bullets: ['Yüksek rüzgar nedeniyle rüzgar kesici bir katman önerilir'],
      },
    ],
    comfortNotes: 'Hafif rüzgarlı serin sabah. Trençkot önerilir.',
  }
  const outfitMiddayTurkish = {
    id: 'rec-midday-1',
    scenario: 'midday',
    garmentIds: ['g-2'],
    reasoningBadges: [
      { key: 'light_layers', label: 'Hafif Katmanlar', bullets: ['Ilık gün'] },
    ],
    comfortNotes: 'Ilık ve keyifli bir öğleden sonra.',
  }
  const outfitEveningTurkish = {
    id: 'rec-evening-1',
    scenario: 'evening',
    garmentIds: ['g-3'],
    reasoningBadges: [
      { key: 'evening_chill', label: 'Akşam Serinliği', bullets: ['Serin akşam'] },
    ],
    comfortNotes: 'Serin akşam.',
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Daily scenario outfit recommendations exist for user',
        params: { userId: 'guardian-1', locationId: 'loc-1' },
      })
    )
    .uponReceiving(
      'a request to get daily scenario outfit recommendations with an explicit Turkish locale'
    )
    .withRequest(
      'GET',
      '/api/v1/ritual',
      setJsonContent({
        headers: pactEventHeaders,
        query: { locationId: 'loc-1', locale: 'tr-TR' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            weather: like(weatherSnapshot),
            outfits: [
              like(outfitMorningTurkish),
              like(outfitMiddayTurkish),
              like(outfitEveningTurkish),
            ],
            badges: eachLike('Rüzgarlık'),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1RitualGet({
        locationId: 'loc-1',
        locale: 'tr-TR',
      })

      expect(response).toBeDefined()
      expect(response.data?.outfits?.[0]?.comfortNotes).toContain('serin sabah')
    })
}

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

/* ------------------------------------------------------------------------- *
 * Story 4.3 outfit capsules
 *
 * Pact covers request and response understanding, status codes, headers, and
 * error envelopes. Authorization rules, ranking, cache behaviour, and races
 * stay in the API and integration suites. One interaction per test.
 * ------------------------------------------------------------------------- */

const CAPSULE_OWNER_ID = 'guardian-1'
const CAPSULE_ID = '00000000-0000-4000-8000-0000000000c1'
const CAPSULE_GARMENT_A = '00000000-0000-4000-8000-0000000000a1'
const CAPSULE_GARMENT_B = '00000000-0000-4000-8000-0000000000a2'
const CAPSULE_IDEMPOTENCY_KEY = '3f1e8c2a-9b47-4d21-8f6e-5a0c7d3b1e94'

/** The strong validator this API issues and requires back on every mutation. */
const capsuleETagFor = (revision: number) => `"capsule:${CAPSULE_ID}:${revision}"`

const capsuleBody = (revision: number) => ({
  id: string(CAPSULE_ID),
  ownerUserId: string(CAPSULE_OWNER_ID),
  name: string('Work capsule'),
  description: nullValue(),
  occasions: eachLike('work'),
  isFavorite: like(false),
  revision: like(revision),
  availabilityStatus: string('ready'),
  unavailableGarmentCount: like(0),
  garments: eachLike({
    id: string(CAPSULE_GARMENT_A),
    category: string('top'),
    material: string('cotton'),
    comfortRange: string('mild'),
    imageAccess: nullValue(),
    availabilityStatus: string('ready'),
    garmentOrder: like(0),
  }),
  createdAt: isoTimestamp('2026-08-07T10:00:00.000Z'),
  updatedAt: isoTimestamp('2026-08-07T10:00:00.000Z'),
})

export async function verifyCreateCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Two ready and active garments exist for owner',
        params: { userId: CAPSULE_OWNER_ID },
      })
    )
    .uponReceiving('a request to create an outfit capsule')
    .withRequest(
      'POST',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
        body: {
          name: 'Work capsule',
          occasions: ['work'],
          garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
          isFavorite: false,
        },
      })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: {
          ETag: string(capsuleETagFor(1)),
          'Cache-Control': string('private, no-store'),
        },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesPost({
        ownerUserId: CAPSULE_OWNER_ID,
        idempotencyKey: CAPSULE_IDEMPOTENCY_KEY,
        createOutfitCapsuleInput: {
          name: 'Work capsule',
          occasions: ['work'],
          garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
          isFavorite: false,
        },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

/** An identical replay is a 200 against the capsule the first request created. */
export async function verifyCapsuleIdempotentReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule already exists for the idempotency key',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a replayed capsule creation with the same idempotency key')
    .withRequest(
      'POST',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
        body: {
          name: 'Work capsule',
          occasions: ['work'],
          garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
          isFavorite: false,
        },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(1)) },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesPost({
        ownerUserId: CAPSULE_OWNER_ID,
        idempotencyKey: CAPSULE_IDEMPOTENCY_KEY,
        createOutfitCapsuleInput: {
          name: 'Work capsule',
          occasions: ['work'],
          garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
          isFavorite: false,
        },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyListCapsulesInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Capsules exist for owner',
        params: { userId: CAPSULE_OWNER_ID },
      })
    )
    .uponReceiving('a request to list and filter outfit capsules')
    .withRequest(
      'GET',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: pactEventHeaders,
        query: { limit: '20', offset: '0', occasion: 'work', isFavorite: 'false' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: eachLike(capsuleBody(1)),
          total: like(1),
          limit: like(20),
          offset: like(0),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOwnerUserIdCapsulesGet(
        {
          ownerUserId: CAPSULE_OWNER_ID,
          limit: 20,
          offset: 0,
          occasion: 'work',
          isFavorite: false,
        }
      )

      expect(outfitCapsuleListResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyCapsuleDetailInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to read one outfit capsule')
    .withRequest(
      'GET',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(1)) },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyUpdateCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to rename an outfit capsule with a current precondition')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
        body: { name: 'Renamed capsule' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(2)) },
        body: { data: capsuleBody(2) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
        updateOutfitCapsuleInput: { name: 'Renamed capsule' },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyFavoriteCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to set the favorite state of an outfit capsule')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}/favorite`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
        body: { isFavorite: true },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(2)) },
        body: { data: capsuleBody(2) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
        favoriteOutfitCapsuleInput: { isFavorite: true },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyDeleteCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to delete an outfit capsule')
    .withRequest(
      'DELETE',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
      })
    )
    .willRespondWith(204)
    .executeTest(async (mockServer: V3MockServer) => {
      await createClient(mockServer).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
      })
    })
}

/**
 * Documented capsule error envelopes. These pin the status and error shape the
 * clients branch on: stale and missing preconditions, ineligible garments,
 * idempotency-key reuse, and the masked 404 for an unauthorized owner.
 *
 * Exported alongside a single-interaction `verifyCapsuleErrorInteraction` (in
 * place of the earlier grouped `verifyCapsuleErrorInteractions` that looped
 * `addInteraction()...executeTest()` inside one `it()`) so each pacttest file
 * drives one `it.each(...)` row per interaction -- PactV4's Rust FFI
 * non-deterministically drops an interaction when more than one such chain
 * is awaited inside a single test body. See the identical fix and rationale
 * on `suggestGarmentTagsErrorInteractions`/`updateGarmentTagsErrorInteractions`
 * above, from the same dedicated bmad-tea test-architecture review pass.
 */
export type CapsuleErrorInteraction = {
  description: string
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET'
  path: string
  state: string
  headers: Record<string, string>
  body?: Record<string, unknown>
  status: number
  code: string
  /** Nest's reason phrase, carried in `error`. Null when none is emitted. */
  reason: string | null
}

export const capsuleErrorInteractions: CapsuleErrorInteraction[] = [
  {
    description: 'rejects a stale precondition with 412',
    method: 'PATCH',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'A capsule exists for owner at a newer revision',
    headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
    body: { name: 'Stale rename' },
    status: 412,
    code: 'CAPSULE_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  },
  {
    description: 'requires a precondition with 428',
    method: 'PATCH',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'A capsule exists for owner',
    headers: pactEventHeaders,
    body: { name: 'Unconditional rename' },
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    /**
     * 428 is raised as a bare HttpException rather than a named Nest exception,
     * so the response carries no `error` reason phrase. Pinning one here would
     * describe an envelope the provider never sends.
     */
    reason: null,
  },
  {
    description: 'rejects an ineligible garment with 409',
    method: 'POST',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
    state: 'A garment pending deletion exists for owner',
    headers: pactEventHeaders,
    body: {
      name: 'Ineligible capsule',
      occasions: ['work'],
      garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
      isFavorite: false,
    },
    status: 409,
    code: 'GARMENT_NOT_CAPSULE_ELIGIBLE',
    reason: 'Conflict',
  },
  {
    description: 'rejects idempotency key reuse with a changed payload',
    method: 'POST',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
    state: 'A capsule already exists for the idempotency key',
    headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
    body: {
      name: 'A different capsule',
      occasions: ['casual'],
      garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
      isFavorite: true,
    },
    status: 409,
    code: 'IDEMPOTENCY_KEY_REUSED',
    reason: 'Conflict',
  },
  {
    description: 'masks an unauthorized owner relationship as 404',
    method: 'GET',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'The actor has no relationship with the owner',
    headers: pactEventHeaders,
    status: 404,
    code: 'NOT_FOUND',
    reason: 'Not Found',
  },
]

export async function verifyCapsuleErrorInteraction(
  pact: PactV4,
  interaction: CapsuleErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving(`a capsule request that ${interaction.description}`)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: interaction.headers,
        ...(interaction.body ? { body: interaction.body } : {}),
      })
    )
    /**
     * The canonical envelope is Nest's default shape from
     * `packages/api-client/src/contracts/http/common.ts`: `error` is the
     * reason phrase string and the machine-readable code travels in
     * `message`. An earlier version of this contract declared a nested
     * `{ error: { code, message } }` object, which no endpoint in this API
     * emits, so provider verification could never have passed.
     */
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.code),
          ...(interaction.reason ? { error: string(interaction.reason) } : {}),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The interaction must actually be issued. An empty callback leaves the
      // declared request unsent, and Pact fails the whole test with
      // "expected but not received" rather than recording the contract.
      //
      // The generated SDK throws on these statuses, so the request goes out
      // directly: the point is to pin the status and error envelope the
      // clients branch on, not the SDK's error-handling.
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: interaction.method,
        headers: interaction.body
          ? { ...interaction.headers, 'Content-Type': 'application/json' }
          : interaction.headers,
        ...(interaction.body ? { body: JSON.stringify(interaction.body) } : {}),
      })

      expect(response.status).toBe(interaction.status)

      const payload = (await response.json()) as {
        statusCode?: number
        message?: string
        error?: string
      }
      expect(payload.statusCode).toBe(interaction.status)
      expect(payload.message).toBe(interaction.code)
      expect(payload.error).toBe(interaction.reason ?? undefined)
    })
}

/* ------------------------------------------------------------------------- *
 * Story 4.4 wardrobe onboarding and silhouette setup
 *
 * Pact covers request and response shapes, status codes, headers, and error
 * envelopes for the onboarding state machine and the silhouette/My Form
 * pipeline. The forward-only state machine, revision/If-Match races, RLS,
 * and the moderation pipeline itself stay in the API and PostgreSQL
 * integration suites. One `addInteraction()`/`executeTest()` cycle per case.
 *
 * Decision 11 gives guardians no dedicated HTTP route for onboarding or
 * silhouette (both are self-scoped to `auth.userId`, unlike capsules'
 * `:ownerUserId` path): a guardian's read/write access is proven at the RLS
 * layer in `packages/db/test/rls-policies.spec.ts`, not here. "Guardian
 * access" at this HTTP layer is the `WardrobeUploadGuard` consent gate
 * decision 7 requires on every silhouette route, exercised below for both a
 * read and a write by a teen actor without active guardian consent.
 *
 * The My Form bytes-PUT endpoint
 * (`PUT /api/v1/wardrobe/silhouette/my-form/uploads/{uploadSessionId}`) has
 * no Pact interaction here, matching the existing precedent: the sibling
 * garment bytes-PUT endpoint (`PUT /api/v1/wardrobe/uploads/{uploadSessionId}`)
 * has never had one either, since Web/Mobile upload raw bytes with the
 * shared `uploadGarmentBytes()` fetch helper straight to the signed
 * `uploadUrl`, not through a generated-SDK call this file can pin cleanly.
 * ------------------------------------------------------------------------- */

const ONBOARDING_OWNER_ID = CAPSULE_OWNER_ID
const SILHOUETTE_TEEN_ID = 'teen-1'
const SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY = '6eae27b8-8335-476e-a3bf-371e9fa5fd26'
const SILHOUETTE_COMMIT_IDEMPOTENCY_KEY = '760490a0-5049-4cdd-afcf-ac8e7ba0b436'
const SILHOUETTE_UPLOAD_SESSION_ID = '85b4dde2-3df2-4e81-8c18-d51ae3408ca0'
const SILHOUETTE_SHA256 =
  'ba9d325931fa708929de6fdc7d90728bf50bffbc1cbfcaa7e2e2275c175dc0b3'

const ONBOARDING_STARTED_AT = '2026-08-09T09:00:00.000Z'
const SILHOUETTE_UPDATED_AT = '2026-08-09T09:05:00.000Z'
const SILHOUETTE_COMMITTED_AT = '2026-08-09T09:10:00.000Z'
const SILHOUETTE_UPLOAD_EXPIRY = '2026-08-09T09:15:00.000Z'
const SILHOUETTE_IMAGE_EXPIRY = '2026-08-09T09:25:00.000Z'

/** Mirrors Task 3's documented virtual-default ETag shape: `"onboarding:<userId>:<revision>"`. */
const onboardingETagFor = (revision: number) =>
  `"onboarding:${ONBOARDING_OWNER_ID}:${revision}"`
/** Silhouette is a one-row-per-user singleton, so its ETag follows the same user-scoped shape. */
const silhouetteETagFor = (revision: number) =>
  `"silhouette:${ONBOARDING_OWNER_ID}:${revision}"`

function onboardingStateBody(
  revision: number,
  fields: {
    status: WardrobeOnboardingStatus
    currentStep: WardrobeOnboardingStep
    usedStarterWardrobe: boolean
    garmentsCapturedCount: number
    startedAt: string | null
    completedAt: string | null
  }
) {
  return {
    status: string(fields.status),
    currentStep: string(fields.currentStep),
    usedStarterWardrobe: like(fields.usedStarterWardrobe),
    garmentsCapturedCount: like(fields.garmentsCapturedCount),
    startedAt: fields.startedAt === null ? nullValue() : isoTimestamp(fields.startedAt),
    completedAt:
      fields.completedAt === null ? nullValue() : isoTimestamp(fields.completedAt),
    revision: like(revision),
  }
}

type SilhouetteMyFormFields = {
  status: SilhouettePhotoStatus
  failureReason: SilhouettePhotoFailureReason | null
  committedAt: string | null
  imageAccess: null | { url: string; expiresAt: string }
}

function silhouetteProfileBody(
  revision: number,
  fields: {
    mode: SilhouetteMode
    heightSlider: number | null
    buildSlider: number | null
    myForm: null | SilhouetteMyFormFields
  }
) {
  return {
    mode: string(fields.mode),
    heightSlider: fields.heightSlider === null ? nullValue() : like(fields.heightSlider),
    buildSlider: fields.buildSlider === null ? nullValue() : like(fields.buildSlider),
    myForm:
      fields.myForm === null
        ? nullValue()
        : {
            status: string(fields.myForm.status),
            failureReason:
              fields.myForm.failureReason === null
                ? nullValue()
                : string(fields.myForm.failureReason),
            committedAt:
              fields.myForm.committedAt === null
                ? nullValue()
                : isoTimestamp(fields.myForm.committedAt),
            imageAccess:
              fields.myForm.imageAccess === null
                ? nullValue()
                : {
                    url: string(fields.myForm.imageAccess.url),
                    expiresAt: isoTimestamp(fields.myForm.imageAccess.expiresAt),
                  },
          },
    revision: like(revision),
    updatedAt: isoTimestamp(SILHOUETTE_UPDATED_AT),
  }
}

// --- Onboarding state machine (ownership: owner reading/writing own state) -

export async function verifyOnboardingStateInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read existing wardrobe onboarding progress')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(1)) },
        body: {
          data: onboardingStateBody(1, {
            status: 'in_progress',
            currentStep: 'capture',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingGet()

      expect(wardrobeOnboardingStateResponseSchema.parse(response)).toMatchObject({
        data: { status: 'in_progress', currentStep: 'capture' },
      })
    })
}

export async function verifyOnboardingVirtualDefaultInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'No wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read onboarding progress before any row exists')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(0)) },
        body: {
          data: onboardingStateBody(0, {
            status: 'not_started',
            currentStep: 'permission',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 0,
            startedAt: null,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingGet()

      expect(wardrobeOnboardingStateResponseSchema.parse(response)).toEqual({
        data: {
          status: 'not_started',
          currentStep: 'permission',
          usedStarterWardrobe: false,
          garmentsCapturedCount: 0,
          startedAt: null,
          completedAt: null,
          revision: 0,
        },
      })
    })
}

export async function verifyPatchOnboardingStateInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to advance the onboarding state machine one step')
    .withRequest(
      'PATCH',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
        body: { targetStep: 'tagging' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(2)) },
        body: {
          data: onboardingStateBody(2, {
            status: 'in_progress',
            currentStep: 'tagging',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingPatch({
        ifMatch: onboardingETagFor(1),
        updateWardrobeOnboardingStateInput: { targetStep: 'tagging' },
      })

      expect(wardrobeOnboardingStateResponseSchema.parse(response).data.currentStep).toBe(
        'tagging'
      )
    })
}

/**
 * AC4: "a repeated identical mutation is a safe no-op that changes no
 * revision or telemetry." Grounded in
 * `wardrobe-onboarding.service.ts`'s `advanceExistingState`: a PATCH whose
 * `targetStep`/`usedStarterWardrobe` exactly match the current row is an
 * `isIdenticalReplay`, returned unchanged (same revision, same ETag) rather
 * than incrementing. `verifyPatchOnboardingStateInteraction`'s "Wardrobe
 * onboarding state exists for user" fixture implies `currentStep: 'capture'`
 * at revision 1 (that interaction advances it to `'tagging'`); replaying
 * with `targetStep: 'capture'` (the *current* step, not the next one) is
 * exactly the identical-replay condition.
 */
export async function verifyOnboardingReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a repeated identical onboarding step transition')
    .withRequest(
      'PATCH',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
        body: { targetStep: 'capture' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(1)) },
        body: {
          data: onboardingStateBody(1, {
            status: 'in_progress',
            currentStep: 'capture',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingPatch({
        ifMatch: onboardingETagFor(1),
        updateWardrobeOnboardingStateInput: { targetStep: 'capture' },
      })

      const parsed = wardrobeOnboardingStateResponseSchema.parse(response).data
      expect(parsed.currentStep).toBe('capture')
      expect(parsed.revision).toBe(1)
    })
}

/**
 * Shared documented-error-envelope interaction for the Story 4.4 routes.
 * Mirrors `verifySmartTagErrorInteraction`/`capsuleErrorInteractions`, but
 * generalized over both new tables' state params in one place instead of
 * duplicating the helper a third time.
 *
 * Exported, along with the interaction tables below, so each pacttest file
 * can drive one `it.each(...)` row per interaction rather than looping over
 * the table inside a single `it()` — PactV4's Rust FFI non-deterministically
 * drops an interaction when more than one `addInteraction()...executeTest()`
 * chain is awaited inside one test body, so "one interaction per test" (the
 * task's own wording) means one per `it()`, not one per exported function.
 */
export type WardrobeErrorInteraction = {
  description: string
  method: 'GET' | 'PATCH' | 'PUT' | 'POST' | 'DELETE'
  path: string
  state: string
  stateParams: Record<string, unknown>
  headers: Record<string, string>
  body?: Record<string, unknown>
  status: number
  code: string
  /**
   * Nest's reason phrase, carried in `error`. `null` for the 428 case: real
   * provider verification confirmed `parseOnboardingIfMatchHeader`/
   * `parseSilhouetteIfMatchHeader` raise a bare `HttpException` for a
   * missing `If-Match`, which carries no `error` field at all — mirroring
   * `CapsuleErrorInteraction`'s identical, already-documented 428 case.
   */
  reason: string | null
}

export async function verifyWardrobeErrorInteraction(
  pact: PactV4,
  interaction: WardrobeErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({ name: interaction.state, params: interaction.stateParams })
    )
    .uponReceiving(interaction.description)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: interaction.headers,
        ...(interaction.body ? { body: interaction.body } : {}),
      })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.code),
          ...(interaction.reason ? { error: string(interaction.reason) } : {}),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: interaction.method,
        headers: interaction.body
          ? { ...interaction.headers, 'Content-Type': 'application/json' }
          : interaction.headers,
        ...(interaction.body ? { body: JSON.stringify(interaction.body) } : {}),
      })

      expect(response.status).toBe(interaction.status)
      const payload = (await response.json()) as {
        statusCode?: number
        message?: string
        error?: string
      }
      expect(payload.statusCode).toBe(interaction.status)
      expect(payload.message).toBe(interaction.code)
      expect(payload.error).toBe(interaction.reason ?? undefined)
    })
}

export const onboardingErrorInteractions: WardrobeErrorInteraction[] = [
  {
    description: 'a request that skips ahead to an unreachable onboarding step',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
    body: { targetStep: 'complete' },
    status: 409,
    code: 'INVALID_STEP_TRANSITION',
    reason: 'Conflict',
  },
  {
    description: 'a request with a stale onboarding revision precondition',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user at a newer revision',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
    body: { targetStep: 'tagging' },
    status: 412,
    code: 'ONBOARDING_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  },
  {
    description: 'a request to advance onboarding without an If-Match precondition',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: pactEventHeaders,
    body: { targetStep: 'tagging' },
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    // 428 is raised as a bare HttpException, not a named Nest exception, so
    // the response carries no `error` reason phrase — confirmed against the
    // real provider (see the capsule 428 case's identical, pre-existing note).
    reason: null,
  },
]

// --- Silhouette sliders (ownership: owner reading/writing own profile) -----

export async function verifySilhouetteProfileInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read the silhouette profile')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(1)) },
        body: {
          data: silhouetteProfileBody(1, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response)).toMatchObject({
        data: { mode: 'default_mannequin', heightSlider: 50, buildSlider: 50 },
      })
    })
}

export async function verifyUpdateSilhouetteSlidersInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to save silhouette slider values')
    .withRequest(
      'PUT',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
        body: { heightSlider: 62, buildSlider: 40 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 62,
            buildSlider: 40,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouettePut({
        ifMatch: silhouetteETagFor(1),
        updateSilhouetteSlidersInput: { heightSlider: 62, buildSlider: 40 },
      })

      expect(silhouetteProfileResponseSchema.parse(response).data).toMatchObject({
        heightSlider: 62,
        buildSlider: 40,
      })
    })
}

/**
 * AC4's safe-no-op replay requirement, for silhouette sliders. Grounded in
 * `wardrobe-silhouette.service.ts`'s `updateSliders`: a PUT whose slider
 * values (and implicit `mode: 'default_mannequin'`) exactly match the
 * existing row is an `isIdenticalReplay`, returned unchanged rather than
 * incrementing. "Silhouette profile exists for user" implies
 * `heightSlider: 50, buildSlider: 50` at revision 1
 * (`verifySilhouetteProfileInteraction`'s fixture); resending those same
 * values is exactly the identical-replay condition.
 */
export async function verifyUpdateSilhouetteSlidersReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a repeated identical silhouette slider save')
    .withRequest(
      'PUT',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
        body: { heightSlider: 50, buildSlider: 50 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(1)) },
        body: {
          data: silhouetteProfileBody(1, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouettePut({
        ifMatch: silhouetteETagFor(1),
        updateSilhouetteSlidersInput: { heightSlider: 50, buildSlider: 50 },
      })

      const parsed = silhouetteProfileResponseSchema.parse(response).data
      expect(parsed).toMatchObject({ heightSlider: 50, buildSlider: 50 })
      expect(parsed.revision).toBe(1)
    })
}

/**
 * "Guardian access" for onboarding/silhouette (decision 11) is the
 * `WardrobeUploadGuard` consent gate, not a guardian dashboard route:
 * proven here for both a read and a write by a teen actor.
 */
export const silhouetteGuardianErrorInteractions: WardrobeErrorInteraction[] = [
  {
    description:
      'a request from a teen without active guardian consent to read the silhouette profile',
    method: 'GET',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Guardian consent is not active for teen silhouette access',
    stateParams: { userId: SILHOUETTE_TEEN_ID },
    headers: pactTeenHeaders,
    status: 403,
    code: 'GUARDIAN_CONSENT_REQUIRED',
    reason: 'Forbidden',
  },
  {
    description:
      'a request from a teen without active guardian consent to save silhouette sliders',
    method: 'PUT',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Guardian consent is not active for teen silhouette access',
    stateParams: { userId: SILHOUETTE_TEEN_ID },
    headers: { ...pactTeenHeaders, 'If-Match': silhouetteETagFor(0) },
    body: { heightSlider: 50, buildSlider: 50 },
    status: 403,
    code: 'GUARDIAN_CONSENT_REQUIRED',
    reason: 'Forbidden',
  },
]

export async function verifySilhouetteStalePreconditionInteraction(pact: PactV4) {
  await verifyWardrobeErrorInteraction(pact, {
    description:
      'a request to save silhouette sliders with a stale revision precondition',
    method: 'PUT',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Silhouette profile exists for user at a newer revision',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
    body: { heightSlider: 62, buildSlider: 40 },
    status: 412,
    code: 'SILHOUETTE_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  })
}

// --- "My Form" photo pipeline -----------------------------------------------

export async function verifyMyFormUploadUrlInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to allocate a My Form upload session')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/upload-url',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        },
        body: {
          fileSizeBytes: 2048576,
          mimeType: 'image/png',
          sha256: SILHOUETTE_SHA256,
          widthPx: 1024,
          heightPx: 1536,
        },
      })
    )
    .willRespondWith(
      201,
      setJsonContent({
        body: {
          data: {
            uploadSessionId: string(SILHOUETTE_UPLOAD_SESSION_ID),
            uploadUrl: string(
              `https://api.example/wardrobe/silhouette/uploads/${SILHOUETTE_UPLOAD_SESSION_ID}`
            ),
            uploadToken: string('token_my_form_upload'),
            requiredHeaders: { 'content-type': string('image/png') },
            expiresAt: isoTimestamp(SILHOUETTE_UPLOAD_EXPIRY),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormUploadUrlPost({
        idempotencyKey: SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        createSilhouetteUploadUrlInput: {
          fileSizeBytes: 2048576,
          mimeType: 'image/png',
          sha256: SILHOUETTE_SHA256,
          widthPx: 1024,
          heightPx: 1536,
        },
      })

      expect(
        createSilhouetteUploadUrlResponseSchema.parse(response).data.uploadSessionId
      ).toBe(SILHOUETTE_UPLOAD_SESSION_ID)
    })
}

export async function verifyMyFormCommitInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'My Form photo bytes are uploaded and awaiting commit for user',
        params: {
          userId: ONBOARDING_OWNER_ID,
          uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID,
        },
      })
    )
    .uponReceiving('a request to commit the uploaded My Form photo for processing')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/commit',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        },
        body: {
          uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID,
          confirmsBasewearGuidance: true,
        },
      })
    )
    .willRespondWith(
      // The commit handler has no `@HttpCode` override, so it falls to
      // Nest's POST default (201), confirmed against the real provider.
      201,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          // `mode` stays `default_mannequin` while the photo is still
          // `processing`: AC2/decision 5 say a *ready* photo becomes the
          // active silhouette mode, and a failed attempt never switches it
          // either (see the failure-reason interactions below) — so an
          // in-flight commit can't jump ahead of that rule and switch mode
          // before the pipeline has produced a `ready` result.
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'processing',
              failureReason: null,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormCommitPost({
        idempotencyKey: SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        commitSilhouettePhotoInput: {
          uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID,
          confirmsBasewearGuidance: true,
        },
      })

      const parsed = silhouetteProfileResponseSchema.parse(response).data
      expect(parsed.myForm?.status).toBe('processing')
      expect(parsed.mode).toBe('default_mannequin')
    })
}

export async function verifyMyFormReadyInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo is ready for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read a ready My Form photo')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(3)) },
        body: {
          data: silhouetteProfileBody(3, {
            mode: 'my_form',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'ready',
              failureReason: null,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: {
                url: 'https://example.test/silhouette-my-form.png',
                expiresAt: SILHOUETTE_IMAGE_EXPIRY,
              },
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'ready',
        failureReason: null,
      })
    })
}

export const myFormFailureReasons = [
  'contrast',
  'privacy_violation',
  'timeout',
  'storage_error',
] as const satisfies readonly SilhouettePhotoFailureReason[]

/**
 * Covers one documented "My Form" failure reason (decision 5/9). Exported as
 * a single-interaction function, driven by `it.each(myFormFailureReasons)`
 * in each pacttest file, rather than looping over all four reasons inside
 * one exported function/`it()` — PactV4's FFI non-deterministically drops an
 * interaction when more than one `addInteraction()...executeTest()` chain is
 * awaited inside a single test body (see `verifyWardrobeErrorInteraction`'s
 * doc comment above).
 */
export async function verifyMyFormFailureInteraction(
  pact: PactV4,
  createClient: CreateClient,
  failureReason: SilhouettePhotoFailureReason
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo failed for user',
        params: { userId: ONBOARDING_OWNER_ID, reason: failureReason },
      })
    )
    .uponReceiving(`a request to read a My Form photo that failed with ${failureReason}`)
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          // A failed My Form attempt never switches the active mode; the
          // previous mannequin sliders remain in effect (AC2/decision 5).
          // `committedAt` stays set: silhouette-photo.processor.ts's failure
          // branch never clears `my_form_committed_at` (only a full DELETE
          // does) because the record was already committed before
          // processing failed.
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'failed',
              failureReason,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'failed',
        failureReason,
        committedAt: SILHOUETTE_COMMITTED_AT,
      })
    })
}

/**
 * Decision 6: a `privacy_violation` verdict on a teen's photo additionally
 * writes a `ModerationEvent` and queues a guardian notification through the
 * durable `EventEnvelope` outbox. That side effect is invisible to the HTTP
 * response by design (decision 8/the 4.4-UNIT-001 analytics fixtures prove
 * the same "never leaks photo/moderation detail" rule) — the teen sees the
 * identical `failed`/`privacy_violation` shape any other actor would. This
 * interaction exists as its own case, with its own provider state, so a
 * wired provider can additionally assert the outbox row once Task 3/4 land;
 * the response-shape assertion here only proves no leakage.
 */
export async function verifyMyFormGuardianNotificationInteraction(
  pact: PactV4,
  createTeenClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo failed privacy_violation for a teen and queued a guardian notification',
        params: { userId: SILHOUETTE_TEEN_ID },
      })
    )
    .uponReceiving(
      'a request from a teen to read a My Form photo that failed privacy_violation and notified their guardian'
    )
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactTeenHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'failed',
              failureReason: 'privacy_violation',
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createTeenClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'failed',
        failureReason: 'privacy_violation',
        committedAt: SILHOUETTE_COMMITTED_AT,
      })
    })
}

export async function verifyMyFormDeleteInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving(
      'a request to delete the My Form photo and revert to the default mannequin'
    )
    .withRequest(
      'DELETE',
      '/api/v1/wardrobe/silhouette/my-form',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(3) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(4)) },
        body: {
          data: silhouetteProfileBody(4, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteMyFormDelete(
        {
          ifMatch: silhouetteETagFor(3),
        }
      )

      expect(silhouetteProfileResponseSchema.parse(response).data).toMatchObject({
        mode: 'default_mannequin',
        myForm: null,
      })
    })
}
