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

async function verifySmartTagErrorInteraction(
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

export async function verifySuggestGarmentTagsErrorInteractions(pact: PactV4) {
  const garmentId = '00000000-0000-4000-8000-000000000001'
  const userId = 'guardian-1'
  const invalidGarmentId = 'g'.repeat(129)

  await verifySmartTagErrorInteraction(pact, {
    description: 'a request to suggest tags with an invalid garment id',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${invalidGarmentId}/suggest-tags`,
    state: 'A garment in awaiting_tags status with tag suggestions exists for user',
    stateParams: { garmentId: invalidGarmentId, userId },
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
  })

  await verifySmartTagErrorInteraction(pact, {
    description: 'an unauthenticated request to suggest garment tags',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${garmentId}/suggest-tags`,
    state: 'A garment in awaiting_tags status with tag suggestions exists for user',
    stateParams: { garmentId, userId },
    includeAuthorization: false,
    responseStatus: 401,
    responseBody: {
      statusCode: 401,
      message: 'Missing or invalid bearer token',
      error: 'Unauthorized',
    },
  })

  await verifySmartTagErrorInteraction(pact, {
    description: 'a request while garment analysis is pending',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${garmentId}/suggest-tags`,
    state: 'Garment analysis is pending for user',
    stateParams: { garmentId, userId },
    responseStatus: 409,
    responseBody: {
      statusCode: 409,
      message: 'GARMENT_ANALYSIS_PENDING',
      error: 'Conflict',
    },
  })

  await verifySmartTagErrorInteraction(pact, {
    description: 'a request while garment tag inference is unavailable',
    method: 'POST',
    path: `/api/v1/wardrobe/garments/${garmentId}/suggest-tags`,
    state: 'Garment tagging inference is unavailable for user',
    stateParams: { garmentId, userId },
    responseStatus: 503,
    responseBody: {
      statusCode: 503,
      message: 'TAGGING_INFERENCE_UNAVAILABLE',
      error: 'Service Unavailable',
    },
  })
}

export async function verifyUpdateGarmentTagsErrorInteractions(pact: PactV4) {
  const garmentId = '00000000-0000-4000-8000-000000000001'
  const userId = 'guardian-1'
  const requestBody = {
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
  }

  await verifySmartTagErrorInteraction(pact, {
    description: 'a forbidden request to update garment tags',
    method: 'PATCH',
    path: `/api/v1/wardrobe/garments/${garmentId}/tags`,
    state: 'Wardrobe tagging is forbidden for user',
    stateParams: { garmentId, userId },
    requestBody,
    responseStatus: 403,
    responseBody: {
      statusCode: 403,
      message: 'GUARDIAN_CONSENT_REQUIRED',
      error: 'Forbidden',
    },
  })

  await verifySmartTagErrorInteraction(pact, {
    description: 'a request to update tags for a missing garment',
    method: 'PATCH',
    path: `/api/v1/wardrobe/garments/${garmentId}/tags`,
    state: 'Garment does not exist for user',
    stateParams: { garmentId, userId },
    requestBody,
    responseStatus: 404,
    responseBody: {
      statusCode: 404,
      message: 'GARMENT_NOT_FOUND',
      error: 'Not Found',
    },
  })
}

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
 */
type CapsuleErrorInteraction = {
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

const capsuleErrorInteractions: CapsuleErrorInteraction[] = [
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

export async function verifyCapsuleErrorInteractions(pact: PactV4) {
  for (const interaction of capsuleErrorInteractions) {
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
}
