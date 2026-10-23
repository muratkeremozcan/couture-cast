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
  updateSavedLocationResponseSchema,
  type LocationPlatform,
  type LocationRequestErrorCode,
  type LocationUnavailableErrorCode,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  eachLike,
  equal,
  fromProviderState,
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  regex,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 1.2b client location capture: search, save from search, list, rename,
 * switch primary and delete, the operations the web Locations section and the
 * mobile Locations screen drive.
 *
 * Provider verification runs the real location services against faked seams
 * (`pact/http/provider/doubles/locations.ts`), and each provider state builds
 * the world its name describes (`pact/http/provider/state.ts`). The candidate
 * token is opaque to clients: they hand back exactly what search returned. Save
 * rows therefore send it with `fromProviderState`, and the provider injects a
 * token its real service signed for that state.
 *
 * The `code`, `retryable`, `statusCode` and `error` fields are what both
 * clients switch on, so they are pinned with `equal`; `isPrimary` is pinned for
 * the same reason.
 *
 * Error rows go out through raw fetch because the generated SDK throws on non-2xx
 * responses; what they pin is the typed `code` envelope the clients localize.
 * One interaction per exported function, each called from its own `it()`, for
 * the PactV4 FFI reason `planner.ts` records.
 * ------------------------------------------------------------------------- */

export const PACT_SEARCHED_LOCATION_ID = 'loc-searched-1'
export const PACT_OFFICE_LOCATION_ID = 'loc-office-2'
export const PACT_FOREIGN_LOCATION_ID = 'loc-foreign-9'
/** The consumer-side example; verification sends the token the provider state minted. */
export const PACT_CANDIDATE_TOKEN = 'pact-candidate-payload.pact-candidate-signature'
const SEARCH_KEY = 'chicago-illinois-us-41-878n-87-630w'
const CREATED_AT = '2026-10-22T12:00:00.000Z'
const NOT_FOUND_MESSAGE = 'Saved location not found'

/**
 * Search candidates and locations saved from search carry an ISO 3166-1
 * alpha-2 country. The list, rename and primary rows keep `string()`: the
 * saved-location contract still admits a legacy free-text country, which both
 * clients render as typed.
 */
const countryCode = (value: string) => regex(/^[A-Z]{2}$/, value)

const injectedCandidateToken = () =>
  fromProviderState('${candidateToken}', PACT_CANDIDATE_TOKEN)

const searchedLocationBody = (isPrimary: boolean, country = string('US')) => ({
  id: string(PACT_SEARCHED_LOCATION_ID),
  label: string('Home'),
  locationKey: string(SEARCH_KEY),
  latitude: like(41.878),
  longitude: like(-87.63),
  timezone: string('America/Chicago'),
  city: string('Chicago'),
  region: string('Illinois'),
  country,
  isPrimary: equal(isPrimary),
  sortOrder: like(0),
  createdAt: isoTimestamp(CREATED_AT),
  updatedAt: isoTimestamp(CREATED_AT),
})

const officeLocationBody = (isPrimary: boolean, label = string('Office')) => ({
  id: equal(PACT_OFFICE_LOCATION_ID),
  label,
  locationKey: string('monaco-mc-43-738n-7-425e'),
  latitude: like(43.738),
  longitude: like(7.425),
  timezone: string('Europe/Monaco'),
  city: string('Monaco'),
  region: nullValue(),
  country: string('MC'),
  isPrimary: equal(isPrimary),
  sortOrder: like(1),
  createdAt: isoTimestamp(CREATED_AT),
  updatedAt: isoTimestamp(CREATED_AT),
})

const requestErrorBody = (code: LocationRequestErrorCode, message: string) => ({
  statusCode: equal(400),
  code: equal(code),
  message: string(message),
  error: equal('Bad Request'),
})

const unavailableBody = (code: LocationUnavailableErrorCode, message: string) => ({
  statusCode: equal(503),
  code: equal(code),
  retryable: equal(true),
  message: string(message),
  error: equal('Service Unavailable'),
})

const notFoundBody = {
  statusCode: equal(404),
  message: string(NOT_FOUND_MESSAGE),
  error: equal('Not Found'),
}

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
            country: countryCode('US'),
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
 * Provider endpoint: /api/v1/locations/search -> GET (typed failures)
 *
 * The validation 400 comes from the controller before the rate limit or the
 * provider runs; the 503s come from the capture service: a provider outage, and
 * a deployment without LOCATION_CANDIDATE_SECRET that fails closed.
 */
export const locationSearchErrorInteractions = [
  {
    description: 'while the provider is down',
    state: 'The location provider is unavailable for user',
    q: 'Chicago',
    status: 503,
    body: unavailableBody(
      'provider_unavailable',
      'The location provider is temporarily unavailable. Try again.'
    ),
    code: 'provider_unavailable',
  },
  {
    description: 'while location capture is not configured',
    state: 'Location capture is not configured',
    q: 'Chicago',
    status: 503,
    body: unavailableBody(
      'location_service_unavailable',
      'Location search is temporarily unavailable.'
    ),
    code: 'location_service_unavailable',
  },
  {
    description: 'with a one-character query',
    state: 'A city search returns candidates for user',
    q: 'C',
    status: 400,
    body: requestErrorBody('invalid_request', 'Search text must be 2 to 80 characters'),
    code: 'invalid_request',
  },
] as const

export async function verifyLocationSearchErrorInteraction(
  pact: PactV4,
  interaction: (typeof locationSearchErrorInteractions)[number],
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState(interaction.state))
    .uponReceiving(`a ${platform} city search ${interaction.description}`)
    .withRequest(
      'GET',
      '/api/v1/locations/search',
      setJsonContent({ headers: platformHeaders(platform), query: { q: interaction.q } })
    )
    .willRespondWith(interaction.status, setJsonContent({ body: interaction.body }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(
        `${mockServer.url}/api/v1/locations/search?q=${interaction.q}`,
        { headers: platformHeaders(platform) }
      )

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
 * Provider endpoint: /api/v1/locations/search -> GET (31st search in a minute)
 *
 * The shared rate-limit contract: the body stays `{ statusCode, message, error }`
 * and the retry time travels only in `Retry-After`, which the controller sets.
 */
export async function verifyLocationSearchRateLimitedInteraction(
  pact: PactV4,
  platform: LocationPlatform
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has used the city search allowance for this minute'))
    .uponReceiving(`a ${platform} city search over the per-minute limit`)
    .withRequest(
      'GET',
      '/api/v1/locations/search',
      setJsonContent({ headers: platformHeaders(platform), query: { q: 'Chicago' } })
    )
    .willRespondWith(
      429,
      setJsonContent({
        headers: { 'Retry-After': regex(/^[1-9][0-9]*$/, '30') },
        body: {
          statusCode: equal(429),
          message: string('Too many location searches. Try again shortly.'),
          error: equal('Too Many Requests'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 429, so the request goes out directly.
      const response = await fetch(
        `${mockServer.url}/api/v1/locations/search?q=Chicago`,
        {
          headers: platformHeaders(platform),
        }
      )

      expect(response.status).toBe(429)
      // A refusal with no recovery time is not actionable.
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
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
        body: { candidateToken: injectedCandidateToken(), label: 'Home' },
      })
    )
    .willRespondWith(
      201,
      setJsonContent({ body: { data: searchedLocationBody(true, countryCode('US')) } })
    )
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

const PROVIDER_DOWN = 'The location provider is temporarily unavailable. Try again.'

/**
 * `injectsCandidate: false` marks the one row that fails before the token is
 * read: with no secret configured there is nothing to sign one with.
 */
export const locationSaveErrorInteractions = [
  {
    description: 'refuses an expired candidate',
    state: 'The user holds an expired location candidate',
    status: 400,
    code: 'invalid_candidate',
    body: requestErrorBody(
      'invalid_candidate',
      'This search result expired. Search again.'
    ),
    injectsCandidate: true,
  },
  {
    description: 'explains the three-location limit',
    state: 'The user has three saved locations',
    status: 400,
    code: 'location_limit_reached',
    body: requestErrorBody(
      'location_limit_reached',
      'Users can save at most three locations'
    ),
    injectsCandidate: true,
  },
  {
    description: 'refuses a city the user already saved',
    state: 'The user already saved this searched location',
    status: 400,
    code: 'location_duplicate',
    body: requestErrorBody('location_duplicate', 'Saved location already exists'),
    injectsCandidate: true,
  },
  {
    description: 'saves nothing when the forecast call fails',
    state: 'The location provider is unavailable for user',
    status: 503,
    code: 'provider_unavailable',
    body: unavailableBody('provider_unavailable', PROVIDER_DOWN),
    injectsCandidate: true,
  },
  {
    description: 'fails closed while location capture is not configured',
    state: 'Location capture is not configured',
    status: 503,
    code: 'location_service_unavailable',
    body: unavailableBody(
      'location_service_unavailable',
      'Location search is temporarily unavailable.'
    ),
    injectsCandidate: false,
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
        body: {
          candidateToken: interaction.injectsCandidate
            ? injectedCandidateToken()
            : PACT_CANDIDATE_TOKEN,
          label: 'Home',
        },
      })
    )
    .willRespondWith(interaction.status, setJsonContent({ body: interaction.body }))
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
 * Provider endpoint: /api/v1/locations/{locationId} -> PATCH updateLocation
 *
 * Both clients rename through this route with a label-only body.
 * Status codes: 200.
 */
export async function verifyLocationRenameInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to rename a saved location')
    .withRequest(
      'PATCH',
      `/api/v1/locations/${PACT_OFFICE_LOCATION_ID}`,
      setJsonContent({ headers: pactEventHeaders, body: { label: 'Work' } })
    )
    .willRespondWith(
      200,
      setJsonContent({ body: { data: officeLocationBody(false, equal('Work')) } })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsLocationIdPatch({
        locationId: PACT_OFFICE_LOCATION_ID,
        updateSavedLocationInput: { label: 'Work' },
      })

      expect(updateSavedLocationResponseSchema.parse(response).data.label).toBe('Work')
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

/** `loc-foreign-9` exists in the provider world and belongs to another member. */
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
    .willRespondWith(404, setJsonContent({ body: notFoundBody }))
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
    .willRespondWith(200, setJsonContent({ body: { data: { deleted: equal(true) } } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1LocationsLocationIdDelete({
        locationId: PACT_SEARCHED_LOCATION_ID,
      })

      expect(deleteSavedLocationResponseSchema.parse(response).data.deleted).toBe(true)
    })
}

export async function verifyLocationDeleteForeignInteraction(pact: PactV4) {
  await pact
    .addInteraction()
    .given(...memberState('The user has two saved locations'))
    .uponReceiving('a request to delete a foreign location')
    .withRequest(
      'DELETE',
      `/api/v1/locations/${PACT_FOREIGN_LOCATION_ID}`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(404, setJsonContent({ body: notFoundBody }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await fetch(
        `${mockServer.url}/api/v1/locations/${PACT_FOREIGN_LOCATION_ID}`,
        { method: 'DELETE', headers: pactEventHeaders }
      )

      expect(response.status).toBe(404)
    })
}
