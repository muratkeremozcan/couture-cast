// Story 1.2b client location capture.
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  createSavedLocationFromSearchResponseSchema,
  deleteSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchResponseSchema,
  locationUnavailableResponseSchema,
  setPrimarySavedLocationResponseSchema,
  type LocationPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  eachLike,
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 1.2b client location capture: search, save from search, list, switch
 * primary and delete, the five operations the web Locations section and the
 * mobile Locations screen drive.
 *
 * Every identifier below is mirrored in `pact/http/provider/doubles/locations.ts`.
 * The candidate token is opaque to clients: they hand back exactly what search
 * returned, so the contract pins only its presence and string type.
 *
 * Error rows go out through raw fetch because the generated SDK throws on non-2xx
 * responses; what they pin is the typed `code` envelope the clients localize.
 * One interaction per exported function, each called from its own `it()`, for
 * the PactV4 FFI reason `planner.ts` records.
 * ------------------------------------------------------------------------- */

export const PACT_SEARCHED_LOCATION_ID = 'loc-searched-1'
export const PACT_OFFICE_LOCATION_ID = 'loc-office-2'
export const PACT_FOREIGN_LOCATION_ID = 'loc-foreign-9'
export const PACT_CANDIDATE_TOKEN = 'pact-candidate-payload.pact-candidate-signature'
const SEARCH_KEY = 'chicago-illinois-us-41-878n-87-630w'
const CREATED_AT = '2026-10-22T12:00:00.000Z'

const searchedLocationBody = (isPrimary: boolean) => ({
  id: string(PACT_SEARCHED_LOCATION_ID),
  label: string('Home'),
  locationKey: string(SEARCH_KEY),
  latitude: like(41.878),
  longitude: like(-87.63),
  timezone: string('America/Chicago'),
  city: string('Chicago'),
  region: string('Illinois'),
  country: string('US'),
  isPrimary: like(isPrimary),
  sortOrder: like(0),
  createdAt: isoTimestamp(CREATED_AT),
  updatedAt: isoTimestamp(CREATED_AT),
})

const officeLocationBody = (isPrimary: boolean) => ({
  id: string(PACT_OFFICE_LOCATION_ID),
  label: string('Office'),
  locationKey: string('monaco-mc-43-738n-7-425e'),
  latitude: like(43.738),
  longitude: like(7.425),
  timezone: string('Europe/Monaco'),
  city: string('Monaco'),
  region: nullValue(),
  country: string('MC'),
  isPrimary: like(isPrimary),
  sortOrder: like(1),
  createdAt: isoTimestamp(CREATED_AT),
  updatedAt: isoTimestamp(CREATED_AT),
})

const platformHeaders = (platform: LocationPlatform) => ({
  ...pactEventHeaders,
  'x-couture-platform': platform,
})

const memberState = (name: string) =>
  createProviderState({ name, params: { userId: pactEventAuth.userId } })

/**
 * Provider endpoint: /api/v1/locations/search -> GET LocationPreferencesController.searchLocations
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/location-preferences/location-preferences.controller.ts
 * - Response type: LocationSearchResponse ({ data: LocationSearchCandidate[] }, at most 5)
 * - Status codes: 200
 * - Field names: city, region (nullable), country (ISO alpha-2), latitude,
 *   longitude, displayLabel, candidateToken
 */
export async function verifyLocationSearchInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState('A city search returns candidates for user'))
    .uponReceiving(`a ${platform} city search`)
    .withRequest(
      'GET',
      '/api/v1/locations/search',
      setJsonContent({
        headers: platformHeaders(platform),
        query: { q: 'Chicago', locale: 'fr-FR' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: eachLike({
            city: string('Chicago'),
            region: string('Illinois'),
            country: string('US'),
            latitude: like(41.878),
            longitude: like(-87.63),
            displayLabel: string('Chicago, Illinois, États-Unis'),
            candidateToken: string(PACT_CANDIDATE_TOKEN),
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsSearchGet({
        q: 'Chicago',
        locale: 'fr-FR',
        xCouturePlatform: platform,
      })

      const [candidate] = locationSearchResponseSchema.parse(response).data
      expect(candidate?.country).toBe('US')
      expect(candidate?.candidateToken).toBe(PACT_CANDIDATE_TOKEN)
    })
}

/**
 * Provider endpoint: /api/v1/locations/search -> GET (provider failure)
 *
 * The typed retryable 503 the clients turn into a localized retry message.
 */
export async function verifyLocationSearchUnavailableInteraction(
  pact: PactV4,
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState('The location provider is unavailable for user'))
    .uponReceiving(`a ${platform} city search while the provider is down`)
    .withRequest(
      'GET',
      '/api/v1/locations/search',
      setJsonContent({ headers: platformHeaders(platform), query: { q: 'Chicago' } })
    )
    .willRespondWith(
      503,
      setJsonContent({
        body: {
          statusCode: like(503),
          code: string('provider_unavailable'),
          retryable: like(true),
          message: string('The location provider is temporarily unavailable. Try again.'),
          error: string('Service Unavailable'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(
        `${mockServer.url}/api/v1/locations/search?q=Chicago`,
        {
          headers: platformHeaders(platform),
        }
      )

      expect(response.status).toBe(503)
      expect(locationUnavailableResponseSchema.parse(await response.json()).code).toBe(
        'provider_unavailable'
      )
    })
}

/**
 * Provider endpoint: /api/v1/locations/from-search -> POST LocationPreferencesController.createLocationFromSearch
 *
 * Provider Scrutiny Evidence:
 * - Response type: CreateSavedLocationFromSearchResponse ({ data: SavedLocation })
 * - Status codes: 201 (Nest POST default)
 * - Field names: `{ candidateToken, label }` in, `.strict()`; timezone and
 *   country come from the server, never the client
 */
export async function verifyLocationSaveFromSearchInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has no saved locations'))
    .uponReceiving(`a ${platform} save of a searched city`)
    .withRequest(
      'POST',
      '/api/v1/locations/from-search',
      setJsonContent({
        headers: platformHeaders(platform),
        body: { candidateToken: PACT_CANDIDATE_TOKEN, label: 'Home' },
      })
    )
    .willRespondWith(201, setJsonContent({ body: { data: searchedLocationBody(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsFromSearchPost({
        xCouturePlatform: platform,
        createSavedLocationFromSearchInput: {
          candidateToken: PACT_CANDIDATE_TOKEN,
          label: 'Home',
        },
      })

      const location = createSavedLocationFromSearchResponseSchema.parse(response).data
      expect(location.isPrimary).toBe(true)
      expect(location.country).toBe('US')
    })
}

export const locationSaveErrorInteractions = [
  {
    description: 'refuses an expired or tampered candidate',
    state: 'The user holds an expired location candidate',
    status: 400,
    code: 'invalid_candidate',
    message: 'This search result expired. Search again.',
    error: 'Bad Request',
    retryable: false,
  },
  {
    description: 'explains the three-location limit',
    state: 'The user has three saved locations',
    status: 400,
    code: 'location_limit_reached',
    message: 'Users can save at most three locations',
    error: 'Bad Request',
    retryable: false,
  },
  {
    description: 'saves nothing when the forecast call fails',
    state: 'The location provider is unavailable for user',
    status: 503,
    code: 'provider_unavailable',
    message: 'The location provider is temporarily unavailable. Try again.',
    error: 'Service Unavailable',
    retryable: true,
  },
] as const

export async function verifyLocationSaveErrorInteraction(
  pact: PactV4,
  interaction: (typeof locationSaveErrorInteractions)[number],
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState(interaction.state))
    .uponReceiving(`a ${platform} save from search that ${interaction.description}`)
    .withRequest(
      'POST',
      '/api/v1/locations/from-search',
      setJsonContent({
        headers: platformHeaders(platform),
        body: { candidateToken: PACT_CANDIDATE_TOKEN, label: 'Home' },
      })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        body: {
          statusCode: like(interaction.status),
          code: string(interaction.code),
          ...(interaction.retryable ? { retryable: like(true) } : {}),
          message: string(interaction.message),
          error: string(interaction.error),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(`${mockServer.url}/api/v1/locations/from-search`, {
        method: 'POST',
        headers: { ...platformHeaders(platform), 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken: PACT_CANDIDATE_TOKEN, label: 'Home' }),
      })

      expect(response.status).toBe(interaction.status)
      const body: unknown = await response.json()
      const parsed =
        interaction.status === 503
          ? locationUnavailableResponseSchema.parse(body)
          : locationRequestErrorResponseSchema.parse(body)
      expect(parsed.code).toBe(interaction.code)
    })
}

/**
 * Provider endpoint: /api/v1/locations -> GET LocationPreferencesController.listLocations
 *
 * The Locations surfaces list label, city and the primary marker; a searched
 * place without a region stores null.
 */
export async function verifyLocationListInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to list saved locations')
    .withRequest(
      'GET',
      '/api/v1/locations',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: { data: [searchedLocationBody(true), officeLocationBody(false)] },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsGet()

      const locations = listSavedLocationsResponseSchema.parse(response).data
      expect(locations.map((location) => location.isPrimary)).toEqual([true, false])
      expect(locations[1]?.region).toBeNull()
    })
}

/**
 * Provider endpoint: /api/v1/locations/{locationId}/primary -> POST setPrimary
 *
 * Status codes: 200 (`@HttpCode(200)`); 404 for a location the caller does not own.
 */
export async function verifyLocationSetPrimaryInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to make the second saved location primary')
    .withRequest(
      'POST',
      `/api/v1/locations/${PACT_OFFICE_LOCATION_ID}/primary`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(200, setJsonContent({ body: { data: officeLocationBody(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsLocationIdPrimaryPost(
        {
          locationId: PACT_OFFICE_LOCATION_ID,
        }
      )

      expect(setPrimarySavedLocationResponseSchema.parse(response).data.isPrimary).toBe(
        true
      )
    })
}

export async function verifyLocationSetPrimaryForeignInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to make a foreign location primary')
    .withRequest(
      'POST',
      `/api/v1/locations/${PACT_FOREIGN_LOCATION_ID}/primary`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      404,
      setJsonContent({
        body: {
          statusCode: like(404),
          message: string('Saved location not found'),
          error: string('Not Found'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(
        `${mockServer.url}/api/v1/locations/${PACT_FOREIGN_LOCATION_ID}/primary`,
        { method: 'POST', headers: pactEventHeaders }
      )

      expect(response.status).toBe(404)
    })
}

/**
 * Provider endpoint: /api/v1/locations/{locationId} -> DELETE deleteLocation
 *
 * Status codes: 200 (`@HttpCode(200)`). Deleting the primary promotes the next
 * location server-side; clients reload the list.
 */
export async function verifyLocationDeleteInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to delete the primary saved location')
    .withRequest(
      'DELETE',
      `/api/v1/locations/${PACT_SEARCHED_LOCATION_ID}`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(200, setJsonContent({ body: { data: { deleted: like(true) } } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsLocationIdDelete({
        locationId: PACT_SEARCHED_LOCATION_ID,
      })

      expect(deleteSavedLocationResponseSchema.parse(response).data.deleted).toBe(true)
    })
}
