import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import type { DefaultApi } from '@couture/api-client'
import {
  apiHealthResponseSchema,
  eventsPollInvalidSinceResponseSchema,
  eventsPollResponseSchema,
  comfortPreferencesResponseSchema,
  updateComfortPreferencesResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'

const { eachLike, like, nullValue, regex, string } = MatchersV3

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

  const outfitMorning = {
    id: 'rec-morning-1',
    scenario: 'morning',
    garmentIds: ['g-1'],
    reasoningBadges: [{ label: 'Wind layer' }],
    comfortNotes: 'Chilly morning',
  }
  const outfitMidday = {
    id: 'rec-midday-1',
    scenario: 'midday',
    garmentIds: ['g-2'],
    reasoningBadges: [{ label: 'Mild' }],
    comfortNotes: 'Pleasant midday',
  }
  const outfitEvening = {
    id: 'rec-evening-1',
    scenario: 'evening',
    garmentIds: ['g-3'],
    reasoningBadges: [{ label: 'Evening' }],
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
      expect(firstOutfit.reasoningBadges).toEqual([{ label: 'Wind layer' }])
      expect(firstOutfit.comfortNotes).toBe('Chilly morning')
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
