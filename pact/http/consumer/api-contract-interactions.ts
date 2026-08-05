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
